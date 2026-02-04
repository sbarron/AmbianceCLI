/**
 * Shared test utilities and mock helpers
 * Provides standardized mocking patterns for common dependencies
 */

import { jest } from '@jest/globals';

/**
 * Creates a mock logger with all required methods
 */
export function createMockLogger() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
}

/**
 * Creates a mock API client for embedding/API tests
 */
export function createMockApiClient() {
  return {
    post: jest.fn().mockResolvedValue({
      data: { embeddings: [[0.1, 0.2, 0.3]] },
    }) as jest.MockedFunction<any>,
    get: jest.fn().mockResolvedValue({ data: {} }) as jest.MockedFunction<any>,
    put: jest.fn().mockResolvedValue({ data: {} }) as jest.MockedFunction<any>,
    delete: jest.fn().mockResolvedValue({ data: {} }) as jest.MockedFunction<any>,
  };
}

/**
 * Creates a mock OpenAI service with standard responses
 */
export function createMockOpenAIService() {
  return {
    isReady: jest.fn().mockReturnValue(true),
    createChatCompletion: jest.fn().mockResolvedValue({
      id: 'test',
      choices: [{ message: { content: 'test response', role: 'assistant' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }),
    getProviderInfo: jest.fn().mockReturnValue({
      provider: 'OpenAI',
      model: 'gpt-4o',
      miniModel: 'gpt-4o-mini',
      supportsStreaming: true,
    }),
    getModelForTask: jest.fn().mockImplementation((task: string) => {
      return task === 'base' ? 'gpt-4o' : 'gpt-4o-mini';
    }) as jest.MockedFunction<any>,
  };
}

/**
 * Creates a mock embedding storage with standard operations
 */
export function createMockEmbeddingStorage() {
  return {
    initializeDatabase: jest.fn().mockResolvedValue(undefined) as jest.MockedFunction<any>,
    ensureDimensionCompatibility: jest
      .fn()
      .mockResolvedValue(undefined) as jest.MockedFunction<any>,
    storeEmbedding: jest.fn().mockResolvedValue(undefined) as jest.MockedFunction<any>,
    storeFileMetadata: jest.fn().mockResolvedValue(undefined) as jest.MockedFunction<any>,
    getEmbeddingMetadata: jest.fn().mockReturnValue({
      embeddingFormat: 'float32',
      embeddingDimensions: 1024,
      embeddingProvider: 'voyageai',
    }) as jest.MockedFunction<any>,
    getProjectEmbeddings: jest.fn().mockResolvedValue([]) as jest.MockedFunction<any>,
    clearProjectEmbeddings: jest.fn().mockResolvedValue(undefined) as jest.MockedFunction<any>,
    close: jest.fn().mockResolvedValue(undefined) as jest.MockedFunction<any>,
  };
}

/**
 * Creates mock file system functions with sensible defaults
 */
export function createMockFileSystem() {
  return {
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
  };
}

/**
 * Standard test content that passes validation
 */
export const VALID_TEST_CONTENT = {
  shortMessage:
    'This is a comprehensive test message with sufficient content to pass validation. It contains multiple sentences and provides meaningful context for testing functionality.',
  codeContent: `
export function testFunction(): string {
  return 'test';
}

export class TestClass {
  private value: number;

  constructor(initialValue: number) {
    this.value = initialValue;
  }

  getValue(): number {
    return this.value;
  }
}
  `,
  projectFiles: [
    {
      name: 'index.ts',
      content: 'export { TestClass } from "./test";\nexport { testFunction } from "./utils";',
    },
    { name: 'test.ts', content: 'export class TestClass { constructor() {} }' },
    { name: 'utils.ts', content: 'export function testFunction() { return "test"; }' },
  ],
};

/**
 * Provides consistent environment variable mocking
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
 * Creates a temporary test project structure
 */
export async function createTestProject(files: Array<{ name: string; content: string }>) {
  const fs = require('fs');
  const path = require('path');
  const os = require('os');

  const testDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'test-project-'));

  for (const file of files) {
    const filePath = path.join(testDir, file.name);
    const dirPath = path.dirname(filePath);

    // Ensure directory exists
    await fs.promises.mkdir(dirPath, { recursive: true });
    await fs.promises.writeFile(filePath, file.content);
  }

  return {
    path: testDir,
    cleanup: async () => {
      await fs.promises.rm(testDir, { recursive: true, force: true });
    },
  };
}

/**
 * Waits for a condition to be true with timeout
 */
export function waitFor(condition: () => boolean, timeout = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();

    function check() {
      if (condition()) {
        resolve();
      } else if (Date.now() - startTime > timeout) {
        reject(new Error('Timeout waiting for condition'));
      } else {
        setTimeout(check, 100);
      }
    }

    check();
  });
}

/**
 * Standardized test patterns for async operations
 */
export const TestPatterns = {
  /**
   * Tests that a function throws with proper error handling
   */
  async expectToThrow(fn: () => Promise<any>, expectedError: string | RegExp) {
    await expect(fn()).rejects.toThrow(expectedError);
  },

  /**
   * Tests that a function resolves successfully
   */
  async expectToResolve(fn: () => Promise<any>) {
    await expect(fn()).resolves.toBeDefined();
  },

  /**
   * Tests that a mock was called with specific arguments
   */
  expectMockCalledWith(mock: jest.Mock, ...args: any[]) {
    expect(mock).toHaveBeenCalledWith(...args);
  },

  /**
   * Tests that a mock was called at least once
   */
  expectMockCalled(mock: jest.Mock) {
    expect(mock).toHaveBeenCalled();
  },
};
