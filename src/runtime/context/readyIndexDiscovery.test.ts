import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import { LocalEmbeddingStorage } from '../../local/embeddingStorage';
import { LocalEmbeddingProvider } from '../../local/localEmbeddingProvider';
import { ProjectIdentifier } from '../../local/projectIdentifier';
import { queryReadyIndex, queryReadyIndexBatch } from './readyIndexDiscovery';
import Database from 'better-sqlite3';

jest.mock('../embeddings/indexableFiles', () => ({
  discoverIndexableProjectFiles: async () => ['a.ts', 'b.ts'],
}));
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const vector = (a: number, b: number) => [a, b, ...Array(382).fill(0)];
let base: string, projectPath: string, storagePath: string, oldStorage: string | undefined;
let embedding: jest.SpyInstance;
beforeEach(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), 'ready-index-test-'));
  projectPath = path.join(base, 'project');
  storagePath = path.join(base, 'storage');
  await fs.mkdir(projectPath);
  await fs.writeFile(path.join(projectPath, 'package.json'), '{}');
  await fs.writeFile(path.join(projectPath, 'a.ts'), 'export function alpha() {}\n');
  await fs.writeFile(path.join(projectPath, 'b.ts'), 'export function beta() {}\n');
  oldStorage = process.env.LOCAL_STORAGE_PATH;
  process.env.LOCAL_STORAGE_PATH = storagePath;
  embedding = jest
    .spyOn(LocalEmbeddingProvider.prototype, 'generateEmbedding')
    .mockResolvedValue({ embedding: vector(1, 0), model: 'all-MiniLM-L6-v2', dimensions: 384 });
});
afterEach(async () => {
  embedding.mockRestore();
  if (oldStorage === undefined) delete process.env.LOCAL_STORAGE_PATH;
  else process.env.LOCAL_STORAGE_PATH = oldStorage;
  await fs.rm(base, { recursive: true, force: true });
});
async function seed() {
  const project = await ProjectIdentifier.getInstance().identifyProject(projectPath);
  const storage = new LocalEmbeddingStorage();
  const date = new Date();
  await storage.registerProject({
    id: project.id,
    name: 'fixture',
    path: project.path,
    type: 'local',
    workspaceRoot: project.workspaceRoot,
    addedAt: date,
    updatedAt: date,
  });
  for (const [index, file] of ['a.ts', 'b.ts'].entries()) {
    const content = await fs.readFile(path.join(projectPath, file), 'utf8');
    const fileId = `f${index}`;
    await storage.storeFileMetadata({
      id: fileId,
      projectId: project.id,
      path: file,
      hash: hash(content),
      lastModified: date,
      fileSize: content.length,
      lineCount: content.split('\n').length,
      chunkLayoutVersion: 3,
      createdAt: date,
      updatedAt: date,
    });
    await storage.storeEmbedding({
      id: `e${index}`,
      projectId: project.id,
      fileId,
      filePath: file,
      chunkIndex: 0,
      content,
      embedding: index === 0 ? vector(1, 0) : vector(0.8, 0.6),
      metadata: {
        type: 'code',
        startLine: 1,
        endLine: 1,
        embeddingDimensions: 384,
        embeddingProvider: 'all-MiniLM-L6-v2',
      },
      hash: hash(content),
      createdAt: date,
      updatedAt: date,
    });
  }
  await storage.close();
}
const request = () => ({
  projectPath,
  query: 'implementation',
  scopeFiles: ['a.ts', 'b.ts'],
  maxResults: 10,
});
test('missing index does not create a database or generate a query', async () => {
  expect((await queryReadyIndex(request())).status).toBe('unavailable');
  expect(embedding).not.toHaveBeenCalled();
  await expect(fs.stat(path.join(storagePath, 'embeddings.db'))).rejects.toThrow();
});
test('uses real index ranking, respects scope, and leaves the index unchanged', async () => {
  await seed();
  const db = path.join(storagePath, 'embeddings.db');
  const before = hash((await fs.readFile(db)).toString('base64'));
  const result = await queryReadyIndex({ ...request(), scopeFiles: ['b.ts'] });
  expect(result.status).toBe('ready');
  expect(result.matches.map(match => match.file)).toEqual(['b.ts']);
  expect(result.matches[0].sourceHash).toBe(hash('export function beta() {}\n'));
  expect(hash((await fs.readFile(db)).toString('base64'))).toBe(before);
});
test('changed source falls back before inference; another scope remains available', async () => {
  await seed();
  await fs.writeFile(path.join(projectPath, 'a.ts'), 'export function modified() {}\n');
  expect((await queryReadyIndex(request())).status).toBe('stale');
  expect(embedding).not.toHaveBeenCalled();
  expect((await queryReadyIndex({ ...request(), scopeFiles: ['b.ts'] })).status).toBe('ready');
});
test('unavailable cached model reports fallback', async () => {
  await seed();
  embedding.mockRejectedValue(new Error('model unavailable offline'));
  const result = await queryReadyIndex(request());
  expect(result.status).toBe('unavailable');
  expect(result.reason).toContain('model unavailable offline');
});

test('obsolete layouts and missing interior chunks are stale', async () => {
  await seed();
  let db = new Database(path.join(storagePath, 'embeddings.db'));
  db.prepare('UPDATE files SET chunk_layout_version = 2 WHERE path = ?').run('a.ts');
  db.close();
  expect((await queryReadyIndex(request())).status).toBe('stale');
  db = new Database(path.join(storagePath, 'embeddings.db'));
  db.prepare('UPDATE files SET chunk_layout_version = 3 WHERE path = ?').run('a.ts');
  db.prepare('UPDATE embeddings SET chunk_index = 1 WHERE file_path = ?').run('a.ts');
  db.close();
  expect((await queryReadyIndex(request())).status).toBe('stale');
  expect(embedding).not.toHaveBeenCalled();
});
test('deleted indexed source is stale only within its scope', async () => {
  await seed();
  await fs.unlink(path.join(projectPath, 'a.ts'));
  expect((await queryReadyIndex({ ...request(), scopeFiles: ['b.ts'] })).status).toBe('stale');
  expect(
    (await queryReadyIndex({ ...request(), scope: 'b.ts', scopeFiles: ['b.ts'] })).status
  ).toBe('ready');
});
test('batch reuses index and returns a result for each query', async () => {
  await seed();
  const results = await queryReadyIndexBatch({ ...request(), queries: ['first', 'second'] });
  expect(results.map(result => result.status)).toEqual(['ready', 'ready']);
  expect(embedding).toHaveBeenCalledTimes(2);
});
