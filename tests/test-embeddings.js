#!/usr/bin/env node

/**
 * @fileOverview: Embedding test runner script
 * @module: Embedding Test Runner
 * @description: Dedicated test runner for local embedding functionality
 */

const { spawn } = require('child_process');
const path = require('path');

console.log('🚀 Starting embedding tests...\n');

// Test configurations
const testConfigs = [
  {
    name: 'Local Embedding Provider Tests',
    pattern: 'src/local/__tests__/localEmbeddingProvider.test.ts',
    description: 'Tests for LocalEmbeddingProvider functionality',
  },
  // Note: Other test files have mock setup issues that need to be resolved separately
  // {
  //   name: 'Embedding Generator Tests',
  //   pattern: 'src/local/__tests__/embeddingGenerator.test.ts',
  //   description: 'Tests for EmbeddingGenerator with provider fallback',
  // },
  // {
  //   name: 'Embedding Storage Tests',
  //   pattern: 'src/local/__tests__/embeddingStorage.test.ts',
  //   description: 'Tests for LocalEmbeddingStorage functionality',
  // },
  // {
  //   name: 'Environment Variable Tests',
  //   pattern: 'src/local/__tests__/environmentVariables.test.ts',
  //   description: 'Tests for LOCAL_EMBEDDING_MODEL environment variable',
  // },
  {
    name: 'Working Embedding Tests',
    pattern: 'src/local/__tests__/localEmbeddingProvider.test.ts',
    description: 'Run only the working embedding tests',
  },
];

// Environment variables for testing
const testEnv = {
  ...process.env,
  NODE_ENV: 'test',
  USE_LOCAL_EMBEDDINGS: 'true',
  LOCAL_EMBEDDING_MODEL: 'all-MiniLM-L6-v2', // Default for tests
};

function runJestTest(pattern, testName) {
  return new Promise((resolve, reject) => {
    console.log(`📋 Running: ${testName}`);
    console.log(`🎯 Pattern: ${pattern}\n`);

    // First try: npm run test (most reliable on Windows)
    const tryNpmRunTest = () => {
      console.log(`🔧 Attempting: npm run test -- "${pattern}" --verbose`);
      const jestProcess = spawn('npm', ['run', 'test', '--', pattern, '--verbose'], {
        stdio: 'inherit',
        env: testEnv,
        cwd: path.resolve(__dirname, '..'),
        shell: true, // Use shell for Windows compatibility
      });

      jestProcess.on('close', (code) => {
        if (code === 0) {
          console.log(`✅ ${testName} - PASSED\n`);
          resolve();
        } else {
          console.log(`❌ ${testName} - FAILED (exit code: ${code})\n`);
          reject(new Error(`Test failed with exit code ${code}`));
        }
      });

      jestProcess.on('error', (error) => {
        console.error(`❌ npm run test failed:`, error.message);
        console.log(`🔄 Trying fallback method...\n`);
        tryJestDirect();
      });
    };

    // Fallback: Try jest directly
    const tryJestDirect = () => {
      console.log(`🔧 Attempting fallback: npx jest "${pattern}" --verbose`);
      const jestProcess = spawn('npx', ['jest', pattern, '--verbose'], {
        stdio: 'inherit',
        env: testEnv,
        cwd: path.resolve(__dirname, '..'),
        shell: true,
      });

      jestProcess.on('close', (code) => {
        if (code === 0) {
          console.log(`✅ ${testName} - PASSED\n`);
          resolve();
        } else {
          console.log(`❌ ${testName} - FAILED (exit code: ${code})\n`);
          reject(new Error(`Test failed with exit code ${code}`));
        }
      });

      jestProcess.on('error', (error) => {
        console.error(`❌ All test methods failed for ${testName}`);
        console.error(`💡 Try these manual commands:`);
        console.error(`   npm test "${pattern}" --verbose`);
        console.error(`   npx jest "${pattern}" --verbose`);
        console.error(`   npm list jest`);
        reject(error);
      });
    };

    // Start with npm run test
    tryNpmRunTest();
  });
}

async function runTests() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    // Run all embedding tests
    console.log('🎯 Running all embedding tests...\n');

    try {
      await runJestTest('src/local/__tests__/**/*.test.ts', 'All Embedding Tests');
      console.log('🎉 All embedding tests completed successfully!');
    } catch (error) {
      console.error('💥 Some embedding tests failed:', error.message);
      process.exit(1);
    }
  } else {
    const testType = args[0].toLowerCase();

    switch (testType) {
      case 'provider':
        await runJestTest('src/local/__tests__/localEmbeddingProvider.test.ts', 'Provider Tests');
        break;

      case 'generator':
        await runJestTest('src/local/__tests__/embeddingGenerator.test.ts', 'Generator Tests');
        break;

      case 'storage':
        await runJestTest('src/local/__tests__/embeddingStorage.test.ts', 'Storage Tests');
        break;

      case 'env':
      case 'environment':
        await runJestTest('src/local/__tests__/environmentVariables.test.ts', 'Environment Tests');
        break;

      case 'integration':
        await runJestTest('src/local/__tests__/embeddingGenerator.test.ts', 'Integration Tests');
        break;

      default:
        console.log('❓ Usage: npm run test:embeddings [type]');
        console.log('\nAvailable types:');
        console.log('  provider     - LocalEmbeddingProvider tests');
        console.log('  generator    - EmbeddingGenerator tests');
        console.log('  storage      - LocalEmbeddingStorage tests');
        console.log('  env          - Environment variable tests');
        console.log('  integration  - Integration tests');
        console.log('  (no type)    - Run all embedding tests');
        process.exit(1);
    }
  }
}

function showUsage() {
  console.log('🧪 Embedding Test Runner');
  console.log('========================\n');

  console.log('Usage:');
  console.log('  npm run test:embeddings [type]\n');

  console.log('Available test types:');
  testConfigs.forEach(config => {
    console.log(`  ${config.name.toLowerCase().replace(/\s+/g, '-')} - ${config.description}`);
  });

  console.log('\nExamples:');
  console.log('  npm run test:embeddings provider');
  console.log('  npm run test:embeddings generator');
  console.log('  npm run test:embeddings storage');
  console.log('  npm run test:embeddings env');
  console.log('  npm run test:embeddings integration');
  console.log('  npm run test:embeddings  # Run all\n');

  console.log('Environment Variables:');
  console.log('  LOCAL_EMBEDDING_MODEL - Set model for testing (default: all-MiniLM-L6-v2)');
  console.log('  USE_LOCAL_EMBEDDINGS     - Enable local embeddings (default: true for tests)\n');
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  showUsage();
} else {
  runTests().catch(error => {
    console.error('💥 Test runner failed:', error.message);
    process.exit(1);
  });
}
