import * as fs from 'fs';
import * as path from 'path';
import { globby } from 'globby';
import { AutomaticIndexer } from '../automaticIndexer';
import { ProjectIdentifier, loadIgnorePatterns } from '../projectIdentifier';
import { TreeSitterProcessor } from '../treeSitterProcessor';
import { LocalEmbeddingGenerator } from '../embeddingGenerator';
import { apiClient } from '../../client/apiClient';
import { logger } from '../../utils/logger';

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn(),
  statSync: jest.fn(),
  readFileSync: jest.fn(),
  watch: jest.fn(),
  rmSync: jest.fn(),
}));
jest.mock('globby', () => ({ globby: jest.fn() }));
jest.mock('../../client/apiClient', () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));
jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../projectIdentifier', () => {
  const instance = { identifyProject: jest.fn() };
  return { ProjectIdentifier: { getInstance: () => instance }, loadIgnorePatterns: jest.fn() };
});
jest.mock('../treeSitterProcessor', () => ({ TreeSitterProcessor: jest.fn() }));
jest.mock('../projectManager', () => ({ LocalProjectManager: jest.fn() }));
jest.mock('../embeddingGenerator', () => ({ LocalEmbeddingGenerator: jest.fn() }));

const PROJECT = path.resolve('/test/project');
const project = ProjectIdentifier.getInstance() as any;
const parse = jest.fn(),
  generate = jest.fn(),
  update = jest.fn();
const watch = fs.watch as jest.Mock,
  glob = globby as jest.Mock,
  api = apiClient as any;
const originalKey = process.env.AMBIANCE_API_KEY;

describe('AutomaticIndexer', () => {
  let indexer: AutomaticIndexer;
  beforeEach(() => {
    jest.resetAllMocks();
    jest.useFakeTimers();
    process.env.AMBIANCE_API_KEY = 'unit-fixture-key';
    (fs.existsSync as jest.Mock).mockImplementation(
      file => !path.basename(String(file)).startsWith('.')
    );
    (fs.statSync as jest.Mock).mockReturnValue({
      isFile: () => true,
      isDirectory: () => false,
      size: 30,
      mtime: new Date(),
    });
    (fs.readFileSync as jest.Mock).mockReturnValue('export const value = 1;');
    glob.mockResolvedValue(['src/index.ts', 'src/utils.ts', 'src/types.ts']);
    (loadIgnorePatterns as jest.Mock).mockResolvedValue(['node_modules/**', 'dist/**']);
    project.identifyProject.mockResolvedValue({
      id: 'test-project',
      path: PROJECT,
      name: 'fixture',
      type: 'local',
    });
    parse.mockResolvedValue({ chunks: [{}], symbols: [{}] });
    (TreeSitterProcessor as jest.Mock).mockImplementation(() => ({ parseAndChunk: parse }));
    generate.mockResolvedValue({ embeddings: 3, totalChunks: 3, processedFiles: 3, errors: [] });
    update.mockResolvedValue({ processedFiles: 1, embeddings: 1, totalChunks: 1, errors: [] });
    (LocalEmbeddingGenerator as jest.Mock).mockImplementation(() => ({
      generateProjectEmbeddings: generate,
      updateProjectEmbeddings: update,
    }));
    api.get.mockImplementation(async (endpoint: string) =>
      endpoint === '/health' ? { status: 'ok' } : { hash: null }
    );
    api.post.mockResolvedValue({ success: true });
    api.delete.mockResolvedValue({ success: true });
    watch.mockReturnValue({ close: jest.fn() });
    (AutomaticIndexer as any).instance = undefined;
    indexer = AutomaticIndexer.getInstance();
  });
  afterEach(async () => {
    for (const key of (indexer as any).watchedProjects.keys()) await indexer.stopWatching(key);
    jest.useRealTimers();
    if (originalKey === undefined) delete process.env.AMBIANCE_API_KEY;
    else process.env.AMBIANCE_API_KEY = originalKey;
  });
  async function emit() {
    await watch.mock.calls[0][2]('change', 'src/index.ts');
  }
  it('returns the singleton', () => expect(AutomaticIndexer.getInstance()).toBe(indexer));
  it('detects a project and indexes it', async () => {
    const session = await indexer.autoDetectAndIndex(PROJECT);
    expect(project.identifyProject).toHaveBeenCalledWith(PROJECT);
    expect(session?.status).toBe('completed');
    expect(session?.filesProcessed).toBe(3);
  });
  it('does not parse when project detection returns null', async () => {
    project.identifyProject.mockResolvedValue(null);
    expect(await indexer.autoDetectAndIndex(PROJECT)).toBeNull();
    expect(parse).not.toHaveBeenCalled();
  });
  it('handles detection errors', async () => {
    project.identifyProject.mockRejectedValue(new Error('Detection failed'));
    expect(await indexer.autoDetectAndIndex(PROJECT)).toBeNull();
    expect(logger.error).toHaveBeenCalledWith('Auto-detection failed:', expect.any(Error));
  });
  it('indexes discovered files and records parsed chunks', async () => {
    const session = await indexer.indexProject(PROJECT);
    expect(session.status).toBe('completed');
    expect(session.filesProcessed).toBe(3);
    expect(session.chunksCreated).toBe(3);
    expect(parse).toHaveBeenCalledWith(
      expect.any(String),
      'typescript',
      path.join(PROJECT, 'src/index.ts')
    );
  });
  it('force processes all files even with matching local hashes', async () => {
    await indexer.indexProject(PROJECT, { skipCloud: true });
    parse.mockClear();
    await indexer.indexProject(PROJECT, { force: true, skipCloud: true });
    expect(parse).toHaveBeenCalledTimes(3);
  });
  it('skipCloud performs no cloud health, hash or upload requests', async () => {
    await indexer.indexProject(PROJECT, { skipCloud: true });
    expect(api.get).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
    expect(generate).toHaveBeenCalled();
  });
  it('passes the requested discovery pattern', async () => {
    await indexer.indexProject(PROJECT, { pattern: '*.ts' });
    expect(glob).toHaveBeenCalledWith(['*.ts'], expect.objectContaining({ cwd: PROJECT }));
  });
  it('continues locally when the cloud API fails', async () => {
    api.post.mockRejectedValue(new Error('API Error'));
    const session = await indexer.indexProject(PROJECT);
    expect(session.status).toBe('completed');
    expect(session.errors).toContain('Cloud API unavailable - continuing with local indexing');
    expect(generate).toHaveBeenCalled();
  });
  it('continues past an individual parse failure and retains the error', async () => {
    parse.mockRejectedValueOnce(new Error('Parse error'));
    const session = await indexer.indexProject(PROJECT);
    expect(session.filesProcessed).toBe(2);
    expect(session.errors.some(error => error.includes('Parse error'))).toBe(true);
    expect(parse).toHaveBeenCalledTimes(3);
  });
  it('fails visibly on returned inference errors and retries unchanged source', async () => {
    generate.mockResolvedValueOnce({
      embeddings: 0,
      totalChunks: 3,
      processedFiles: 3,
      errors: ['Inference failed'],
    });
    await expect(indexer.indexProject(PROJECT, { skipCloud: true })).rejects.toThrow(
      'Inference failed'
    );
    expect(indexer.getActiveSessions()[0].status).toBe('failed');
    parse.mockClear();
    expect((await indexer.indexProject(PROJECT, { skipCloud: true })).status).toBe('completed');
    expect(parse).toHaveBeenCalledTimes(3);
  });
  it('resets indexes through the API', async () => {
    expect(await indexer.resetProjectIndexes(PROJECT)).toBe(true);
    expect(api.post).toHaveBeenCalledWith('/v1/local-projects/reset', { projectPath: PROJECT });
  });
  it('reports a reset API failure', async () => {
    api.post.mockRejectedValue(new Error('Reset failed'));
    expect(await indexer.resetProjectIndexes(PROJECT)).toBe(false);
  });
  it('registers a recursive watcher', async () => {
    await indexer.startWatching(PROJECT);
    expect(watch).toHaveBeenCalledWith(PROJECT, { recursive: true }, expect.any(Function));
    expect((indexer as any).watchedProjects.size).toBe(1);
  });
  it('does not register a watcher after startup failure', async () => {
    watch.mockImplementation(() => {
      throw new Error('Watch failed');
    });
    await expect(indexer.startWatching(PROJECT)).rejects.toThrow('Watch failed');
    expect((indexer as any).watchedProjects.size).toBe(0);
  });
  it('closes the watcher and periodic interval', async () => {
    await indexer.startWatching(PROJECT);
    const watcher = watch.mock.results[0].value;
    await indexer.stopWatching(PROJECT);
    expect(watcher.close).toHaveBeenCalled();
    expect((indexer as any).staleCheckIntervals.size).toBe(0);
  });
  it('stopping an absent watcher is idempotent', async () => {
    await expect(indexer.stopWatching(PROJECT)).resolves.toBeUndefined();
  });
  it('cancels pending updates when watching stops', async () => {
    await indexer.startWatching(PROJECT, { debounceMs: 100 });
    (fs.readFileSync as jest.Mock).mockReturnValue('edited');
    await emit();
    await indexer.stopWatching(PROJECT);
    await jest.advanceTimersByTimeAsync(101);
    expect(update).not.toHaveBeenCalled();
  });
  it('retrieves a session by id', async () => {
    const session = await indexer.indexProject(PROJECT);
    expect(indexer.getSession(session.id)).toBe(session);
  });
  it('returns undefined for an absent session', () =>
    expect(indexer.getSession('absent')).toBeUndefined());
  it('lists multiple sessions', async () => {
    const a = await indexer.indexProject(PROJECT),
      b = await indexer.indexProject(PROJECT);
    expect(indexer.getActiveSessions()).toEqual([a, b]);
  });
  it('starts without sessions', () => expect(indexer.getActiveSessions()).toEqual([]));
  it('debounces repeated changes into one update', async () => {
    await indexer.startWatching(PROJECT, { debounceMs: 100 });
    (fs.readFileSync as jest.Mock).mockReturnValue('edited');
    await emit();
    await emit();
    await jest.advanceTimersByTimeAsync(99);
    expect(update).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(update).toHaveBeenCalledTimes(1);
  });
  it('updates only the changed file', async () => {
    await indexer.startWatching(PROJECT, { debounceMs: 100 });
    (fs.readFileSync as jest.Mock).mockReturnValue('edited');
    await emit();
    await jest.advanceTimersByTimeAsync(100);
    expect(update).toHaveBeenCalledWith(
      'test-project',
      PROJECT,
      expect.objectContaining({ files: ['src/index.ts'] })
    );
  });
  it('retries the same source after a failed incremental update', async () => {
    await indexer.startWatching(PROJECT, { debounceMs: 100 });
    update.mockResolvedValueOnce({ errors: ['Inference failed'] });
    (fs.readFileSync as jest.Mock).mockReturnValue('edited');
    await emit();
    await jest.advanceTimersByTimeAsync(100);
    await emit();
    await jest.advanceTimersByTimeAsync(100);
    expect(update).toHaveBeenCalledTimes(2);
  });
  it('filters discovered build output and dependencies', async () => {
    glob.mockResolvedValue(['src/index.ts', 'node_modules/bad.ts', 'dist/bad.ts']);
    const session = await indexer.indexProject(PROJECT);
    expect(session.filesFound).toBe(1);
    expect(parse).toHaveBeenCalledTimes(1);
  });
  it('unchanged local files require neither parsing nor inference', async () => {
    await indexer.indexProject(PROJECT, { skipCloud: true });
    parse.mockClear();
    generate.mockClear();
    const session = await indexer.indexProject(PROJECT, { skipCloud: true });
    expect(session.filesProcessed).toBe(0);
    expect(parse).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });
  it('serializes three queued updates and recovers after a failure', async () => {
    let release!: () => void;
    let failSecond!: () => void;
    const started: number[] = [];
    const first = (indexer as any).queueProcessing(
      PROJECT,
      () =>
        new Promise<void>(resolve => {
          started.push(1);
          release = resolve;
        })
    );
    const second = (indexer as any).queueProcessing(
      PROJECT,
      () =>
        new Promise<void>((resolve, reject) => {
          started.push(2);
          failSecond = () => reject(new Error('Failed'));
        })
    );
    const secondHandled = expect(second).rejects.toThrow('Failed');
    const third = (indexer as any).queueProcessing(PROJECT, async () => {
      started.push(3);
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toEqual([1]);
    release();
    await first;
    await Promise.resolve();
    await Promise.resolve();
    const beforeSecondFinished = [...started];
    failSecond();
    await secondHandled;
    await third;
    expect(beforeSecondFinished).toEqual([1, 2]);
    expect(started).toEqual([1, 2, 3]);
    expect((indexer as any).processingQueue.size).toBe(0);
  });
});
