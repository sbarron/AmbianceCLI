# Local Embedding Tests

This directory contains comprehensive test suites for the local embedding functionality.

## Test Suites

### 1. LocalEmbeddingProvider Tests (`localEmbeddingProvider.test.ts`)
Tests for the core embedding provider functionality:
- Model initialization and configuration
- Embedding generation for different text inputs
- Model mapping and dimension handling
- Pipeline management and disposal
- Error handling and fallback logic

### 2. EmbeddingGenerator Tests (`embeddingGenerator.test.ts`)
Integration tests for the embedding generator:
- Provider selection logic (Local → OpenAI → VoyageAI with explicit enabling)
- Batch embedding generation
- Metadata tracking and validation
- Error handling across providers

### 3. EmbeddingStorage Tests (`embeddingStorage.test.ts`)
Tests for local embedding storage:
- Database initialization and schema creation
- Embedding storage and retrieval
- Similarity search functionality
- Metadata handling (format, dimensions, provider)
- Error handling and cleanup

### 4. Environment Variable Tests (`environmentVariables.test.ts`)
Tests for environment variable integration:
- `LOCAL_EMBEDDING_MODEL` variable handling
- Model switching and configuration
- Fallback behavior for invalid values
- Integration with provider initialization

## Supported Models

The tests cover all supported embedding models:

| Model | Dimensions | Environment Variable |
|-------|------------|---------------------|
| `all-MiniLM-L6-v2` | 384 | `all-MiniLM-L6-v2` |
| `multilingual-e5-large` | 1024 | `multilingual-e5-large` |
| `advanced-neural-dense` | 768 | `advanced-neural-dense` |
| `all-mpnet-base-v2` | 768 | `all-mpnet-base-v2` |

## Running Tests

### Run All Embedding Tests
```bash
npm run test:embeddings
```

### Run Specific Test Suites
```bash
# Provider tests
npm run test:embeddings:provider

# Generator tests
npm run test:embeddings:generator

# Storage tests
npm run test:embeddings:storage

# Environment variable tests
npm run test:embeddings:env

# Integration tests
npm run test:embeddings:integration
```

### Using the Test Runner Script Directly
```bash
# Show help
node scripts/test-embeddings.js --help

# Run specific test type
node scripts/test-embeddings.js provider
node scripts/test-embeddings.js generator
node scripts/test-embeddings.js storage
node scripts/test-embeddings.js env
```

## Environment Variables for Testing

### LOCAL_EMBEDDING_MODEL
Set the embedding model to use for testing:
```bash
export LOCAL_EMBEDDING_MODEL=multilingual-e5-large
npm run test:embeddings
```

Supported values:
- `all-MiniLM-L6-v2` (default)
- `multilingual-e5-large`
- `advanced-neural-dense`
- `all-mpnet-base-v2`

### USE_LOCAL_EMBEDDINGS
Enable local storage for tests:
```bash
export USE_LOCAL_EMBEDDINGS=true
```

## Test Configuration

### Jest Configuration
The tests use the main Jest configuration from `jest.config.js` with:
- TypeScript support via `ts-jest`
- Node.js test environment
- Custom module name mapping for mocks
- 10-second timeout for async operations

### Mocks
The tests use comprehensive mocking:
- **Transformers.js**: Mocked to avoid actual model downloads
- **SQLite3**: Mocked database operations
- **File System**: Mocked file operations
- **Logger**: Captured logging output for assertions
- **API Client**: Mocked external API calls

## Test Coverage

The test suite covers:

✅ **Model Initialization**
- All supported models
- Environment variable configuration
- Fallback to defaults

✅ **Embedding Generation**
- Single and batch text processing
- Error handling and validation
- Pipeline management

✅ **Provider Selection**
- Local opensource models as default
- Explicit enabling for OpenAI/VoyageAI
- Graceful degradation and error recovery

✅ **Storage Operations**
- Database schema and operations
- Metadata storage and retrieval
- Similarity search

✅ **Environment Integration**
- Variable parsing and validation
- Case-insensitive handling
- Unknown value fallback

## Writing New Tests

When adding new tests:

1. **Follow naming convention**: `[module].test.ts`
2. **Use descriptive test names**: `should [expected behavior]`
3. **Mock external dependencies**: Avoid actual API calls and file I/O
4. **Test both success and error cases**: Include failure scenarios
5. **Clean up resources**: Dispose of providers and close connections

### Example Test Structure
```typescript
describe('MyComponent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Setup
  });

  afterEach(async () => {
    // Cleanup
  });

  test('should handle success case', async () => {
    // Arrange
    // Act
    // Assert
  });

  test('should handle error case', async () => {
    // Arrange
    // Act
    // Assert
  });
});
```

## Debugging Tests

### Verbose Output
```bash
npm run test:embeddings:provider -- --verbose
```

### Debug Specific Test
```bash
npm run test:embeddings -- --testNamePattern="should initialize with advanced-neural-dense model"
```

### Coverage Report
```bash
npm run test:coverage
```

## Continuous Integration

The embedding tests are designed to run in CI environments:
- No external dependencies required (all mocked)
- Fast execution (< 30 seconds for full suite)
- Deterministic results
- Comprehensive error reporting

## Windows Compatibility

### Alternative Test Methods

If you encounter `spawn npx ENOENT` errors on Windows, try these alternatives:

#### Simple Test Runner (Recommended for Windows)
```bash
npm run test:embeddings:simple
node scripts/test-embeddings-simple.js
```

#### Direct Jest Command
```bash
npm run test:embeddings:direct
jest src/local/__tests__/**/*.test.ts --verbose
```

#### Manual Commands (if npm scripts fail)
```bash
# Try these in order if npm scripts don't work
npx jest src/local/__tests__/**/*.test.ts --verbose
npm test "src/local/__tests__/**/*.test.ts" --verbose
node_modules/.bin/jest src/local/__tests__/**/*.test.ts --verbose
```

### Troubleshooting Steps

1. **Check Jest Installation:**
   ```bash
   npm list jest
   ```

2. **Verify Node.js/npm:**
   ```bash
   node --version
   npm --version
   where npx
   ```

3. **Check PATH:**
   ```bash
   echo $PATH
   ```

4. **Try with different shells:**
   - PowerShell: `npm run test:embeddings:simple`
   - Command Prompt: `npm run test:embeddings:simple`
   - Git Bash: `./node_modules/.bin/jest src/local/__tests__/**/*.test.ts --verbose`

### Test Runner Features

The test runners include:
- **Automatic fallback**: Tries multiple methods to run Jest
- **Better error messages**: Provides helpful debugging information
- **Windows shell support**: Uses `shell: true` for better Windows compatibility
- **Environment validation**: Sets up test environment variables automatically

### Troubleshooting TypeScript Errors

#### "Argument type not assignable to parameter of type 'never'"

**Problem**: Mock functions are incorrectly typed, causing TypeScript to infer `never` types for mock method parameters.

**Root Cause**: Jest mock functions without proper typing can cause TypeScript to infer overly restrictive types.

**Solution**: Use `jest.MockedFunction<any>` typing for mock functions that need to handle various return types:

```typescript
// ❌ Incorrect - causes TypeScript errors
const mockSupabaseClient = {
  rpc: jest.fn(),
  // ... other mocks
};

// ✅ Correct - allows flexible typing
const mockSupabaseClient = {
  rpc: jest.fn() as jest.MockedFunction<any>,
  // ... other mocks
};
```

**Example Fix**:
```typescript
// Before (causes TS2345 errors)
mockSupabaseClient.rpc.mockResolvedValue({
  data: mockRepoId,
  error: null,
});

// After (works correctly)
mockSupabaseClient.rpc.mockResolvedValue({
  data: mockRepoId,
  error: null,
} as any); // Or use properly typed mock from the start
```

This fix resolves the 29 TypeScript errors in `databaseFunctions.test.ts` and similar issues in other test files.
