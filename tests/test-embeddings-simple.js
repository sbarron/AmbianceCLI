#!/usr/bin/env node

/**
 * @fileOverview: Simple embedding test runner using Node.js built-in test runner
 * @module: Simple Embedding Test Runner
 * @description: Alternative test runner for environments where Jest might have issues
 */

const { execSync, spawn } = require('child_process');
const path = require('path');

console.log('🚀 Starting simple embedding tests...\n');

// Environment variables for testing
const testEnv = {
  ...process.env,
  NODE_ENV: 'test',
  USE_LOCAL_EMBEDDINGS: 'true',
  LOCAL_EMBEDDING_MODEL: 'all-MiniLM-L6-v2',
};

// Test files to run
const testFiles = [
  'src/local/__tests__/localEmbeddingProvider.test.ts',
  'src/local/__tests__/embeddingGenerator.test.ts',
  'src/local/__tests__/embeddingStorage.test.ts',
  'src/local/__tests__/environmentVariables.test.ts',
];

function runTestFile(testFile, testName) {
  return new Promise((resolve, reject) => {
    console.log(`📋 Running: ${testName}`);
    console.log(`🎯 File: ${testFile}\n`);

    try {
      // Try using npm test first
      console.log(`🔧 Attempting: npm test -- "${testFile}"`);
      const testProcess = spawn('npm', ['test', '--', testFile], {
        stdio: 'inherit',
        env: testEnv,
        cwd: path.resolve(__dirname, '..'),
        shell: true,
      });

      testProcess.on('close', (code) => {
        if (code === 0) {
          console.log(`✅ ${testName} - PASSED\n`);
          resolve();
        } else {
          console.log(`❌ ${testName} - FAILED (exit code: ${code})\n`);
          reject(new Error(`Test failed with exit code ${code}`));
        }
      });

      testProcess.on('error', (error) => {
        console.error(`❌ Error running ${testName}:`, error.message);
        console.log(`🔄 Trying alternative approach...\n`);
        tryAlternative(testFile, testName, resolve, reject);
      });

    } catch (error) {
      console.error(`❌ Failed to start test for ${testName}:`, error.message);
      reject(error);
    }
  });
}

function tryAlternative(testFile, testName, resolve, reject) {
  try {
    // Try using npx jest directly
    console.log(`🔧 Attempting: npx jest "${testFile}"`);
    const altProcess = spawn('npx', ['jest', testFile], {
      stdio: 'inherit',
      env: testEnv,
      cwd: path.resolve(__dirname, '..'),
      shell: true,
    });

    altProcess.on('close', (code) => {
      if (code === 0) {
        console.log(`✅ ${testName} - PASSED\n`);
        resolve();
      } else {
        console.log(`❌ ${testName} - FAILED (exit code: ${code})\n`);
        reject(new Error(`Test failed with exit code ${code}`));
      }
    });

    altProcess.on('error', (error) => {
      console.error(`❌ All methods failed for ${testName}`);
      console.error(`💡 Try these manual commands:`);
      console.error(`   npm test "${testFile}"`);
      console.error(`   npx jest "${testFile}"`);
      console.error(`   node_modules/.bin/jest "${testFile}"`);
      reject(error);
    });

  } catch (error) {
    console.error(`❌ Alternative method also failed for ${testName}`);
    reject(error);
  }
}

async function runAllTests() {
  console.log('🎯 Running all embedding test files...\n');

  const testCases = [
    { file: testFiles[0], name: 'LocalEmbeddingProvider Tests' },
    { file: testFiles[1], name: 'EmbeddingGenerator Tests' },
    { file: testFiles[2], name: 'EmbeddingStorage Tests' },
    { file: testFiles[3], name: 'Environment Variables Tests' },
  ];

  for (const testCase of testCases) {
    try {
      await runTestFile(testCase.file, testCase.name);
    } catch (error) {
      console.error(`💥 Test suite failed: ${error.message}`);
      console.log('Continuing with remaining tests...\n');
    }
  }
}

function showUsage() {
  console.log('🧪 Simple Embedding Test Runner');
  console.log('=================================\n');

  console.log('Usage:');
  console.log('  node scripts/test-embeddings-simple.js\n');

  console.log('This runner will automatically try multiple methods to run Jest tests:');
  console.log('1. npm test (recommended)');
  console.log('2. npx jest (fallback)');
  console.log('\n');

  console.log('Test Files:');
  testFiles.forEach((file, index) => {
    console.log(`  ${index + 1}. ${file}`);
  });

  console.log('\nEnvironment Variables:');
  console.log('  LOCAL_EMBEDDING_MODEL - Set model for testing (default: all-MiniLM-L6-v2)');
  console.log('  USE_LOCAL_EMBEDDINGS     - Enable local embeddings (default: true)\n');

  console.log('Manual Commands:');
  console.log('  npm test "src/local/__tests__/**/*.test.ts"');
  console.log('  npx jest "src/local/__tests__/**/*.test.ts"');
  console.log('  node_modules/.bin/jest "src/local/__tests__/**/*.test.ts"\n');
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  showUsage();
} else {
  runAllTests().then(() => {
    console.log('🎉 Simple embedding test run completed!');
  }).catch(error => {
    console.error('💥 Simple test runner failed:', error.message);
    process.exit(1);
  });
}
