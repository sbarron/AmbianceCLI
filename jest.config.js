/** @type {import('ts-jest').JestConfigWithTsJest} */
const includeIntegrationTests = process.env.RUN_INTEGRATION_TESTS === 'true';

const testMatch = includeIntegrationTests
  ? ['**/src/**/*.test.ts', '**/tests/**/*.test.js']
  : ['**/tests/**/*.test.js'];

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
    '^.+\\.ts$': ['ts-jest', {
      useESM: false,
      tsconfig: 'tsconfig.json',
      diagnostics: false
    }]
  },
  transformIgnorePatterns: [
    'node_modules/(?!(node-fetch|@babel|tree-sitter|@xenova))'
  ],
  moduleNameMapper: {
    '^node-fetch$': 'node-fetch',
    '^globby$': '<rootDir>/__mocks__/globby.js',
    '^fs$': '<rootDir>/__mocks__/fs.js',
    '^fs/promises$': '<rootDir>/__mocks__/fs.js',
    '^tree-sitter$': '<rootDir>/__mocks__/tree-sitter.js',
    '^tree-sitter-typescript$': '<rootDir>/__mocks__/tree-sitter-lang.js',
    '^tree-sitter-javascript$': '<rootDir>/__mocks__/tree-sitter-lang.js',
    '^tree-sitter-python$': '<rootDir>/__mocks__/tree-sitter-lang.js',
    '^@xenova/transformers$': '<rootDir>/__mocks__/@xenova/transformers.js',
  },
  // Add timeout and force exit to prevent hanging
  testTimeout: 10000,
  forceExit: true,
  // Verbose output for better debugging
  verbose: true
};