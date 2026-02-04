/**
 * @fileOverview: Unit tests for LocalEmbeddingStorage
 * @module: EmbeddingStorage Tests
 * @description: Tests for embedding storage, retrieval, and metadata handling
 */

import { LocalEmbeddingStorage, EmbeddingChunk } from '../embeddingStorage';
import { logger } from '../../utils/logger';

// Mock better-sqlite3 with synchronous API
jest.mock('better-sqlite3', () => {
  const mockStatement = {
    run: jest.fn().mockReturnValue({ changes: 1 }),
    all: jest.fn().mockReturnValue([]),
    get: jest.fn().mockReturnValue(null),
    finalize: jest.fn(),
  };

  return jest.fn().mockImplementation(() => ({
    exec: jest.fn(),
    prepare: jest.fn().mockReturnValue(mockStatement),
    close: jest.fn(),
  }));
});

// Mock fs
jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(false),
  mkdirSync: jest.fn(),
}));

// Mock path
jest.mock('path', () => ({
  resolve: jest.fn((...args) => args.join('/')),
  dirname: jest.fn(path => path.split('/').slice(0, -1).join('/')),
  join: jest.fn((...args) => args.join('/')),
}));

// Mock crypto
jest.mock('crypto', () => ({
  createHash: jest.fn().mockImplementation(() => ({
    update: jest.fn().mockReturnThis(),
    digest: jest.fn().mockReturnValue('mock-hash'),
  })),
}));

// Mock logger
jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('LocalEmbeddingStorage', () => {
  let storage: LocalEmbeddingStorage;
  let mockDb: any;
  let mockStatement: any;

  const mockEmbeddingChunk: EmbeddingChunk = {
    id: 'test-chunk-1',
    projectId: 'test-project',
    fileId: 'test-file-id',
    filePath: 'src/main.ts',
    chunkIndex: 0,
    content: 'console.log("Hello World");',
    embedding: [0.1, 0.2, 0.3, 0.4, 0.5],
    metadata: {
      startLine: 1,
      endLine: 5,
      language: 'typescript',
      symbols: ['console', 'log'],
      type: 'code',
      embeddingFormat: 'float32',
      embeddingDimensions: 1024,
      embeddingProvider: 'voyageai',
    },
    hash: 'test-hash',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    // Reset environment variable
    delete process.env.USE_LOCAL_EMBEDDINGS;

    storage = new LocalEmbeddingStorage();
    await storage.initializeDatabase();
    mockDb = (storage as any).db;
    mockStatement = mockDb.prepare();
  });

  afterEach(async () => {
    if (storage) {
      await storage.close();
    }
  });

  describe('Initialization', () => {
    test('should initialize with custom path when USE_LOCAL_EMBEDDINGS is true', () => {
      process.env.USE_LOCAL_EMBEDDINGS = 'true';

      const customStorage = new LocalEmbeddingStorage('/custom/path');

      expect(logger.info).toHaveBeenCalledWith(
        '💾 Local embedding storage initialized',
        expect.objectContaining({
          useLocalEmbeddings: true,
          customPath: true,
        })
      );

      customStorage.close();
    });

    test('should initialize with default path when USE_LOCAL_EMBEDDINGS is false', () => {
      process.env.USE_LOCAL_EMBEDDINGS = 'false';

      const defaultStorage = new LocalEmbeddingStorage();

      expect(logger.info).toHaveBeenCalledWith(
        '💾 Local embedding storage initialized',
        expect.objectContaining({
          useLocalEmbeddings: false,
        })
      );

      defaultStorage.close();
    });

    test('should create database tables on initialization', async () => {
      await storage.initializeDatabase();

      expect(mockDb.exec).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS embeddings')
      );
    });

    test('should prepare statements after table creation', async () => {
      await storage.initializeDatabase();

      expect(mockDb.prepare).toHaveBeenCalled();
    });
  });

  describe('Storage Operations', () => {
    beforeEach(async () => {
      await storage.initializeDatabase();
    });

    test('should store embedding with all metadata', async () => {
      await storage.storeEmbedding(mockEmbeddingChunk);

      expect(mockStatement.run).toHaveBeenCalledWith(
        mockEmbeddingChunk.id,
        mockEmbeddingChunk.projectId,
        mockEmbeddingChunk.fileId,
        mockEmbeddingChunk.filePath,
        mockEmbeddingChunk.chunkIndex,
        mockEmbeddingChunk.content,
        expect.any(Buffer),
        mockEmbeddingChunk.metadata.type,
        mockEmbeddingChunk.metadata.language,
        JSON.stringify(mockEmbeddingChunk.metadata.symbols),
        mockEmbeddingChunk.metadata.startLine,
        mockEmbeddingChunk.metadata.endLine,
        'float32',
        mockEmbeddingChunk.metadata.embeddingDimensions,
        mockEmbeddingChunk.metadata.embeddingProvider,
        mockEmbeddingChunk.hash
      );

      expect(logger.debug).toHaveBeenCalledWith(
        '✅ Embedding stored',
        expect.objectContaining({
          chunkId: mockEmbeddingChunk.id,
          projectId: mockEmbeddingChunk.projectId,
        })
      );
    });

    test('should handle null metadata fields', async () => {
      const chunkWithoutMetadata = {
        ...mockEmbeddingChunk,
        metadata: {
          ...mockEmbeddingChunk.metadata,
          embeddingFormat: undefined,
          embeddingDimensions: undefined,
          embeddingProvider: undefined,
        },
      };

      await storage.storeEmbedding(chunkWithoutMetadata);

      const callArgs = mockStatement.run.mock.calls[0];
      expect(callArgs[12]).toBe('float32'); // embeddingFormat (from original chunk)
      expect(callArgs[13]).toBeNull(); // embeddingDimensions
      expect(callArgs[14]).toBeNull(); // embeddingProvider
    });
  });

  describe('Retrieval Operations', () => {
    beforeEach(async () => {
      await storage.initializeDatabase();
    });

    test('should retrieve project embeddings', async () => {
      const mockRows = [
        {
          id: 'test-chunk-1',
          project_id: 'test-project',
          file_path: 'src/main.ts',
          chunk_index: 0,
          content: 'console.log("Hello World");',
          embedding: Buffer.from(JSON.stringify([0.1, 0.2, 0.3, 0.4, 0.5])),
          metadata_type: 'code',
          metadata_language: 'typescript',
          metadata_symbols: JSON.stringify(['console', 'log']),
          metadata_start_line: 1,
          metadata_end_line: 5,
          metadata_embedding_format: 'int8',
          metadata_embedding_dimensions: 1024,
          metadata_embedding_provider: 'voyageai',
          hash: 'test-hash',
          created_at: '2024-01-01T00:00:00.000Z',
          updated_at: '2024-01-01T00:00:00.000Z',
        },
      ];

      mockStatement.all.mockReturnValue(mockRows);

      const embeddings = await storage.getProjectEmbeddings('test-project');

      expect(embeddings).toHaveLength(1);
      expect(embeddings[0]).toEqual({
        id: 'test-chunk-1',
        projectId: 'test-project',
        fileId: undefined,
        filePath: 'src/main.ts',
        chunkIndex: 0,
        content: 'console.log("Hello World");',
        embedding: { data: new Int8Array(), originalDimensions: undefined, params: undefined },
        metadata: {
          type: 'code',
          language: 'typescript',
          symbols: ['console', 'log'],
          startLine: 1,
          endLine: 5,
          embeddingFormat: 'int8',
          embeddingDimensions: 1024,
          embeddingProvider: 'voyageai',
        },
        hash: 'test-hash',
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        updatedAt: new Date('2024-01-01T00:00:00.000Z'),
      });
    });

    test('should handle missing metadata fields in retrieved data', async () => {
      const mockRows = [
        {
          id: 'test-chunk-1',
          project_id: 'test-project',
          file_path: 'src/main.ts',
          chunk_index: 0,
          content: 'console.log("Hello World");',
          embedding: Buffer.from(JSON.stringify([0.1, 0.2, 0.3])),
          metadata_type: 'code',
          metadata_language: null,
          metadata_symbols: null,
          metadata_start_line: null,
          metadata_end_line: null,
          metadata_embedding_format: null,
          metadata_embedding_dimensions: null,
          metadata_embedding_provider: null,
          hash: 'test-hash',
          created_at: '2024-01-01T00:00:00.000Z',
          updated_at: '2024-01-01T00:00:00.000Z',
        },
      ];

      const mockStmt = mockDb.prepare.mock.results.find((result: any) => result.value.all)?.value;

      if (mockStmt) {
        mockStmt.all.mockImplementation(
          (params: any, callback: (error: Error | null, rows: any[]) => void) =>
            callback(null, mockRows)
        );
      }

      const embeddings = await storage.getProjectEmbeddings('test-project');

      expect(embeddings[0].metadata).toEqual({
        type: 'code',
        language: null,
        symbols: undefined,
        startLine: null,
        endLine: null,
        embeddingFormat: null,
        embeddingDimensions: null,
        embeddingProvider: null,
      });
    });
  });

  describe('Similarity Search', () => {
    beforeEach(async () => {
      await storage.initializeDatabase();
    });

    test('should calculate cosine similarity correctly', () => {
      const similarity = (storage as any).cosineSimilarity([1, 0], [0, 1]);
      expect(similarity).toBeCloseTo(0, 10); // Orthogonal vectors

      const similarity2 = (storage as any).cosineSimilarity([1, 1], [1, 1]);
      expect(similarity2).toBeCloseTo(1, 10); // Identical vectors

      const similarity3 = (storage as any).cosineSimilarity([1, 0], [1, 0]);
      expect(similarity3).toBeCloseTo(1, 10); // Identical vectors
    });

    test('should handle zero vectors', () => {
      const similarity = (storage as any).cosineSimilarity([0, 0], [1, 1]);
      expect(similarity).toBe(0);
    });

    test('should handle different vector lengths', () => {
      const similarity = (storage as any).cosineSimilarity([1, 0], [1, 0, 0]);
      expect(similarity).toBe(0);
    });

    test('should search similar embeddings', async () => {
      const mockEmbeddings = [
        { ...mockEmbeddingChunk, embedding: [1, 0, 0, 0, 0] },
        { ...mockEmbeddingChunk, id: 'test-chunk-2', embedding: [0, 1, 0, 0, 0] },
      ];

      // Mock getProjectEmbeddings
      jest.spyOn(storage, 'getProjectEmbeddings').mockResolvedValue(mockEmbeddings);

      const queryEmbedding = [1, 0, 0, 0, 0];
      const results = await storage.searchSimilarEmbeddings('test-project', queryEmbedding, 5, 0.1);

      expect(results).toHaveLength(1); // Only the perfect match passes threshold
      expect(results[0].chunk.id).toBe('test-chunk-1');
      expect(results[0].similarity).toBeCloseTo(1, 10); // Perfect match
    });

    test('should apply similarity threshold', async () => {
      const mockEmbeddings = [
        { ...mockEmbeddingChunk, embedding: [1, 0] },
        { ...mockEmbeddingChunk, id: 'test-chunk-2', embedding: [0.1, 0.1] },
      ];

      jest.spyOn(storage, 'getProjectEmbeddings').mockResolvedValue(mockEmbeddings);

      const queryEmbedding = [1, 0];
      const results = await storage.searchSimilarEmbeddings('test-project', queryEmbedding, 5, 0.5);

      // Only the high similarity result should pass the threshold
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].similarity).toBe(1);
    });
  });

  describe('Hash Generation', () => {
    test('should generate consistent hashes', () => {
      const hash1 = LocalEmbeddingStorage.generateContentHash('test content', '/path/file.ts', 0);
      const hash2 = LocalEmbeddingStorage.generateContentHash('test content', '/path/file.ts', 0);

      expect(hash1).toBe(hash2);
    });

    test('should generate different hashes for different inputs', () => {
      const hash1 = LocalEmbeddingStorage.generateContentHash('content1', '/path/file.ts', 0);
      const hash2 = LocalEmbeddingStorage.generateContentHash('content2', '/path/file.ts', 0);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('Error Handling', () => {
    test('should handle database initialization errors', async () => {
      // Create a new storage instance with error-prone database
      const errorStorage = new LocalEmbeddingStorage();

      // Mock the Database constructor to throw an error
      const originalDatabase = require('sqlite3').Database;
      require('sqlite3').Database = jest
        .fn()
        .mockImplementation((dbPath: string, callback: (err: Error | null) => void) => {
          setTimeout(() => callback(new Error('DB Error')), 1);
          return null;
        });

      await expect(errorStorage.initializeDatabase()).rejects.toThrow('DB Error');

      // Restore original Database
      require('sqlite3').Database = originalDatabase;
    });

    test('should handle storage errors', async () => {
      await storage.initializeDatabase();

      const mockStmt = mockDb.prepare.mock.results[0].value;
      mockStmt.run.mockImplementation((params: any[], callback: (error: Error | null) => void) =>
        callback(new Error('Storage Error'))
      );

      await expect(storage.storeEmbedding(mockEmbeddingChunk)).rejects.toThrow('Storage Error');
    });

    test('should handle retrieval errors', async () => {
      await storage.initializeDatabase();

      const mockStmt = mockDb.prepare.mock.results.find((result: any) => result.value.all)?.value;

      if (mockStmt) {
        mockStmt.all.mockImplementation(
          (params: any[], callback: (error: Error | null, rows: any[]) => void) =>
            callback(new Error('Retrieval Error'), [])
        );
      }

      await expect(storage.getProjectEmbeddings('test-project')).rejects.toThrow('Retrieval Error');
    });
  });

  describe('Cleanup', () => {
    test('should close database connection', async () => {
      await storage.initializeDatabase();
      await storage.close();

      expect(mockDb.close).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith('✅ Database connection closed');
    });

    test('should handle close errors gracefully', async () => {
      await storage.initializeDatabase();

      // Mock close to throw an error
      mockDb.close.mockImplementation((callback: (error: Error | null) => void) =>
        callback(new Error('Close Error'))
      );

      // Should not throw
      await expect(storage.close()).resolves.toBeUndefined();

      expect(logger.error).toHaveBeenCalledWith(
        '❌ Error closing database',
        expect.objectContaining({
          error: 'Close Error',
        })
      );
    });
  });
});
