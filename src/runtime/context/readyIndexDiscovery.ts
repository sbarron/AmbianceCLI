/** Read an already-built local index without creating, repairing, or downloading anything. */
import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';
import { LocalEmbeddingStorage } from '../../local/embeddingStorage';
import { LocalEmbeddingProvider, LocalEmbeddingConfig } from '../../local/localEmbeddingProvider';
import { ProjectIdentifier, normalizePathForId } from '../../local/projectIdentifier';
import { discoverIndexableProjectFiles } from '../embeddings/indexableFiles';
import { EMBEDDING_CHUNK_LAYOUT_VERSION } from '../../local/embeddingDefaults';

export interface ReadyIndexMatch {
  file: string;
  startLine: number;
  endLine: number;
  sourceHash: string;
  similarity: number;
  semanticRank: number;
}
export interface ReadyIndexResult {
  status: 'ready' | 'unavailable' | 'stale';
  reason?: string;
  matches: ReadyIndexMatch[];
}
export interface ReadyIndexRequest {
  projectPath: string;
  query: string;
  scopeFiles: string[];
  scope?: string;
  maxResults: number;
}
const posix = (s: string) => s.replace(/\\/g, '/');
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
const providers = new Map<string, LocalEmbeddingProvider>();
const fail = (status: 'unavailable' | 'stale', reason: string): ReadyIndexResult => ({
  status,
  reason,
  matches: [],
});

export async function queryReadyIndex(args: ReadyIndexRequest): Promise<ReadyIndexResult> {
  return (await queryReadyIndexBatch({ ...args, queries: [args.query] }))[0];
}

export async function queryReadyIndexBatch(
  args: Omit<ReadyIndexRequest, 'query'> & { queries: string[] }
): Promise<ReadyIndexResult[]> {
  const results = await queryReadyIndexBatchInternal(args);
  return Array.isArray(results) ? results : args.queries.map(() => results);
}

async function queryReadyIndexBatchInternal(
  args: Omit<ReadyIndexRequest, 'query'> & { queries: string[] }
): Promise<ReadyIndexResult | ReadyIndexResult[]> {
  const storage = new LocalEmbeddingStorage(undefined, undefined, { readOnly: true });
  try {
    const root = await fs.realpath(path.resolve(args.projectPath));
    const project = await ProjectIdentifier.getInstance().identifyProject(root);
    await storage.initializeDatabase();
    const indexedProject = await storage.getProject(project.id);
    if (!indexedProject || normalizePathForId(indexedProject.path) !== normalizePathForId(root))
      return fail('unavailable', 'No index for this exact project path');
    const chunks = await storage.getProjectEmbeddings(project.id);
    if (!chunks.length) return fail('unavailable', 'The project index contains no embeddings');
    const models = new Set(chunks.map(chunk => chunk.metadata.embeddingProvider));
    const supported: LocalEmbeddingConfig['model'][] = [
      'all-MiniLM-L6-v2',
      'all-mpnet-base-v2',
      'multilingual-e5-large',
      'advanced-neural-dense',
    ];
    if (models.size !== 1 || !supported.includes([...models][0] as LocalEmbeddingConfig['model']))
      return fail('unavailable', 'The index does not identify one supported local model');
    const model = [...models][0] as LocalEmbeddingConfig['model'];
    let provider = providers.get(model!);
    if (!provider) {
      provider = new LocalEmbeddingProvider({ model, localFilesOnly: true });
      providers.set(model!, provider);
    }
    const dimensions = provider.getModelInfo().dimensions;
    if (chunks.some(chunk => chunk.metadata.embeddingDimensions !== dimensions))
      return fail('unavailable', 'Index embeddings do not match the local model dimensions');

    const allowed = new Set(args.scopeFiles.map(posix));
    const records = await storage.listProjectFiles(project.id);
    const byPath = new Map(records.map(record => [posix(record.path), record]));
    const byId = new Map(records.map(record => [record.id, record]));
    const indexedFiles = new Set(chunks.map(chunk => chunk.fileId));
    const scope = args.scope ? posix(path.relative(root, path.resolve(root, args.scope))) : '';
    if (scope === '..' || scope.startsWith('../') || path.isAbsolute(scope))
      return fail('unavailable', 'Search scope leaves the project');
    for (const record of records) {
      const file = posix(record.path);
      if (scope && file !== scope && !file.startsWith(scope + '/')) continue;
      const relative = path.relative(root, path.resolve(root, file));
      if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative))
        return fail('stale', 'Index file metadata leaves the project');
      try {
        await fs.stat(path.resolve(root, file));
      } catch (error: any) {
        if (error.code === 'ENOENT' || error.code === 'ENOTDIR')
          return fail('stale', 'An indexed source file was deleted in the requested scope');
        throw error;
      }
    }
    const chunksByFile = new Map<string, typeof chunks>();
    for (const chunk of chunks) {
      const fileChunks = chunksByFile.get(chunk.fileId) || [];
      fileChunks.push(chunk);
      chunksByFile.set(chunk.fileId, fileChunks);
    }
    function validLayout(fileId: string): boolean {
      const record = byId.get(fileId);
      const fileChunks = chunksByFile.get(fileId);
      if (
        !record ||
        record.chunkLayoutVersion !== EMBEDDING_CHUNK_LAYOUT_VERSION ||
        !fileChunks?.length
      )
        return false;
      const indexes = fileChunks.map(chunk => chunk.chunkIndex).sort((a, b) => a - b);
      return (
        indexes.every((index, i) => index === i) &&
        fileChunks.every(
          chunk =>
            Number.isInteger(chunk.metadata.startLine) &&
            Number.isInteger(chunk.metadata.endLine) &&
            chunk.metadata.startLine! >= 1 &&
            chunk.metadata.endLine! >= chunk.metadata.startLine! &&
            !!record.lineCount &&
            chunk.metadata.endLine! <= record.lineCount
        )
      );
    }
    const required = (await discoverIndexableProjectFiles(root))
      .map(posix)
      .filter(file => allowed.has(file));
    const sourceHashes = new Map<string, string>();
    for (const file of required) {
      const record = byPath.get(file);
      if (!record || !indexedFiles.has(record.id))
        return fail('stale', 'The index is missing source in the requested scope');
      if (!validLayout(record.id))
        return fail('stale', 'Indexed chunk layout is obsolete or incomplete');
      const absolute = await fs.realpath(path.resolve(root, file));
      const relative = path.relative(root, absolute);
      if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative))
        return fail('stale', 'An indexed source file leaves the project');
      const current = digest(await fs.readFile(absolute, 'utf8'));
      if (current !== record.hash)
        return fail('stale', 'Indexed source has changed in the requested scope');
      sourceHashes.set(file, current);
    }
    // Some indexed files are excluded from the lifecycle's indexable set. Check
    // every result candidate independently and never trust index paths as scope.
    for (const chunk of chunks) {
      const file = posix(chunk.filePath);
      if (!allowed.has(file) || sourceHashes.has(file)) continue;
      const record = byId.get(chunk.fileId);
      if (!record || posix(record.path) !== file)
        return fail('stale', 'Index file metadata is inconsistent');
      if (!validLayout(record.id))
        return fail('stale', 'Indexed chunk layout is obsolete or incomplete');
      const absolute = await fs.realpath(path.resolve(root, file));
      const relative = path.relative(root, absolute);
      if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative))
        return fail('stale', 'An indexed source file leaves the project');
      const current = digest(await fs.readFile(absolute, 'utf8'));
      if (current !== record.hash)
        return fail('stale', 'Indexed source has changed in the requested scope');
      sourceHashes.set(file, current);
    }
    if (!sourceHashes.size) return args.queries.map(() => ({ status: 'ready', matches: [] }));
    const results: ReadyIndexResult[] = [];
    for (const query of args.queries) {
      try {
        const queryEmbedding = (await provider.generateEmbedding(query)).embedding;
        if (
          queryEmbedding.length !== dimensions ||
          queryEmbedding.some(value => !Number.isFinite(value))
        ) {
          results.push(fail('unavailable', 'The local query embedding is invalid'));
          continue;
        }
        // Reuse the already loaded matrix, then filter scope so outside chunks
        // cannot crowd scoped matches out of the ranked pool.
        const similar = await storage.searchSimilarEmbeddings(
          project.id,
          queryEmbedding,
          chunks.length,
          0,
          chunks
        );
        const matches: ReadyIndexMatch[] = [];
        const seenRanges = new Set<string>();
        for (const { chunk, similarity } of similar) {
          const file = posix(chunk.filePath);
          const record = byId.get(chunk.fileId);
          const sourceHash = sourceHashes.get(file);
          const startLine = chunk.metadata.startLine;
          const endLine = chunk.metadata.endLine;
          if (
            !sourceHash ||
            !record ||
            posix(record.path) !== file ||
            !Number.isFinite(similarity) ||
            !Number.isInteger(startLine) ||
            !Number.isInteger(endLine) ||
            startLine! < 1 ||
            endLine! < startLine!
          )
            continue;
          const rangeKey = `${file}\0${startLine}\0${endLine}`;
          if (seenRanges.has(rangeKey)) continue;
          seenRanges.add(rangeKey);
          matches.push({
            file,
            startLine: startLine!,
            endLine: endLine!,
            sourceHash,
            similarity,
            semanticRank: matches.length + 1,
          });
          if (matches.length >= args.maxResults) break;
        }
        results.push({ status: 'ready', matches });
      } catch (error) {
        results.push(
          fail(
            'unavailable',
            `Ready local index unavailable: ${error instanceof Error ? error.message : String(error)}`
          )
        );
      }
    }
    return results;
  } catch (error) {
    return fail(
      'unavailable',
      `Ready local index unavailable: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    await storage.close();
  }
}
