#!/usr/bin/env node

/**
 * Enhanced test runner with improved error reporting
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../..');

console.log('🚀 Starting enhanced test run with improved error reporting...\n');

// Run Jest with our custom reporter
const jestProcess = spawn('npx', ['jest', '--config', 'jest.config.js'], {
  stdio: 'pipe',
  cwd: projectRoot
});

let output = '';
let errorOutput = '';

jestProcess.stdout.on('data', (data) => {
  const text = data.toString();
  output += text;
  process.stdout.write(text);
});

jestProcess.stderr.on('data', (data) => {
  const text = data.toString();
  errorOutput += text;
  process.stderr.write(text);
});

jestProcess.on('close', (code) => {
  console.log('\n' + '='.repeat(80));
  console.log('🏁 TEST RUN COMPLETED');
  console.log('='.repeat(80));
  
  if (code === 0) {
    console.log('✅ All tests passed successfully!');
  } else {
    console.log(`❌ Test run failed with exit code: ${code}`);
    
    // Parse the output to extract failure information
    const failurePattern = /❌ Test failed: (.+)/g;
    const failures = [];
    let match;
    
    while ((match = failurePattern.exec(output)) !== null) {
      failures.push(match[1]);
    }
    
    if (failures.length > 0) {
      console.log('\n📋 Summary of test failures:');
      failures.forEach((failure, index) => {
        console.log(`  ${index + 1}. ${failure}`);
      });
    }
    
    console.log('\n💡 To debug specific failures:');
    console.log('   1. Run individual test files: npm test -- <test-file>');
    console.log('   2. Run with verbose output: npm test -- --verbose');
    console.log('   3. Run specific test: npm test -- --testNamePattern="test name"');
  }
  
  console.log('='.repeat(80));
  process.exit(code);
});

jestProcess.on('error', (error) => {
  console.error('❌ Failed to start test process:', error.message);
  process.exit(1);
});
