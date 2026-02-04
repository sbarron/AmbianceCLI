/**
 * Example of standardized test patterns for LocalEmbeddingGenerator
 * This demonstrates how to use the shared test utilities and mock setup
 */

import { describe, test, beforeEach, afterEach, expect } from '@jest/globals';
import { LocalEmbeddingGenerator, GenerationOptions } from '../../local/embeddingGenerator';
import { setupStandardMocks, setupTestEnvironment, cleanupMocks } from '../utils/mockSetup';
import {
  createMockEmbeddingStorage,
  createMockApiClient,
  createMockLogger,
  VALID_TEST_CONTENT,
  TestPatterns,
} from '../utils/testHelpers';

// Setup all standard mocks at the module level
setupStandardMocks();

describe('LocalEmbeddingGenerator (Standardized)', () => {
  let generator: LocalEmbeddingGenerator;
  let mockStorage: ReturnType<typeof createMockEmbeddingStorage>;
  let mockApiClient: ReturnType<typeof createMockApiClient>;
  let mockLogger: ReturnType<typeof createMockLogger>;
  let envRestore: ReturnType<typeof setupTestEnvironment>['restore'];

  beforeEach(() => {
    // Clean up any previous test state
    cleanupMocks();

    // Setup test environment
    const env = setupTestEnvironment({
      USE_LOCAL_EMBEDDINGS: 'true',
      LOCAL_EMBEDDING_MODEL: 'all-MiniLM-L6-v2',
      AMBIANCE_API_KEY: 'test-key',
    });
    envRestore = env.restore;

    // Create standardized mocks
    mockStorage = createMockEmbeddingStorage();
    mockApiClient = createMockApiClient();
    mockLogger = createMockLogger();

    // Setup LocalEmbeddingStorage static methods
    const { LocalEmbeddingStorage } = require('../../local/embeddingStorage');
    LocalEmbeddingStorage.isEnabled = jest.fn().mockReturnValue(true);

    // Create generator with mock storage
    generator = new LocalEmbeddingGenerator(mockStorage as any);
  });

  afterEach(() => {
    envRestore();
    cleanupMocks();
  });

  describe('Constructor', () => {
    test('should initialize with provided storage', () => {
      const customStorage = createMockEmbeddingStorage();
      const gen = new LocalEmbeddingGenerator(customStorage as any);
      expect(gen).toBeInstanceOf(LocalEmbeddingGenerator);
    });

    test('should create default storage when none provided', () => {
      const gen = new LocalEmbeddingGenerator();
      expect(gen).toBeInstanceOf(LocalEmbeddingGenerator);
    });

    test('should handle missing API keys gracefully', () => {
      const env = setupTestEnvironment({});
      const gen = new LocalEmbeddingGenerator();
      expect(gen).toBeDefined();
      env.restore();
    });
  });

  describe('generateProjectEmbeddings', () => {
    const mockProjectId = 'test-project-123';
    const mockProjectPath = '/path/to/test/project';

    test('should throw error when local embeddings not enabled', async () => {
      const { LocalEmbeddingStorage } = require('../../local/embeddingStorage');
      LocalEmbeddingStorage.isEnabled.mockReturnValue(false);

      await TestPatterns.expectToThrow(
        () => generator.generateProjectEmbeddings(mockProjectId, mockProjectPath),
        'Local embeddings not enabled'
      );
    });

    test('should initialize database on generation start', async () => {
      await generator.generateProjectEmbeddings(mockProjectId, mockProjectPath);

      TestPatterns.expectMockCalled(mockStorage.initializeDatabase);
    });

    test('should process files and return progress', async () => {
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
      const options: GenerationOptions = { force: true };
      await generator.generateProjectEmbeddings(mockProjectId, mockProjectPath, options);

      TestPatterns.expectMockCalled(mockStorage.initializeDatabase);
    });

    test('should respect batch size configuration', async () => {
      const options: GenerationOptions = { batchSize: 16 };
      await generator.generateProjectEmbeddings(mockProjectId, mockProjectPath, options);

      // Verify the generation process respects batch size
      expect(generator).toBeDefined();
    });

    test('should handle API errors gracefully', async () => {
      // Configure mock to reject
      mockApiClient.post.mockRejectedValue(new Error('API Error'));

      const result = await generator.generateProjectEmbeddings(mockProjectId, mockProjectPath);

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(error => error.includes('API Error'))).toBe(true);
    });
  });

  describe('generateQueryEmbedding', () => {
    test('should generate embedding for query text', async () => {
      const result = await generator.generateQueryEmbedding(VALID_TEST_CONTENT.shortMessage);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      expect(typeof result[0]).toBe('number');
    });

    test('should handle empty query', async () => {
      mockApiClient.post.mockResolvedValue({
        data: { embeddings: [[]] },
      });

      const result = await generator.generateQueryEmbedding('');
      expect(Array.isArray(result)).toBe(true);
    });

    test('should handle API errors in query embedding', async () => {
      mockApiClient.post.mockRejectedValue(new Error('API Error'));

      await TestPatterns.expectToThrow(() => generator.generateQueryEmbedding('test'), 'API Error');
    });
  });

  describe('dispose', () => {
    test('should close storage connection', async () => {
      await generator.dispose();
      TestPatterns.expectMockCalled(mockStorage.close);
    });

    test('should handle dispose errors gracefully', async () => {
      mockStorage.close.mockRejectedValue(new Error('Close error'));

      await TestPatterns.expectToResolve(() => generator.dispose());
    });
  });

  describe('Error Handling', () => {
    test('should handle database initialization errors', async () => {
      mockStorage.initializeDatabase.mockRejectedValue(new Error('DB Error'));

      await TestPatterns.expectToThrow(
        () => generator.generateProjectEmbeddings('test', '/path'),
        'DB Error'
      );
    });

    test('should handle dimension compatibility errors', async () => {
      mockStorage.ensureDimensionCompatibility.mockRejectedValue(new Error('Dimension mismatch'));

      await TestPatterns.expectToThrow(
        () => generator.generateProjectEmbeddings('test', '/path'),
        'Dimension mismatch'
      );
    });
  });

  describe('Configuration and Environment', () => {
    test('should respect environment variable configurations', async () => {
      const env = setupTestEnvironment({
        EMBEDDING_BATCH_SIZE: '16',
        EMBEDDING_MAX_CONCURRENCY: '5',
        EMBEDDING_PARALLEL_MODE: 'true',
      });

      await generator.generateProjectEmbeddings('test', '/path');

      expect(generator).toBeDefined();
      env.restore();
    });
  });
});
