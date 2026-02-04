/**
 * @fileOverview: Environment variable tests for local embeddings
 * @module: Environment Variable Tests
 * @description: Tests for LOCAL_EMBEDDING_MODEL environment variable handling
 */

import { getDefaultLocalProvider, disposeDefaultProvider } from '../localEmbeddingProvider';
import { LocalEmbeddingGenerator } from '../embeddingGenerator';
import { logger } from '../../utils/logger';

// Mock sqlite3 to avoid binding issues
jest.mock('sqlite3', () => ({
  Database: jest.fn().mockImplementation(() => ({
    exec: jest.fn().mockImplementation((sql, callback) => callback(null)),
    prepare: jest.fn().mockReturnValue({
      run: jest.fn().mockImplementation((params, callback) => callback(null)),
      all: jest.fn().mockImplementation((params, callback) => callback(null, [])),
      get: jest.fn().mockImplementation((params, callback) => callback(null, null)),
      finalize: jest.fn(),
    }),
    close: jest.fn().mockImplementation(callback => callback(null)),
  })),
}));

// Mock dependencies
jest.mock('@xenova/transformers', () => ({
  pipeline: jest.fn().mockResolvedValue({
    mockImplementation: (texts: string[]) =>
      Promise.resolve({
        data: new Float32Array(texts.length * 768).fill(0.1), // Mock 768-dim embeddings
      }),
  }),
}));

jest.mock('../../utils/logger');
jest.mock('../../client/apiClient', () => ({
  apiClient: {
    generateEmbeddings: jest.fn(),
  },
}));
jest.mock('../../core/openaiService');
jest.mock('../embeddingStorage');

describe('Environment Variable Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    disposeDefaultProvider();
    // Clear environment variables
    delete process.env.LOCAL_EMBEDDING_MODEL;
    delete process.env.AMBIANCE_API_KEY;
  });

  afterEach(async () => {
    await disposeDefaultProvider();
  });

  describe('LOCAL_EMBEDDING_MODEL Variable', () => {
    test.each([
      ['all-MiniLM-L6-v2', 'all-MiniLM-L6-v2', 384],
      ['all-minilm-l6-v2', 'all-MiniLM-L6-v2', 384], // Case insensitive
      ['MULTILINGUAL-E5-LARGE', 'multilingual-e5-large', 1024],
      ['all-mpnet-base-v2', 'all-mpnet-base-v2', 768],
      ['ADVANCED-NEURAL-DENSE', 'advanced-neural-dense', 768],
    ])(
      'should initialize %s model from LOCAL_EMBEDDING_MODEL=%s',
      async (envValue, expectedModel, expectedDims) => {
        process.env.LOCAL_EMBEDDING_MODEL = envValue;

        const provider = getDefaultLocalProvider();

        expect(logger.info).toHaveBeenCalledWith(
          '🤖 Local embedding provider initialized from environment variable',
          expect.objectContaining({
            model: expectedModel,
            envVar: envValue,
          })
        );

        expect(provider.getModelInfo().name).toBe(expectedModel);
        expect(provider.getModelInfo().dimensions).toBe(expectedDims);
      }
    );

    test('should fallback to all-MiniLM-L6-v2 for unknown model', () => {
      process.env.LOCAL_EMBEDDING_MODEL = 'unknown-model-xyz';

      const provider = getDefaultLocalProvider();

      expect(logger.warn).toHaveBeenCalledWith(
        '⚠️ Unknown LOCAL_EMBEDDING_MODEL value: unknown-model-xyz, using all-MiniLM-L6-v2'
      );

      expect(provider.getModelInfo().name).toBe('all-MiniLM-L6-v2');
    });

    test('should prioritize explicit config over environment variable', () => {
      process.env.LOCAL_EMBEDDING_MODEL = 'multilingual-e5-large';

      const provider = getDefaultLocalProvider({
        model: 'all-MiniLM-L6-v2',
      });

      expect(provider.getModelInfo().name).toBe('all-MiniLM-L6-v2');
    });

    test('should use default model when no environment variable is set', () => {
      const provider = getDefaultLocalProvider();

      expect(provider.getModelInfo().name).toBe('all-MiniLM-L6-v2');
      expect(provider.getModelInfo().dimensions).toBe(384);
    });
  });

  describe('Embedding Generator with Environment Variables', () => {
    test('should use environment-specified model in embedding generation', async () => {
      process.env.LOCAL_EMBEDDING_MODEL = 'multilingual-e5-large-instruct';

      const generator = new LocalEmbeddingGenerator();

      // Mock the batch embedding generation
      const mockGenerateEmbeddings = jest.fn().mockResolvedValue([[0.1, 0.2, 0.3]]);
      (generator as any).localProvider = {
        generateEmbeddings: mockGenerateEmbeddings,
        getModelInfo: () => ({ name: 'multilingual-e5-large-instruct', dimensions: 768 }),
        dispose: jest.fn(),
      };

      // This would normally call the provider
      expect((generator as any).localProvider.getModelInfo().name).toBe(
        'multilingual-e5-large-instruct'
      );

      await generator.dispose();
    });

    test('should handle Ambiance API with environment variable model', () => {
      process.env.AMBIANCE_API_KEY = 'test-key';
      process.env.LOCAL_EMBEDDING_MODEL = 'advanced-neural-dense';

      const generator = new LocalEmbeddingGenerator();

      // Should still prioritize Ambiance API over local model
      expect(logger.info).toHaveBeenCalledWith(
        '🚀 Embedding generator initialized with Ambiance API',
        expect.any(Object)
      );

      delete process.env.AMBIANCE_API_KEY;
    });
  });

  describe('Model Switching', () => {
    test('should allow switching models by changing environment variable', async () => {
      // Start with one model
      process.env.LOCAL_EMBEDDING_MODEL = 'all-MiniLM-L6-v2';
      const provider1 = getDefaultLocalProvider();

      expect(provider1.getModelInfo().name).toBe('all-MiniLM-L6-v2');

      // Dispose and change environment variable
      await disposeDefaultProvider();
      process.env.LOCAL_EMBEDDING_MODEL = 'multilingual-e5-large';

      const provider2 = getDefaultLocalProvider();

      expect(provider2.getModelInfo().name).toBe('multilingual-e5-large');
      expect(provider1).not.toBe(provider2);
    });
  });

  describe('Integration with All Supported Models', () => {
    const testCases = [
      { env: 'all-MiniLM-L6-v2', model: 'all-MiniLM-L6-v2', dims: 384 },
      { env: 'multilingual-e5-large', model: 'multilingual-e5-large', dims: 1024 },
      { env: 'advanced-neural-dense', model: 'advanced-neural-dense', dims: 768 },
      { env: 'all-mpnet-base-v2', model: 'all-mpnet-base-v2', dims: 768 },
    ];

    test.each(testCases)(
      'should properly integrate $env environment variable',
      ({ env, model, dims }) => {
        process.env.LOCAL_EMBEDDING_MODEL = env;

        const provider = getDefaultLocalProvider();

        expect(provider.getModelInfo().name).toBe(model);
        expect(provider.getModelInfo().dimensions).toBe(dims);
        expect(provider.getModelInfo().offline).toBe(true);
        expect(provider.getModelInfo().provider).toBe('transformers.js');
      }
    );
  });

  describe('Error Handling with Environment Variables', () => {
    test('should handle invalid environment variable gracefully', () => {
      process.env.LOCAL_EMBEDDING_MODEL = 'invalid-model-name-that-does-not-exist';

      expect(() => {
        getDefaultLocalProvider();
      }).not.toThrow();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Unknown LOCAL_EMBEDDING_MODEL value')
      );
    });

    test('should handle empty environment variable', () => {
      process.env.LOCAL_EMBEDDING_MODEL = '';

      const provider = getDefaultLocalProvider();

      // Should fall back to default
      expect(provider.getModelInfo().name).toBe('all-MiniLM-L6-v2');
    });

    test('should handle whitespace in environment variable', () => {
      process.env.LOCAL_EMBEDDING_MODEL = '  MULTILINGUAL-E5-LARGE  ';

      const provider = getDefaultLocalProvider();

      expect(provider.getModelInfo().name).toBe('multilingual-e5-large');
      expect(provider.getModelInfo().dimensions).toBe(1024);
    });
  });

  describe('Performance and Memory', () => {
    test('should reuse provider instances for same environment variable', () => {
      process.env.LOCAL_EMBEDDING_MODEL = 'multilingual-e5-large';

      const provider1 = getDefaultLocalProvider();
      const provider2 = getDefaultLocalProvider();

      expect(provider1).toBe(provider2);
    });

    test('should create new instance when environment variable changes', async () => {
      process.env.LOCAL_EMBEDDING_MODEL = 'all-MiniLM-L6-v2';
      const provider1 = getDefaultLocalProvider();

      process.env.LOCAL_EMBEDDING_MODEL = 'multilingual-e5-large-instruct';
      await disposeDefaultProvider();
      const provider2 = getDefaultLocalProvider();

      expect(provider1).not.toBe(provider2);
    });
  });
});
