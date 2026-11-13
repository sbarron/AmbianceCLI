import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { LocalEmbeddingGenerator } from '../embeddingGenerator';
import { LocalEmbeddingStorage } from '../embeddingStorage';
import { EMBEDDING_CHUNK_LAYOUT_VERSION } from '../embeddingDefaults';
import { getDefaultLocalProvider } from '../localEmbeddingProvider';

jest.mock('../localEmbeddingProvider');
jest.mock('../../core/openaiService', () => ({ openaiService: { isReady: () => false } }));
jest.mock('../../client/apiClient', () => ({ apiClient: {} }));
jest.mock('../../utils/logger', () => ({
  logger: { info() {}, debug() {}, warn() {}, error() {} },
}));

describe('AST chunk storage IDs', () => {
  let root: string, storage: LocalEmbeddingStorage, generator: any, file: string;
  const previousLocal = process.env.USE_LOCAL_EMBEDDINGS;
  const previousOpenAI = process.env.USE_OPENAI_EMBEDDINGS;
  beforeEach(async () => {
    process.env.USE_LOCAL_EMBEDDINGS = 'true';
    process.env.USE_OPENAI_EMBEDDINGS = 'false';
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ambiance-chunk-ids-'));
    file = path.join(root, 'fixture.ts');
    const long = Array.from({ length: 18 }, (_, i) => `statement_${i} with enough content`).join(
      '\n'
    );
    fs.writeFileSync(file, `small\n\n${long}\n\nlast\n`);
    storage = new LocalEmbeddingStorage(path.join(root, 'db'), false);
    await storage.registerProject({
      id: 'fixture',
      name: 'fixture',
      path: root,
      type: 'local',
      workspaceRoot: root,
      addedAt: new Date(),
      updatedAt: new Date(),
    });
    (getDefaultLocalProvider as jest.Mock).mockReturnValue({
      getCacheIdentity: () => 'fixture-model',
      getModelInfo: () => ({ name: 'fixture-model', dimensions: 3 }),
    });
    generator = new LocalEmbeddingGenerator(storage);
    generator.getCurrentProvider = () => 'local';
    generator.treeSitter = {
      parseAndChunk: async () => ({
        chunks: [
          { content: long, startLine: 3, endLine: 20, symbolName: 'long' },
          { content: 'small', startLine: 1, endLine: 1, symbolName: 'small' },
          { content: undefined },
          { content: 'last', startLine: 22, endLine: 22, symbolName: 'last' },
        ],
      }),
    };
    generator.generateBatchesEmbeddings = jest.fn(async (batches: string[][]) =>
      batches.map(batch => batch.map(text => [text.length, 1, 0]))
    );
  });
  afterEach(async () => {
    await storage.close();
    // The only recursively removed path is the verified fixture directory we created.
    if (
      path.dirname(root) !== os.tmpdir() ||
      !path.basename(root).startsWith('ambiance-chunk-ids-')
    )
      throw new Error('Unexpected fixture path');
    fs.rmSync(root, { recursive: true, force: true });
    if (previousLocal === undefined) delete process.env.USE_LOCAL_EMBEDDINGS;
    else process.env.USE_LOCAL_EMBEDDINGS = previousLocal;
    if (previousOpenAI === undefined) delete process.env.USE_OPENAI_EMBEDDINGS;
    else process.env.USE_OPENAI_EMBEDDINGS = previousOpenAI;
  });

  it('retains every split and sibling chunk in SQLite, in stable source order across refreshes', async () => {
    const expected = await generator.chunkContent(fs.readFileSync(file, 'utf8'), file, {
      maxChunkSize: 120,
    });
    expect(expected.length).toBeGreaterThan(4);
    expect(expected.map((c: any) => c.index)).toEqual(expected.map((_: any, i: number) => i));
    expect(expected[0].symbols).toEqual(['small']);
    const result = await generator.generateFileEmbeddings('fixture', file, root, {
      maxChunkSize: 120,
    });
    expect(result.errors).toEqual([]);
    const rows = (await storage.getProjectEmbeddings('fixture')).sort(
      (a, b) => a.chunkIndex - b.chunkIndex
    );
    expect(rows.map(c => [c.content, c.metadata.startLine, c.metadata.endLine])).toEqual(
      expected.map((c: any) => [c.content, c.startLine, c.endLine])
    );
    expect(new Set(rows.map(c => c.id)).size).toBe(expected.length);
    const repeated = await generator.generateFileEmbeddings('fixture', file, root, {
      maxChunkSize: 120,
    });
    expect(repeated.reusedEmbeddings).toBe(expected.length);
    const again = (await storage.getProjectEmbeddings('fixture')).sort(
      (a, b) => a.chunkIndex - b.chunkIndex
    );
    expect(again.map(c => c.id)).toEqual(rows.map(c => c.id));
    const metadata = (await storage.listProjectFiles('fixture'))[0];
    expect(metadata.chunkLayoutVersion).toBe(EMBEDDING_CHUNK_LAYOUT_VERSION);
    expect((await storage.getFileMetadata(metadata.id))?.chunkLayoutVersion).toBe(
      EMBEDDING_CHUNK_LAYOUT_VERSION
    );
  });

  it('waits for parser readiness before selecting AST or fallback chunks', async () => {
    let ready!: () => void;
    generator.treeSitterReady = new Promise<void>(resolve => { ready = resolve; });
    const parser = jest.spyOn(generator.treeSitter, 'parseAndChunk');
    const pending = generator.chunkContent(fs.readFileSync(file, 'utf8'), file, { maxChunkSize: 120 });
    await Promise.resolve();
    expect(parser).not.toHaveBeenCalled();
    ready();
    const chunks = await pending;
    expect(parser).toHaveBeenCalledTimes(1);
    expect(chunks[0].symbols).toEqual(['small']);
  });

  it('leaves an interrupted file write eligible for repair instead of marking the layout current', async () => {
    jest.spyOn(storage, 'storeEmbedding').mockRejectedValueOnce(new Error('interrupted write'));
    const result = await generator.generateFileEmbeddings('fixture', file, root, {
      maxChunkSize: 120,
    });
    expect(result.errors[0]).toContain('interrupted write');
    expect((await storage.listProjectFiles('fixture'))[0].chunkLayoutVersion).toBeUndefined();
  });
});
