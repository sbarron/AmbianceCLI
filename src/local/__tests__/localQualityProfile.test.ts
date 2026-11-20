import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { LocalEmbeddingStorage, type EmbeddingChunk, type FileMetadata } from '../embeddingStorage';
import { getLocalRetrievalProfile } from '../localRetrievalProfile';
import { CodeLexicalIndex, retrieveLocalHybrid } from '../localHybridRetrieval';

describe('optional local quality profile', () => {
  const original = { ...process.env };
  let folder: string;
  let storage: LocalEmbeddingStorage;
  beforeEach(() => {
    folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ambiance-quality-'));
    process.env.AMBIANCE_LOCAL_PROFILE = 'qwen3';
    process.env.LOCAL_STORAGE_PATH = folder;
    process.env.USE_LOCAL_EMBEDDINGS = 'true';
  });
  afterEach(async () => {
    await storage?.close();
    process.env = { ...original };
    const absolute = path.resolve(folder);
    if (
      !absolute.startsWith(path.resolve(os.tmpdir()) + path.sep) ||
      !path.basename(absolute).startsWith('ambiance-quality-')
    )
      throw new Error('Unsafe test cleanup path');
    fs.rmSync(absolute, { recursive: true, force: true });
  });

  const file = (): FileMetadata => ({
    id: 'file',
    projectId: 'project',
    path: 'src/example.ts',
    hash: 'old',
    lastModified: new Date(),
    fileSize: 10,
    lineCount: 2,
    chunkLayoutVersion: 3,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const chunk = (id: string, content: string): EmbeddingChunk => ({
    id,
    projectId: 'project',
    fileId: 'file',
    filePath: 'src/example.ts',
    chunkIndex: Number(id) || 0,
    content,
    hash: content,
    embedding: Array(512).fill(1 / Math.sqrt(512)),
    metadata: {
      type: 'code',
      startLine: 1,
      endLine: 1,
      embeddingDimensions: 512,
      embeddingProvider: getLocalRetrievalProfile()!.provider,
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  test('isolates its database and enforces the selected codec', async () => {
    fs.writeFileSync(path.join(folder, 'embeddings.db'), 'legacy sentinel');
    storage = new LocalEmbeddingStorage();
    await storage.initializeDatabase();
    const actual = (storage as any).dbPath;
    expect(actual).toContain(getLocalRetrievalProfile()!.storageKey);
    expect(fs.readFileSync(path.join(folder, 'embeddings.db'), 'utf8')).toBe('legacy sentinel');
    expect(storage.getQuantizationMode()).toBe('turbo4');
    expect(() => storage.setQuantizationMode('turbo2')).toThrow('requires turbo4');
    expect(() => storage.setTurboRotationSeed(99)).toThrow('seed 42');
  });

  test('rolls back source, vectors and freshness when a replacement write fails', async () => {
    storage = new LocalEmbeddingStorage();
    await storage.registerProject({
      id: 'project',
      name: 'test',
      path: folder,
      type: 'local',
      workspaceRoot: folder,
      addedAt: new Date(),
      updatedAt: new Date(),
    });
    await storage.replaceQualityFile(file(), [chunk('0', 'original')]);
    (storage as any).db.exec(
      "CREATE TRIGGER reject_source BEFORE INSERT ON embeddings WHEN NEW.content = 'reject' BEGIN SELECT RAISE(ABORT, 'injected write failure'); END;"
    );
    await expect(
      storage.replaceQualityFile({ ...file(), hash: 'new' }, [
        chunk('1', 'replacement'),
        chunk('2', 'reject'),
      ])
    ).rejects.toMatchObject({
      code: 'SQLITE_CONSTRAINT_TRIGGER',
      message: 'injected write failure',
    });
    const values = await storage.getProjectEmbeddings('project');
    expect(values.map(value => value.content)).toEqual(['original']);
    expect(
      (storage as any).db.prepare('SELECT hash FROM files WHERE id = ?').get('file').hash
    ).toBe('old');
    expect(values[0].metadata.embeddingFormat).toBe('turbo4');
  });

  test('lexical postings split code identifiers and rank deterministically', () => {
    const first = { ...chunk('1', 'function releaseHeldParcel() {}'), filePath: 'src/parcel.ts' };
    const second = { ...chunk('2', 'function renderInvoice() {}'), filePath: 'src/invoice.ts' };
    const index = new CodeLexicalIndex([second, first]);
    expect(index.search('release held parcel').map(value => value.id)).toEqual(['1']);
    expect(index.search('unrelated')).toEqual([]);
  });

  test('indexes requested test evidence using the same policy as freshness scans', async () => {
    fs.mkdirSync(path.join(folder, 'tests'));
    fs.mkdirSync(path.join(folder, 'dist'));
    fs.writeFileSync(
      path.join(folder, 'tests/parcel.test.ts'),
      'export const deniedRelease = true;'
    );
    fs.writeFileSync(path.join(folder, 'dist/generated.ts'), 'export const generated = true;');
    const { globby } = require('globby');
    globby.mockResolvedValueOnce(['tests/parcel.test.ts', 'dist/generated.ts']);
    const { discoverIndexableProjectFiles } = await import(
      '../../runtime/embeddings/indexableFiles'
    );
    expect(
      (await discoverIndexableProjectFiles(folder)).map(file => file.replace(/\\/g, '/'))
    ).toEqual(['tests/parcel.test.ts']);
  });

  test('invalidates lexical cache after a same-count source edit', async () => {
    const fakeVector = {
      data: new Uint8Array(256),
      dimensions: 512,
      bits: 4,
      rotationSeed: 42,
      norm: 1,
    };
    let values: EmbeddingChunk[] = [{ ...chunk('1', 'firstAlpha'), embedding: fakeVector as any }];
    const mock = {
      getProjectEmbeddings: async () => values,
      searchSimilarEmbeddings: async () => [],
    };
    expect(
      (await retrieveLocalHybrid(mock as any, 'project', 'zephyrNeedle', Array(512).fill(0))).chunks
    ).toEqual([]);
    values = [{ ...values[0], content: 'zephyrNeedle', hash: 'changed' }];
    expect(
      (
        await retrieveLocalHybrid(mock as any, 'project', 'zephyrNeedle', Array(512).fill(0))
      ).chunks.map(value => value.chunk.id)
    ).toEqual(['1']);
    values = [];
    expect(
      (await retrieveLocalHybrid(mock as any, 'project', 'zephyrNeedle', Array(512).fill(0))).chunks
    ).toEqual([]);
  });
});
