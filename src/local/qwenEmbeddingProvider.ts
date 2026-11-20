import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import * as path from 'path';
import * as readline from 'readline';
import type { EmbeddingResult, LocalEmbeddingBackend } from './localEmbeddingProvider';
import { getLocalRetrievalProfile } from './localRetrievalProfile';

export function getQwenIdleTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.AMBIANCE_QWEN_IDLE_MS;
  if (raw === undefined) return 60000;
  const value = Number(raw);
  if (!raw.trim() || !Number.isInteger(value) || value < 0 || value > 3600000)
    throw new Error(
      'AMBIANCE_QWEN_IDLE_MS must be an integer from 0 to 3600000 (0 keeps the worker resident).'
    );
  return value;
}

export interface PlannedEmbeddingChunk {
  content: string;
  input: string;
  index: number;
  startLine: number;
  endLine: number;
  type: 'code';
  symbols?: string[];
}

/** One serialized, local-only encoder worker is shared by all callers in this runtime. */
export class QwenEmbeddingProvider implements LocalEmbeddingBackend {
  private child?: ChildProcessWithoutNullStreams;
  private sequence = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private pending?: { id: number; resolve: (value: any) => void; reject: (error: Error) => void };
  private idleTimer?: NodeJS.Timeout;
  private diagnostics = '';
  private disposed = false;
  private readonly profile = getLocalRetrievalProfile()!;
  private readonly idleTimeoutMs = getQwenIdleTimeoutMs();
  private readonly exitHandler = () => this.child?.kill();

  constructor() {
    if (!this.profile) throw new Error('The Qwen encoder requires --local-profile qwen3.');
    process.once('exit', this.exitHandler);
  }

  private start(): ChildProcessWithoutNullStreams {
    if (this.child) return this.child;
    const child = spawn(
      process.env.AMBIANCE_PYTHON || 'python',
      ['-u', path.join(__dirname, 'qwen_worker.py')],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        env: {
          ...process.env,
          PYTHONIOENCODING: 'utf-8:strict',
          PYTHONUTF8: '1',
          HF_HUB_OFFLINE: '1',
          TRANSFORMERS_OFFLINE: '1',
        },
      }
    );
    this.child = child;
    this.diagnostics = '';
    const lines = readline.createInterface({ input: child.stdout });
    lines.on('line', line => {
      if (this.child !== child) return;
      try {
        const response = JSON.parse(line);
        if (response.id !== this.pending?.id) return;
        const pending = this.pending!;
        this.pending = undefined;
        if (response.error) pending.reject(new Error(response.error));
        else pending.resolve(response.result);
      } catch {
        this.fail(child, new Error('Invalid response from the local encoder.'));
      }
    });
    child.stderr.on('data', value => {
      this.diagnostics = (this.diagnostics + String(value)).slice(-4000);
    });
    child.on('error', error =>
      this.fail(
        child,
        new Error(
          `Cannot start the local encoder: ${error.message}. Set AMBIANCE_PYTHON to your Python executable.`
        )
      )
    );
    child.on('exit', code => {
      lines.close();
      if (this.child === child)
        this.fail(child, new Error(`Local encoder exited (${code}). ${this.diagnostics}`));
    });
    child.stdin.on('error', error =>
      this.fail(child, new Error(`Local encoder pipe failed: ${error.message}`))
    );
    return child;
  }

  private fail(child: ChildProcessWithoutNullStreams, error: Error): void {
    if (this.child !== child) return;
    this.child = undefined;
    child.kill();
    const pending = this.pending;
    this.pending = undefined;
    pending?.reject(error);
  }

  private references(child: ChildProcessWithoutNullStreams, enabled: boolean): void {
    const method = enabled ? 'ref' : 'unref';
    child[method]();
    for (const stream of [child.stdin, child.stdout, child.stderr]) (stream as any)[method]?.();
  }

  request<T>(operation: string, args: Record<string, unknown>): Promise<T> {
    const next = this.queue.then(async () => {
      if (this.disposed) throw new Error('Local encoder has been disposed.');
      if (this.idleTimer) clearTimeout(this.idleTimer);
      const child = this.start();
      this.references(child, true);
      const id = ++this.sequence;
      const configured = Number(process.env.AMBIANCE_QWEN_TIMEOUT_MS || 90000);
      const timeout = Number.isFinite(configured)
        ? Math.max(1000, Math.min(configured, 300000))
        : 90000;
      try {
        return await new Promise<T>((resolve, reject) => {
          const timer = setTimeout(
            () => this.fail(child, new Error(`Local encoder request exceeded ${timeout} ms.`)),
            timeout
          );
          this.pending = {
            id,
            resolve: value => {
              clearTimeout(timer);
              resolve(value);
            },
            reject: error => {
              clearTimeout(timer);
              reject(error);
            },
          };
          child.stdin.write(JSON.stringify({ id, operation, ...args }) + '\n', error => {
            if (error) this.fail(child, error);
          });
        });
      } finally {
        if (this.child === child) {
          this.references(child, false);
          if (this.idleTimeoutMs > 0) {
            this.idleTimer = setTimeout(() => {
              if (this.child === child && !this.pending)
                this.fail(child, new Error('Local encoder unloaded after idle timeout.'));
            }, this.idleTimeoutMs);
            this.idleTimer.unref();
          }
        }
      }
    });
    this.queue = next.catch(() => undefined);
    return next;
  }

  async planChunks(content: string, filePath: string): Promise<PlannedEmbeddingChunk[]> {
    return this.request('plan', { content: content.replace(/\r\n/g, '\n'), path: filePath });
  }

  private async encode(texts: string[], query: boolean): Promise<EmbeddingResult[]> {
    const results: EmbeddingResult[] = [];
    if (texts.some(text => typeof text !== 'string' || !text.trim()))
      throw new Error('Local encoder inputs must be nonempty strings.');
    const batchSize = query ? 1 : 8;
    for (let offset = 0; offset < texts.length; offset += batchSize) {
      const batch = texts.slice(offset, offset + batchSize);
      const response = await this.request<{ vectors: number[][]; revision: string }>('encode', {
        texts: batch,
        query,
      });
      if (
        response.revision !== this.profile.revision ||
        response.vectors.length !== batch.length ||
        response.vectors.some(
          vector =>
            vector.length !== 512 ||
            vector.some(value => !Number.isFinite(value)) ||
            Math.abs(Math.hypot(...vector) - 1) > 0.001
        )
      ) {
        throw new Error('Local encoder returned incompatible vectors.');
      }
      results.push(
        ...response.vectors.map(embedding => ({
          embedding,
          model: this.profile.provider,
          dimensions: 512,
        }))
      );
    }
    return results;
  }

  generateEmbeddings(texts: string[]): Promise<EmbeddingResult[]> {
    return this.encode(texts, false);
  }
  async generateEmbedding(text: string): Promise<EmbeddingResult> {
    return (await this.encode([text], false))[0];
  }
  async generateQueryEmbedding(text: string): Promise<EmbeddingResult> {
    return (await this.encode([text], true))[0];
  }
  getModelInfo() {
    return {
      name: this.profile.provider,
      provider: 'local-python',
      dimensions: 512,
      maxLength: 512,
      offline: true,
    };
  }
  getCacheIdentity(): string {
    return this.profile.identity;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    process.removeListener('exit', this.exitHandler);
    if (this.child) this.fail(this.child, new Error('Local encoder disposed.'));
  }
}
