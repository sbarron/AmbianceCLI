/** @type {import('ts-jest').JestConfigWithTsJest} */
const includeIntegrationTests = process.env.RUN_INTEGRATION_TESTS === 'true';

// Source-level TypeScript tests are always part of the default quality gate.
// RUN_INTEGRATION_TESTS only controls the slower integration exclusions below.
const testMatch = ['**/src/**/*.test.ts', '**/tests/**/*.test.js'];

const testPathIgnorePatterns = [
  'tools-old/',
  'indexers-old/',
  'renderers-old/',
  'search-old/',
  'database-old/',
  'llm-old/',
  'types-old/',
];

if (!includeIntegrationTests) {
  testPathIgnorePatterns.push('\\.integration\\.test\\.ts$');
  testPathIgnorePatterns.push('src/__tests__/integration/');
  testPathIgnorePatterns.push('tests/integration/');
  testPathIgnorePatterns.push('src/local/__tests__/embeddingStorage.test.ts');
  testPathIgnorePatterns.push('src/local/__tests__/automaticIndexer.test.ts');
  testPathIgnorePatterns.push('src/local/__tests__/fileWatcher.test.ts');
  testPathIgnorePatterns.push('src/__tests__/examples/');
  testPathIgnorePatterns.push('src/core/__tests__/errorHandling.test.ts');
}

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch,
  setupFiles: ['<rootDir>/tests/setupEnv.js'],
  testPathIgnorePatterns,
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        useESM: false,
        tsconfig: 'tsconfig.json',
        diagnostics: false,
      },
    ],
  },
  transformIgnorePatterns: ['node_modules/(?!(node-fetch|@babel|tree-sitter|@xenova))'],
  moduleNameMapper: {
    '^node-fetch$': 'node-fetch',
    '^tree-sitter$': '<rootDir>/__mocks__/tree-sitter.js',
    '^tree-sitter-typescript$': '<rootDir>/__mocks__/tree-sitter-lang.js',
    '^tree-sitter-javascript$': '<rootDir>/__mocks__/tree-sitter-lang.js',
    '^tree-sitter-python$': '<rootDir>/__mocks__/tree-sitter-lang.js',
    '^@huggingface/transformers$': '<rootDir>/__mocks__/@huggingface/transformers.js',
    '^sqlite3$': '<rootDir>/__mocks__/sqlite3.js',
  },
  // Let Jest report leaked handles instead of masking them with forceExit.
  testTimeout: 10000,
  // Verbose output for better debugging
  verbose: true,
};
