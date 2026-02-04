/**
 * Standardized mock setup for common dependencies
 * Use this to ensure consistent mocking across all test files
 */

import { jest } from '@jest/globals';

/**
 * Standard mock for fs module - use this instead of custom fs mocks
 */
export function setupFsMocks() {
  jest.mock('fs', () => ({
    existsSync: jest.fn().mockReturnValue(true),
    statSync: jest.fn().mockReturnValue({
      isFile: () => true,
      isDirectory: () => false,
      size: 1024,
      mtime: new Date(),
    }),
    readdirSync: jest.fn().mockReturnValue(['test1.ts', 'test2.ts']),
    readFileSync: jest.fn().mockReturnValue('function test() { return "test content"; }'),
    writeFileSync: jest.fn().mockReturnValue(undefined),
    mkdirSync: jest.fn().mockReturnValue(undefined),
    rmSync: jest.fn().mockReturnValue(undefined),
    promises: {
      stat: jest.fn().mockResolvedValue({
        isFile: () => true,
        isDirectory: () => false,
        size: 1024,
        mtime: new Date(),
      } as any),
      readFile: jest.fn().mockResolvedValue('function test() { return "test content"; }' as any),
      writeFile: jest.fn().mockResolvedValue(undefined as any),
      mkdir: jest.fn().mockResolvedValue(undefined as any),
      rm: jest.fn().mockResolvedValue(undefined as any),
      readdir: jest.fn().mockResolvedValue(['test1.ts', 'test2.ts'] as any),
    },
  }));
}

/**
 * Standard mock for logger - ensures consistent logging behavior
 */
export function setupLoggerMocks() {
  jest.mock('../../utils/logger', () => ({
    logger: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    },
  }));
}

/**
 * Standard mock for API client
 */
export function setupApiClientMocks() {
  jest.mock('../../client/apiClient', () => ({
    apiClient: {
      post: jest.fn().mockResolvedValue({
        data: { embeddings: [[0.1, 0.2, 0.3]] },
      } as any),
      get: jest.fn().mockResolvedValue({ data: {} } as any),
      put: jest.fn().mockResolvedValue({ data: {} } as any),
      delete: jest.fn().mockResolvedValue({ data: {} } as any),
    },
  }));
}

/**
 * Standard mock for OpenAI service
 */
export function setupOpenAIMocks() {
  jest.mock('../../core/openaiService', () => ({
    openaiService: {
      isReady: jest.fn().mockReturnValue(true),
      createChatCompletion: jest.fn().mockResolvedValue({
        id: 'test',
        choices: [{ message: { content: 'test response', role: 'assistant' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      } as any),
      getProviderInfo: jest.fn().mockReturnValue({
        provider: 'OpenAI',
        model: 'gpt-4o',
        miniModel: 'gpt-4o-mini',
        supportsStreaming: true,
      }),
      getModelForTask: jest.fn().mockImplementation((...args: any[]) => {
        const task = args[0];
        return task === 'base' ? 'gpt-4o' : 'gpt-4o-mini';
      }),
    },
  }));
}

/**
 * Standard mock for embedding storage
 */
export function setupEmbeddingStorageMocks() {
  jest.mock('../../local/embeddingStorage', () => ({
    LocalEmbeddingStorage: jest.fn().mockImplementation(() => ({
      initializeDatabase: jest.fn().mockResolvedValue(undefined as any),
      ensureDimensionCompatibility: jest.fn().mockResolvedValue(undefined as any),
      storeEmbedding: jest.fn().mockResolvedValue(undefined as any),
      storeFileMetadata: jest.fn().mockResolvedValue(undefined as any),
      getEmbeddingMetadata: jest.fn().mockReturnValue({
        embeddingFormat: 'float32',
        embeddingDimensions: 1024,
        embeddingProvider: 'voyageai',
      }),
      getProjectEmbeddings: jest.fn().mockResolvedValue([] as any),
      clearProjectEmbeddings: jest.fn().mockResolvedValue(undefined as any),
      close: jest.fn().mockResolvedValue(undefined as any),
    })),
  }));
}

/**
 * Standard mock for tree-sitter processor
 */
export function setupTreeSitterMocks() {
  jest.mock('../../local/treeSitterProcessor', () => ({
    TreeSitterProcessor: jest.fn().mockImplementation(() => ({
      parseAndChunk: jest.fn().mockResolvedValue([
        {
          content: 'function test() { return "test"; }',
          symbols: ['test'],
          metadata: { language: 'typescript' },
        },
      ] as any),
      dispose: jest.fn(),
    })),
  }));
}

/**
 * Complete mock setup for most common dependencies
 * Use this in beforeAll/beforeEach for comprehensive mocking
 */
export function setupStandardMocks() {
  setupFsMocks();
  setupLoggerMocks();
  setupApiClientMocks();
  setupOpenAIMocks();
  setupEmbeddingStorageMocks();
  setupTreeSitterMocks();

  // Mock sqlite3 to avoid binding issues
  jest.mock('sqlite3', () => ({
    Database: jest.fn().mockImplementation(() => ({
      exec: jest.fn().mockImplementation((sql: any, callback: any) => callback?.(null)),
      prepare: jest.fn().mockReturnValue({
        run: jest.fn().mockImplementation((params: any, callback: any) => callback?.(null)),
        all: jest.fn().mockImplementation((params: any, callback: any) => callback?.(null, [])),
        get: jest.fn().mockImplementation((params: any, callback: any) => callback?.(null, null)),
        finalize: jest.fn(),
      }),
      close: jest.fn().mockImplementation((callback: any) => callback?.(null)),
    })),
  }));

  // Mock @xenova/transformers
  jest.mock('@xenova/transformers', () => ({
    pipeline: jest.fn().mockResolvedValue(() => Promise.resolve([[0.1, 0.2, 0.3]]) as any),
  }));
}

/**
 * Environment setup utilities
 */
export function setupTestEnvironment(overrides: Record<string, string> = {}) {
  const originalEnv = { ...process.env };

  // Set default test environment
  process.env.NODE_ENV = 'test';
  process.env.USE_LOCAL_EMBEDDINGS = 'true';
  process.env.LOCAL_EMBEDDING_MODEL = 'all-MiniLM-L6-v2';

  // Apply overrides
  Object.assign(process.env, overrides);

  return {
    restore: () => {
      process.env = originalEnv;
    },
  };
}

/**
 * Cleanup utility for after tests
 */
export function cleanupMocks() {
  jest.clearAllMocks();
  jest.resetModules();
}
