import { LocalEmbeddingGenerator } from '../embeddingGenerator';
import { LocalEmbeddingStorage } from '../embeddingStorage';
import { getDefaultLocalProvider } from '../localEmbeddingProvider';
import * as fs from 'fs';
import * as path from 'path';

jest.mock('fs');
jest.mock('../embeddingStorage');
jest.mock('../localEmbeddingProvider');
jest.mock('../treeSitterProcessor', () => ({
  TreeSitterProcessor: jest.fn(() => ({ initialize: async () => {} })),
}));
jest.mock('../../core/openaiService', () => ({ openaiService: { isReady: () => false } }));
jest.mock('../../client/apiClient', () => ({ apiClient: {} }));
jest.mock('../../utils/logger', () => ({
  logger: { info() {}, debug() {}, warn() {}, error() {} },
}));

describe('persistent local embedding reuse', () => {
  let generator: any, storage: any, rows: any[], chunks: any[], identity: string;
  const project = path.resolve('fixture'),
    file = path.join(project, 'source.ts');
  beforeEach(() => {
    process.env.USE_OPENAI_EMBEDDINGS = 'false';
    identity = 'model-A/default-inference';
    rows = [];
    chunks = ['first source', 'second source'].map((content, index) => ({
      content,
      index,
      startLine: index * 10 + 1,
      endLine: index * 10 + 2,
      symbols: ['helper'],
      type: 'code',
    }));
    storage = {
      getQuantizationMode: () => 'float32',
      getFileEmbeddings: jest.fn(async () => rows),
      storeFileMetadata: jest.fn(async () => {}),
      deleteEmbeddingsByFile: jest.fn(async () => {
        rows = [];
      }),
      storeEmbedding: jest.fn(async (row: any) => {
        rows.push(row);
      }),
    };
    (fs.readFileSync as jest.Mock).mockReturnValue('current file');
    (fs.statSync as jest.Mock).mockReturnValue({ mtime: new Date(), size: 100 });
    (getDefaultLocalProvider as jest.Mock).mockReturnValue({
      getCacheIdentity: () => identity,
      getModelInfo: () => ({ name: 'fixture-model', dimensions: 3 }),
    });
    (LocalEmbeddingStorage.generateContentHash as jest.Mock).mockReturnValue(
      'not-an-inference-key'
    );
    generator = new LocalEmbeddingGenerator(storage);
    generator.getCurrentProvider = () => 'local';
    generator.chunkContent = jest.fn(async () => chunks);
    generator.generateBatchesEmbeddings = jest.fn(async (batches: string[][]) =>
      batches.map(batch => batch.map(text => [text.length, 1, 0]))
    );
  });
  const refresh = (generator: any, force = false) =>
    generator.generateFileEmbeddings('project', file, project, { batchSize: 16, force });

  it('reuses unchanged input after indices and line ranges move, then invalidates on model settings', async () => {
    await refresh(generator);
    const prior = rows.map(row => row.embedding);
    chunks = [
      { content: 'new prefix', index: 0, startLine: 1, endLine: 2, type: 'code' },
      ...chunks.map(chunk => ({
        ...chunk,
        index: chunk.index + 1,
        startLine: chunk.startLine + 3,
        endLine: chunk.endLine + 3,
      })),
    ];
    generator.generateBatchesEmbeddings.mockClear();
    const result = await refresh(generator);
    expect(result.reusedEmbeddings).toBe(2);
    expect(generator.generateBatchesEmbeddings.mock.calls[0][0].flat()).toEqual([
      `File: source.ts\n\nnew prefix`,
    ]);
    expect(rows[1].embedding).toBe(prior[0]);
    expect(rows[2].embedding).toBe(prior[1]);
    expect(rows[1].metadata.startLine).toBe(4);
    expect(rows[1].chunkIndex).toBe(1);
    identity = 'model-A/different-pooling';
    const changed = await refresh(generator);
    expect(changed.reusedEmbeddings).toBe(0);
  });

  it('respects force and treats legacy rows without input fingerprints as cache misses', async () => {
    await refresh(generator);
    expect((await refresh(generator)).reusedEmbeddings).toBe(2);
    expect((await refresh(generator, true)).reusedEmbeddings).toBe(0);
    rows.forEach(row => {
      delete row.metadata.embeddingInputKey;
    });
    expect((await refresh(generator)).reusedEmbeddings).toBe(0);
  });

  it('infers a repeated cold input once across batches while retaining every ID and range', async () => {
    chunks = [
      chunks[0],
      { ...chunks[0], index: 1, startLine: 30, endLine: 31 },
      { ...chunks[1], index: 2 },
    ];
    const result = await generator.generateFileEmbeddings('project', file, project, {
      batchSize: 1,
    });
    expect(generator.generateBatchesEmbeddings.mock.calls[0][0].flat()).toEqual([
      'File: source.ts\n\nfirst source',
      'File: source.ts\n\nsecond source',
    ]);
    expect(result.errors).toEqual([]);
    expect(result.embeddings).toBe(3);
    expect(result.deduplicatedEmbeddings).toBe(1);
    expect(result.reusedEmbeddings).toBe(0);
    expect(new Set(rows.map(row => row.id)).size).toBe(3);
    expect(rows[0].embedding).toEqual(rows[1].embedding);
    expect(rows[1].metadata.startLine).toBe(30);
    generator.generateBatchesEmbeddings.mockClear();
    const warm = await refresh(generator);
    expect(warm.reusedEmbeddings).toBe(3);
    expect(generator.generateBatchesEmbeddings).not.toHaveBeenCalled();
    expect((await refresh(generator, true)).deduplicatedEmbeddings).toBe(1);
  });

  it('does not group remote-provider inputs without a local inference identity', async () => {
    chunks = [chunks[0], { ...chunks[0], index: 1 }];
    generator.getCurrentProvider = () => 'openai';
    const result = await refresh(generator);
    expect(result.deduplicatedEmbeddings).toBe(0);
    expect(generator.generateBatchesEmbeddings.mock.calls[0][0].flat()).toHaveLength(2);
  });

  it('rejects a model change during a deduplicated cold refresh before writing records', async () => {
    chunks = [chunks[0], { ...chunks[0], index: 1 }];
    generator.generateBatchesEmbeddings.mockImplementation(async () => {
      identity = 'fallback-model';
      return [[[1, 2, 3]]];
    });
    expect((await refresh(generator)).errors[0]).toContain('Local model changed');
    expect(storage.storeFileMetadata).not.toHaveBeenCalled();
    expect(storage.deleteEmbeddingsByFile).not.toHaveBeenCalled();
  });

  it('retains previous vectors and freshness metadata when generation fails', async () => {
    await refresh(generator);
    const prior = rows;
    chunks = [{ ...chunks[0], content: 'changed source' }, chunks[1]];
    storage.storeFileMetadata.mockClear();
    storage.deleteEmbeddingsByFile.mockClear();
    generator.generateBatchesEmbeddings.mockRejectedValue(new Error('inference failed'));
    const result = await refresh(generator);
    expect(result.errors).toHaveLength(1);
    expect(rows).toBe(prior);
    expect(storage.storeFileMetadata).not.toHaveBeenCalled();
    expect(storage.deleteEmbeddingsByFile).not.toHaveBeenCalled();
  });

  it('rejects incompatible dimensions and storage formats from the reuse cache', async () => {
    await refresh(generator);
    rows[0].metadata.embeddingDimensions = 4;
    rows[1].metadata.embeddingFormat = 'int8';
    expect((await refresh(generator)).reusedEmbeddings).toBe(0);
  });

  it('retains the old index if a fallback changes model identity during a mixed refresh', async () => {
    await refresh(generator);
    const prior = rows;
    chunks = [{ ...chunks[0], content: 'changed source' }, chunks[1]];
    storage.storeFileMetadata.mockClear();
    storage.deleteEmbeddingsByFile.mockClear();
    generator.generateBatchesEmbeddings.mockImplementation(async () => {
      identity = 'fallback-model';
      return [[[1, 2, 3]]];
    });
    expect((await refresh(generator)).errors[0]).toContain('Local model changed');
    expect(rows).toBe(prior);
    expect(storage.storeFileMetadata).not.toHaveBeenCalled();
    expect(storage.deleteEmbeddingsByFile).not.toHaveBeenCalled();
  });

  it.each([{ response: [] }, { response: [[[NaN, 1, 0]]] }])(
    'retains the old index for an invalid inference result %j',
    async ({ response }) => {
      await refresh(generator);
      const prior = rows;
      chunks = [{ ...chunks[0], content: 'changed source' }, chunks[1]];
      storage.deleteEmbeddingsByFile.mockClear();
      generator.generateBatchesEmbeddings.mockResolvedValue(response);
      expect((await refresh(generator)).errors[0]).toContain('Incomplete or invalid');
      expect(rows).toBe(prior);
      expect(storage.deleteEmbeddingsByFile).not.toHaveBeenCalled();
    }
  );
});
