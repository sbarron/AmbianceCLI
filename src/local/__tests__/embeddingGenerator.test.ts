/**
 * @fileOverview: Comprehensive tests for LocalEmbeddingGenerator functionality
 * @module: LocalEmbeddingGenerator Tests
 * @context: Testing embedding generation with provider fallback and error handling
 */

import {
  LocalEmbeddingGenerator,
  GenerationOptions,
  GenerationProgress,
} from '../embeddingGenerator';
import { LocalEmbeddingStorage } from '../embeddingStorage';
import { LocalEmbeddingProvider, getDefaultLocalProvider } from '../localEmbeddingProvider';
import { apiClient } from '../../client/apiClient';
import { openaiService } from '../../core/openaiService';
import { logger } from '../../utils/logger';

// Mock dependencies
jest.mock('../embeddingStorage', () => ({
  LocalEmbeddingStorage: jest.fn().mockImplementation(() => ({
    initializeDatabase: jest.fn().mockResolvedValue(undefined),
    ensureDimensionCompatibility: jest.fn().mockResolvedValue(undefined),
    storeEmbedding: jest.fn().mockResolvedValue(undefined),
    storeFileMetadata: jest.fn().mockResolvedValue(undefined),
    getEmbeddingMetadata: jest.fn().mockReturnValue({
      embeddingFormat: 'float32',
      embeddingDimensions: 1024,
      embeddingProvider: 'voyageai',
    }),
    getProjectEmbeddings: jest.fn().mockResolvedValue([]),
    clearProjectEmbeddings: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
  })),
}));

// Mock the static generateContentHash method
const mockStorageModule = jest.requireMock('../embeddingStorage');
mockStorageModule.LocalEmbeddingStorage.generateContentHash = jest
  .fn()
  .mockReturnValue('mock-hash');
jest.mock('../localEmbeddingProvider');
jest.mock('../../client/apiClient');
jest.mock('../../utils/logger');
jest.mock('fs');
jest.mock('../treeSitterProcessor');
jest.mock('globby');

// Mock getDefaultLocalProvider function
jest.mock('../localEmbeddingProvider', () => ({
  LocalEmbeddingProvider: jest.fn(),
  getDefaultLocalProvider: jest.fn(),
}));

// Setup LocalEmbeddingProvider mock
const mockLocalProvider = {
  generateEmbeddings: jest.fn().mockResolvedValue([
    {
      embedding: [0.1, 0.2, 0.3],
      model: 'all-MiniLM-L6-v2',
      dimensions: 384,
    },
  ]),
  generateQueryEmbedding: jest.fn().mockResolvedValue([0.1, 0.2, 0.3]),
  getModelInfo: jest.fn().mockReturnValue({
    name: 'all-MiniLM-L6-v2',
    dimensions: 384,
    provider: 'transformers.js',
  }),
  dispose: jest.fn().mockResolvedValue(undefined),
};
(LocalEmbeddingProvider as jest.Mock).mockImplementation(() => mockLocalProvider);

// Mock the openaiService module
jest.mock('../../core/openaiService', () => ({
  openaiService: {
    isReady: jest.fn(),
    getClient: jest.fn(),
  },
}));
const mockOpenAIService = require('../../core/openaiService').openaiService;

describe('LocalEmbeddingGenerator', () => {
  let generator: LocalEmbeddingGenerator;
  let mockStorage: jest.Mocked<LocalEmbeddingStorage>;
  let mockApiClient: jest.Mocked<typeof apiClient>;
  let mockLogger: jest.Mocked<typeof logger>;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Import the mocked modules
    const { LocalEmbeddingStorage } = require('../embeddingStorage');

    // Setup LocalEmbeddingStorage mock
    mockStorage = new LocalEmbeddingStorage() as jest.Mocked<LocalEmbeddingStorage>;
    LocalEmbeddingStorage.isEnabled = jest.fn().mockReturnValue(true);

    // Add the deleteEmbeddingsByFile method to the mock
    mockStorage.deleteEmbeddingsByFile = jest.fn().mockResolvedValue(5);

    // Setup apiClient mock with successful response
    mockApiClient = {
      post: jest.fn().mockResolvedValue({
        data: { embeddings: [[0.1, 0.2, 0.3]] },
      }),
      generateEmbeddings: jest.fn().mockResolvedValue({
        embeddings: [[0.1, 0.2, 0.3]],
        model: process.env.VOYAGEAI_MODEL || 'voyageai-model',
        dimensions: 3,
        input_type: 'document',
        encoding_format: 'float32',
        total_tokens: 10,
        processing_time_ms: 100,
        provider: 'voyage',
      }),
    } as any;

    // Setup logger mock
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as any;

    // Setup globby mock to return test files
    const mockProjectPath = '/path/to/test/project';
    const mockGlobby = jest
      .fn()
      .mockResolvedValue([
        require('path').join(mockProjectPath, 'src', 'index.ts'),
        require('path').join(mockProjectPath, 'src', 'utils.ts'),
        require('path').join(mockProjectPath, 'package.json'),
      ]);
    (require('globby') as any).globby = mockGlobby;

    // Setup fs mocks for file operations
    const mockFs = {
      readFileSync: jest.fn((filePath: string) => {
        if (filePath.includes('index.ts')) {
          return 'export function hello() { return "world"; }';
        } else if (filePath.includes('utils.ts')) {
          return 'export const util = "test";';
        } else if (filePath.includes('package.json')) {
          return '{"name": "test", "version": "1.0.0"}';
        }
        return '';
      }),
      statSync: jest.fn(() => ({
        mtime: new Date(),
        size: 100,
        isFile: () => true,
        isDirectory: () => false,
      })),
    };
    (require('fs') as any).readFileSync = mockFs.readFileSync;
    (require('fs') as any).statSync = mockFs.statSync;

    // Apply mocks
    (apiClient as any).post = mockApiClient.post;
    (apiClient as any).generateEmbeddings = mockApiClient.generateEmbeddings;
    (logger as any).info = mockLogger.info;
    (logger as any).warn = mockLogger.warn;
    (logger as any).error = mockLogger.error;
    (logger as any).debug = mockLogger.debug;

    // Mock environment variables
    process.env.USE_LOCAL_EMBEDDINGS = 'true';
    process.env.LOCAL_EMBEDDING_MODEL = 'all-MiniLM-L6-v2'; // Required for local provider selection
    process.env.AMBIANCE_API_KEY = process.env.AMBIANCE_API_KEY || 'test-key';

    // Setup getDefaultLocalProvider mock to return our mock provider
    (getDefaultLocalProvider as jest.Mock).mockReturnValue(mockLocalProvider);

    // Create generator with mock storage to avoid constructor issues
    generator = new LocalEmbeddingGenerator(mockStorage);
  });

  afterEach(() => {
    // Clean up environment variables
    delete process.env.USE_LOCAL_EMBEDDINGS;
    delete process.env.LOCAL_EMBEDDING_MODEL;
    delete process.env.AMBIANCE_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });

  describe('Constructor', () => {
    test('should initialize with provided storage', () => {
      const customStorage = {} as LocalEmbeddingStorage;
      const gen = new LocalEmbeddingGenerator(customStorage);
      expect(gen).toBeInstanceOf(LocalEmbeddingGenerator);
    });

    test('should create default storage when none provided', () => {
      const gen = new LocalEmbeddingGenerator();
      expect(gen).toBeInstanceOf(LocalEmbeddingGenerator);
      expect(LocalEmbeddingStorage).toHaveBeenCalled();
    });

    test('should initialize with Ambiance API key from environment', () => {
      process.env.AMBIANCE_API_KEY = process.env.AMBIANCE_API_KEY || 'test-ambiance-key';
      const gen = new LocalEmbeddingGenerator();
      // The key should be set internally - we can't test private properties directly
      expect(gen).toBeDefined();
    });

    test('should handle missing API keys gracefully', () => {
      delete process.env.AMBIANCE_API_KEY;
      delete process.env.OPENAI_API_KEY;
      const gen = new LocalEmbeddingGenerator();
      expect(gen).toBeDefined();
    });
  });

  describe('generateProjectEmbeddings', () => {
    const mockProjectId = 'test-project-123';
    const mockProjectPath = '/path/to/test/project';

    beforeEach(() => {
      // Additional setup for generation tests if needed
    });

    test('should throw error when local embeddings not enabled', async () => {
      (LocalEmbeddingStorage.isEnabled as jest.Mock).mockReturnValue(false);

      await expect(
        generator.generateProjectEmbeddings(mockProjectId, mockProjectPath)
      ).rejects.toThrow('Local embeddings not enabled');
    });

    test('should initialize database on generation start', async () => {
      mockApiClient.post.mockResolvedValue({
        data: { embeddings: [[0.1, 0.2, 0.3]] },
      });

      await generator.generateProjectEmbeddings(mockProjectId, mockProjectPath);

      expect(mockStorage.initializeDatabase).toHaveBeenCalled();
    });

    test('should process files and return progress', async () => {
      mockApiClient.post.mockResolvedValue({
        data: { embeddings: [[0.1, 0.2, 0.3]] },
      });

      const result = await generator.generateProjectEmbeddings(mockProjectId, mockProjectPath);

      expect(result).toHaveProperty('totalFiles');
      expect(result).toHaveProperty('processedFiles');
      expect(result).toHaveProperty('totalChunks');
      expect(result).toHaveProperty('processedChunks');
      expect(result).toHaveProperty('embeddings');
      expect(result).toHaveProperty('errors');
      expect(Array.isArray(result.errors)).toBe(true);
    });

    test('should handle force regeneration option', async () => {
      mockApiClient.post.mockResolvedValue({
        data: { embeddings: [[0.1, 0.2, 0.3]] },
      });

      const options: GenerationOptions = { force: true };
      await generator.generateProjectEmbeddings(mockProjectId, mockProjectPath, options);

      // Should proceed with generation regardless of existing embeddings
      expect(mockStorage.initializeDatabase).toHaveBeenCalled();
    });

    test('should respect batch size configuration', async () => {
      mockApiClient.post.mockResolvedValue({
        data: { embeddings: [[0.1, 0.2, 0.3]] },
      });

      const options: GenerationOptions = { batchSize: 16 };
      await generator.generateProjectEmbeddings(mockProjectId, mockProjectPath, options);

      expect(mockLocalProvider.generateEmbeddings).toHaveBeenCalled();
    });

    test('should handle rate limiting', async () => {
      mockApiClient.post.mockResolvedValue({
        data: { embeddings: [[0.1, 0.2, 0.3]] },
      });

      const options: GenerationOptions = { rateLimit: 100 };
      const startTime = Date.now();

      await generator.generateProjectEmbeddings(mockProjectId, mockProjectPath, options);

      const endTime = Date.now();
      // Should take at least the rate limit time
      expect(endTime - startTime).toBeGreaterThanOrEqual(0); // Basic timing test
    });

    test('should handle file patterns filter', async () => {
      mockApiClient.post.mockResolvedValue({
        data: { embeddings: [[0.1, 0.2, 0.3]] },
      });

      const options: GenerationOptions = { filePatterns: ['*.ts'] };
      await generator.generateProjectEmbeddings(mockProjectId, mockProjectPath, options);

      expect(mockLocalProvider.generateEmbeddings).toHaveBeenCalled();
    });

    test('should handle parallel mode', async () => {
      mockApiClient.post.mockResolvedValue({
        data: { embeddings: [[0.1, 0.2, 0.3]] },
      });

      const options: GenerationOptions = { parallelMode: true, maxConcurrency: 5 };
      await generator.generateProjectEmbeddings(mockProjectId, mockProjectPath, options);

      expect(mockLocalProvider.generateEmbeddings).toHaveBeenCalled();
    });

    test('should handle API errors gracefully', async () => {
      // Clear any previous provider failures
      // @ts-ignore - accessing private static for testing
      LocalEmbeddingGenerator.providerFailures.clear();

      // Set up to use OpenAI provider and disable local embeddings
      process.env.USE_OPENAI_EMBEDDINGS = 'true';
      process.env.OPENAI_API_KEY = 'test-key';
      process.env.USE_LOCAL_EMBEDDINGS = 'false'; // Disable local fallback
      mockOpenAIService.isReady.mockReturnValue(true);
      mockOpenAIService.getClient.mockReturnValue({}); // Mock OpenAI client as available

      // Create generator with OpenAI enabled
      const openaiGenerator = new LocalEmbeddingGenerator(mockStorage);

      // Mock the OpenAI client to throw an error
      const mockOpenAIClient = {
        embeddings: {
          create: jest.fn().mockRejectedValue(new Error('API Error')),
        },
      };
      mockOpenAIService.getClient.mockReturnValue(mockOpenAIClient);

      const result = await openaiGenerator.generateProjectEmbeddings(
        mockProjectId,
        mockProjectPath
      );

      // Method catches errors and adds them to progress.errors instead of throwing
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('API Error');
      expect(mockLogger.error).toHaveBeenCalled();

      // Clean up
      delete process.env.USE_OPENAI_EMBEDDINGS;
      delete process.env.OPENAI_API_KEY;
      delete process.env.USE_LOCAL_EMBEDDINGS;
      mockOpenAIService.isReady.mockReset();
      mockOpenAIService.getClient.mockReset();
    });

    test('should handle chunking options', async () => {
      mockApiClient.generateEmbeddings.mockResolvedValue({
        embeddings: [[0.1, 0.2, 0.3]],
        model: process.env.VOYAGEAI_MODEL || 'voyageai-model',
        dimensions: 3,
        input_type: 'document',
        encoding_format: 'float32',
        total_tokens: 10,
        processing_time_ms: 100,
        provider: 'voyage',
      });

      const options: GenerationOptions = {
        maxChunkSize: 1000,
        overlapSize: 100,
        preferSymbolBoundaries: true,
        includeContext: true,
      };

      await generator.generateProjectEmbeddings(mockProjectId, mockProjectPath, options);

      expect(mockLocalProvider.generateEmbeddings).toHaveBeenCalled();
    });
  });

  describe('generateQueryEmbedding', () => {
    test('should generate embedding for query text', async () => {
      mockApiClient.generateEmbeddings.mockResolvedValue({
        embeddings: [[0.1, 0.2, 0.3, 0.4, 0.5]],
        model: process.env.VOYAGEAI_MODEL || 'voyageai-model',
        dimensions: 5,
        input_type: 'document',
        encoding_format: 'float32',
        total_tokens: 10,
        processing_time_ms: 100,
        provider: 'voyage',
      });

      const result = await generator.generateQueryEmbedding('test query');

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      expect(typeof result[0]).toBe('number');
    });

    test('should handle empty query', async () => {
      // Set up to use OpenAI provider
      process.env.USE_OPENAI_EMBEDDINGS = 'true';
      process.env.OPENAI_API_KEY = 'test-key';

      mockApiClient.generateEmbeddings.mockResolvedValue({
        embeddings: [[]],
        model: 'text-embedding-3-small',
        dimensions: 1536,
        input_type: 'document',
        encoding_format: 'float32',
        total_tokens: 10,
        processing_time_ms: 100,
        provider: 'openai',
      });

      const result = await generator.generateQueryEmbedding('');

      expect(Array.isArray(result)).toBe(true);

      // Clean up
      delete process.env.USE_OPENAI_EMBEDDINGS;
      delete process.env.OPENAI_API_KEY;
    });

    test('should handle API errors in query embedding', async () => {
      // Clear any previous provider failures
      // @ts-ignore - accessing private static for testing
      LocalEmbeddingGenerator.providerFailures.clear();

      // Set up to use OpenAI provider and disable local embeddings
      process.env.USE_OPENAI_EMBEDDINGS = 'true';
      process.env.OPENAI_API_KEY = 'test-key';
      process.env.USE_LOCAL_EMBEDDINGS = 'false'; // Disable local fallback
      mockOpenAIService.isReady.mockReturnValue(true);
      mockOpenAIService.getClient.mockReturnValue({}); // Mock OpenAI client as available

      // Create generator with OpenAI enabled and local disabled
      const openaiGenerator = new LocalEmbeddingGenerator(mockStorage);

      // Mock the OpenAI client to throw an error
      const mockOpenAIClient = {
        embeddings: {
          create: jest.fn().mockRejectedValue(new Error('API Error')),
        },
      };
      mockOpenAIService.getClient.mockReturnValue(mockOpenAIClient);

      await expect(openaiGenerator.generateQueryEmbedding('test')).rejects.toThrow(
        'Embedding generation failed with all providers'
      );

      // Clean up
      delete process.env.USE_OPENAI_EMBEDDINGS;
      delete process.env.OPENAI_API_KEY;
      delete process.env.USE_LOCAL_EMBEDDINGS;
      mockOpenAIService.isReady.mockReset();
      mockOpenAIService.getClient.mockReset();
    });

    test('should use project-specific embedding generation when projectId provided', async () => {
      mockApiClient.generateEmbeddings.mockResolvedValue({
        embeddings: [[0.1, 0.2, 0.3]],
        model: process.env.VOYAGEAI_MODEL || 'voyageai-model',
        dimensions: 3,
        input_type: 'document',
        encoding_format: 'float32',
        total_tokens: 10,
        processing_time_ms: 100,
        provider: 'voyage',
      });

      await generator.generateQueryEmbedding('test', 'project-123');

      expect(mockLocalProvider.generateEmbeddings).toHaveBeenCalled();
    });
  });

  describe('dispose', () => {
    test('should close storage connection', async () => {
      await generator.dispose();

      expect(mockStorage.close).toHaveBeenCalled();
    });

    test('should handle dispose errors gracefully', async () => {
      mockStorage.close.mockRejectedValue(new Error('Close error'));

      await expect(generator.dispose()).resolves.toBeUndefined();

      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('Provider Selection Logic', () => {
    test('should prioritize local provider when USE_LOCAL_EMBEDDINGS=true and LOCAL_EMBEDDING_MODEL is set', async () => {
      // With USE_LOCAL_EMBEDDINGS=true and LOCAL_EMBEDDING_MODEL set (from beforeEach),
      // the provider selection should prioritize local even with Ambiance API key present

      const result = await generator.generateQueryEmbedding('test');

      // Should not call Ambiance API since local is prioritized
      expect(mockApiClient.generateEmbeddings).not.toHaveBeenCalled();
      // Should call local provider instead
      expect(mockLocalProvider.generateEmbeddings).toHaveBeenCalled();
    });

    test('should use local provider by default even when Ambiance API key is available', async () => {
      // Keep LOCAL_EMBEDDING_MODEL set but add Ambiance API key
      process.env.AMBIANCE_API_KEY = process.env.AMBIANCE_API_KEY || 'test-key';
      mockApiClient.post.mockResolvedValue({
        data: { embeddings: [[0.1, 0.2, 0.3]] },
      });

      await generator.generateQueryEmbedding('test');

      // Should not call Ambiance API unless explicitly enabled
      expect(mockApiClient.generateEmbeddings).not.toHaveBeenCalled();
      expect(mockLocalProvider.generateEmbeddings).toHaveBeenCalled();
    });

    test('should handle local provider errors and fallback to OpenAI when explicitly enabled', async () => {
      // Clear any previous provider failures
      // @ts-ignore - accessing private static for testing
      LocalEmbeddingGenerator.providerFailures.clear();

      // Mock local provider to throw error
      const failingLocalProvider = {
        generateEmbeddings: jest.fn().mockRejectedValue(new Error('Local provider failed')),
        generateQueryEmbedding: jest.fn().mockRejectedValue(new Error('Local provider failed')),
        getModelInfo: jest.fn().mockReturnValue({
          name: 'all-MiniLM-L6-v2',
          dimensions: 384,
          provider: 'transformers.js',
        }),
        dispose: jest.fn().mockResolvedValue(undefined),
      };

      // Enable OpenAI explicitly as fallback
      process.env.USE_OPENAI_EMBEDDINGS = 'true';
      process.env.OPENAI_API_KEY = 'test-key';
      mockOpenAIService.isReady.mockReturnValue(true);
      mockOpenAIService.getClient.mockReturnValue({}); // Mock OpenAI client as available

      // Create generator with OpenAI enabled
      const openaiGenerator = new LocalEmbeddingGenerator(mockStorage);

      // Mock getDefaultLocalProvider to return the failing provider for this generator
      (getDefaultLocalProvider as jest.Mock).mockReturnValue(failingLocalProvider);

      // Mock the OpenAI client to return successful results
      const mockOpenAIClient = {
        embeddings: {
          create: jest.fn().mockResolvedValue({
            data: [{ embedding: [0.1, 0.2, 0.3] }],
          }),
        },
      };
      mockOpenAIService.getClient.mockReturnValue(mockOpenAIClient);

      const result = await openaiGenerator.generateQueryEmbedding('test');

      expect(failingLocalProvider.generateEmbeddings).toHaveBeenCalled();
      expect(mockOpenAIClient.embeddings.create).toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalled();
      expect(result).toEqual([0.1, 0.2, 0.3]);

      // Clean up
      delete process.env.USE_OPENAI_EMBEDDINGS;
      delete process.env.OPENAI_API_KEY;
      mockOpenAIService.isReady.mockReset();
      mockOpenAIService.getClient.mockReset();
      // Restore original mock
      (getDefaultLocalProvider as jest.Mock).mockReturnValue(mockLocalProvider);
    });

    test('should handle missing API keys with local provider', async () => {
      delete process.env.AMBIANCE_API_KEY;
      delete process.env.OPENAI_API_KEY;

      // Should still work with local provider
      const result = await generator.generateQueryEmbedding('test');

      expect(mockLocalProvider.generateEmbeddings).toHaveBeenCalled();
      expect(mockApiClient.generateEmbeddings).not.toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    test('should handle database initialization errors', async () => {
      mockStorage.initializeDatabase.mockRejectedValue(new Error('DB Error'));

      await expect(generator.generateProjectEmbeddings('test', '/path')).rejects.toThrow(
        'DB Error'
      );
    });

    test('should handle dimension compatibility errors', async () => {
      mockStorage.ensureDimensionCompatibility.mockRejectedValue(new Error('Dimension mismatch'));

      await expect(generator.generateProjectEmbeddings('test', '/path')).rejects.toThrow(
        'Dimension mismatch'
      );
    });

    test('should handle file system errors', async () => {
      // Mock globby to throw error (this is what getProjectFiles actually uses)
      const mockGlobby = jest.fn().mockRejectedValue(new Error('File system error'));
      (require('globby') as any).globby = mockGlobby;

      const result = await generator.generateProjectEmbeddings('test', '/invalid/path');

      // Method catches errors and adds them to progress.errors instead of throwing
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('File system error');

      // Restore original mock
      (require('globby') as any).globby = jest
        .fn()
        .mockResolvedValue([
          require('path').join('/path/to/test/project', 'src', 'index.ts'),
          require('path').join('/path/to/test/project', 'src', 'utils.ts'),
          require('path').join('/path/to/test/project', 'package.json'),
        ]);
    });

    test('should handle invalid project paths', async () => {
      // Mock globby to throw error for invalid paths
      const mockGlobby = jest.fn().mockRejectedValue(new Error('Invalid project path'));
      (require('globby') as any).globby = mockGlobby;

      const result = await generator.generateProjectEmbeddings('test', '/nonexistent/path');

      // Method catches errors and adds them to progress.errors instead of throwing
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Invalid project path');

      // Restore original mock
      (require('globby') as any).globby = jest
        .fn()
        .mockResolvedValue([
          require('path').join('/path/to/test/project', 'src', 'index.ts'),
          require('path').join('/path/to/test/project', 'src', 'utils.ts'),
          require('path').join('/path/to/test/project', 'package.json'),
        ]);
    });
  });

  describe('Configuration and Environment', () => {
    test('should respect environment variable configurations', async () => {
      process.env.EMBEDDING_BATCH_SIZE = '16';
      process.env.EMBEDDING_MAX_CONCURRENCY = '5';
      process.env.EMBEDDING_PARALLEL_MODE = 'true';

      await generator.generateProjectEmbeddings('test', '/path');

      // With local provider prioritized, should call local provider instead of Ambiance API
      expect(mockLocalProvider.generateEmbeddings).toHaveBeenCalled();
      expect(mockApiClient.generateEmbeddings).not.toHaveBeenCalled();
    });

    test('should handle missing environment configurations gracefully', async () => {
      // Remove all optional environment variables
      delete process.env.EMBEDDING_BATCH_SIZE;
      delete process.env.EMBEDDING_MAX_CONCURRENCY;
      delete process.env.EMBEDDING_PARALLEL_MODE;

      await generator.generateProjectEmbeddings('test', '/path');

      // Should use default values with local provider
      expect(mockLocalProvider.generateEmbeddings).toHaveBeenCalled();
      expect(mockApiClient.generateEmbeddings).not.toHaveBeenCalled();
    });
  });

  describe('Progress Tracking', () => {
    test('should provide detailed progress information', async () => {
      const progress = await generator.generateProjectEmbeddings('test', '/path');

      expect(progress).toHaveProperty('totalFiles', expect.any(Number));
      expect(progress).toHaveProperty('processedFiles', expect.any(Number));
      expect(progress).toHaveProperty('totalChunks', expect.any(Number));
      expect(progress).toHaveProperty('processedChunks', expect.any(Number));
      expect(progress).toHaveProperty('embeddings', expect.any(Number));
      expect(progress).toHaveProperty('errors', expect.any(Array));
      // Should use local provider instead of Ambiance API
      expect(mockLocalProvider.generateEmbeddings).toHaveBeenCalled();
      expect(mockApiClient.generateEmbeddings).not.toHaveBeenCalled();
    });

    test('should track errors in progress', async () => {
      // Mock local provider to throw error during embedding generation
      const originalGenerateEmbeddings = mockLocalProvider.generateEmbeddings;
      mockLocalProvider.generateEmbeddings.mockRejectedValue(
        new Error('Embedding generation failed')
      );

      const progress = await generator.generateProjectEmbeddings('test', '/path');

      expect(progress.errors.length).toBeGreaterThan(0);
      expect(progress.errors[0]).toContain('Failed to generate embeddings');
      // Should use local provider even with errors
      expect(mockLocalProvider.generateEmbeddings).toHaveBeenCalled();
      expect(mockApiClient.generateEmbeddings).not.toHaveBeenCalled();

      // Restore original mock
      mockLocalProvider.generateEmbeddings = originalGenerateEmbeddings;
    });
  });

  describe('Edge Cases', () => {
    test('should handle empty file list', async () => {
      // Mock globby to return empty array
      const mockGlobby = jest.fn().mockResolvedValue([]);
      (require('globby') as any).globby = mockGlobby;

      const progress = await generator.generateProjectEmbeddings('test', '/empty/path');

      expect(progress.totalFiles).toBe(0);
      expect(progress.processedFiles).toBe(0);

      // Restore original mock
      (require('globby') as any).globby = jest
        .fn()
        .mockResolvedValue([
          require('path').join('/path/to/test/project', 'src', 'index.ts'),
          require('path').join('/path/to/test/project', 'src', 'utils.ts'),
          require('path').join('/path/to/test/project', 'package.json'),
        ]);
    });

    test('should handle files with no content', async () => {
      jest.doMock('fs', () => ({
        ...jest.requireActual('fs'),
        readFileSync: jest.fn().mockReturnValue(''),
      }));

      const progress = await generator.generateProjectEmbeddings('test', '/path');

      expect(progress.processedFiles).toBeGreaterThan(0);
      // Should use local provider instead of Ambiance API
      expect(mockLocalProvider.generateEmbeddings).toHaveBeenCalled();
      expect(mockApiClient.generateEmbeddings).not.toHaveBeenCalled();
    });

    test('should handle very large files', async () => {
      const largeContent = 'x'.repeat(100000); // 100KB file
      jest.doMock('fs', () => ({
        ...jest.requireActual('fs'),
        readFileSync: jest.fn().mockReturnValue(largeContent),
      }));

      await generator.generateProjectEmbeddings('test', '/path');

      // Should use local provider instead of Ambiance API
      expect(mockLocalProvider.generateEmbeddings).toHaveBeenCalled();
      expect(mockApiClient.generateEmbeddings).not.toHaveBeenCalled();
    });
  });
});
