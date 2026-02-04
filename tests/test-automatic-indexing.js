#!/usr/bin/env node

/**
 * Test runner specifically for automatic indexing functionality
 * Runs all tests related to the automatic indexing system with detailed reporting
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

console.log('🧪 Running Automatic Indexing Test Suite\n');

const testCategories = [
  {
    name: 'Unit Tests - AutomaticIndexer',
    command: 'npm run test:unit',
    description: 'Core functionality of the AutomaticIndexer class',
  },
  {
    name: 'Integration Tests - MCP Tools',
    command: 'npm run test:integration',
    description: 'MCP tool implementations and handlers',
  },
  {
    name: 'Pattern Processing Tests',
    command: 'npm run test:patterns',
    description: 'Ignore pattern parsing and file filtering',
  },
  {
    name: 'File Watching Tests',
    command: 'npm run test:watching',
    description: 'File system watching and change detection',
  },
  {
    name: 'Database Function Tests',
    command: 'npm run test:database',
    description: 'Database function mocking and validation',
  },
];

let totalPassed = 0;
let totalFailed = 0;
const results = [];

console.log('📋 Test Categories:');
testCategories.forEach((category, index) => {
  console.log(`  ${index + 1}. ${category.name} - ${category.description}`);
});
console.log('');

for (const category of testCategories) {
  console.log(`\n🔄 Running: ${category.name}`);
  console.log(`   Command: ${category.command}`);
  console.log(`   Description: ${category.description}\n`);

  try {
    const output = execSync(category.command, {
      cwd: path.dirname(__dirname),
      encoding: 'utf8',
      stdio: 'pipe',
    });

    console.log('✅ PASSED');

    // Parse Jest output for test counts
    const passedMatch = output.match(/(\d+) passed/);
    const failedMatch = output.match(/(\d+) failed/);

    const passed = passedMatch ? parseInt(passedMatch[1]) : 0;
    const failed = failedMatch ? parseInt(failedMatch[1]) : 0;

    totalPassed += passed;
    totalFailed += failed;

    results.push({
      category: category.name,
      status: 'PASSED',
      passed,
      failed,
      details: output
        .split('\n')
        .filter(
          line =>
            line.includes('PASS') ||
            line.includes('FAIL') ||
            line.includes('✓') ||
            line.includes('✗')
        )
        .slice(0, 5), // Show first 5 relevant lines
    });

    console.log(`   Tests passed: ${passed}`);
    if (failed > 0) {
      console.log(`   Tests failed: ${failed}`);
    }
  } catch (error) {
    console.log('❌ FAILED');
    console.log(`   Error: ${error.message}`);

    totalFailed += 1;
    results.push({
      category: category.name,
      status: 'FAILED',
      error: error.message,
      details: error.stdout ? error.stdout.toString().split('\n').slice(-10) : [],
    });
  }
}

// Run coverage test
console.log(`\n🔄 Running: Coverage Analysis`);
try {
  const coverageOutput = execSync('npm run test:coverage', {
    cwd: path.dirname(__dirname),
    encoding: 'utf8',
    stdio: 'pipe',
  });

  console.log('✅ Coverage analysis completed');

  // Extract coverage percentages
  const coverageLines = coverageOutput
    .split('\n')
    .filter(
      line =>
        line.includes('%') &&
        (line.includes('Statements') || line.includes('Functions') || line.includes('Lines'))
    );

  results.push({
    category: 'Coverage Analysis',
    status: 'COMPLETED',
    details: coverageLines.slice(0, 10),
  });
} catch (error) {
  console.log('⚠️  Coverage analysis failed');
  console.log(`   Error: ${error.message}`);
}

// Generate summary report
console.log('\n' + '='.repeat(80));
console.log('📊 TEST SUMMARY REPORT');
console.log('='.repeat(80));

console.log(`\n📈 Overall Results:`);
console.log(`   Total tests passed: ${totalPassed}`);
console.log(`   Total tests failed: ${totalFailed}`);
console.log(
  `   Success rate: ${totalPassed + totalFailed > 0 ? Math.round((totalPassed / (totalPassed + totalFailed)) * 100) : 0}%`
);

console.log('\n📋 Category Breakdown:');
results.forEach((result, index) => {
  console.log(`\n${index + 1}. ${result.category}: ${result.status}`);

  if (result.passed !== undefined) {
    console.log(`   ✅ Passed: ${result.passed}`);
  }
  if (result.failed !== undefined && result.failed > 0) {
    console.log(`   ❌ Failed: ${result.failed}`);
  }
  if (result.error) {
    console.log(`   Error: ${result.error}`);
  }

  if (result.details && result.details.length > 0) {
    console.log('   Details:');
    result.details.forEach(detail => {
      if (detail.trim()) {
        console.log(`     ${detail.trim()}`);
      }
    });
  }
});

// Generate recommendations
console.log('\n💡 Recommendations:');

if (totalFailed === 0) {
  console.log('   🎉 All tests are passing! The automatic indexing system is ready.');
  console.log('   ✅ Consider running the full test suite to ensure integration compatibility.');
  console.log('   📝 Update the main AUTOMATIC_INDEXING.md documentation if needed.');
} else {
  console.log(`   🔧 ${totalFailed} test(s) need attention before deployment.`);
  console.log('   🐛 Review failed test output above for specific issues.');
  console.log('   📚 Check test implementation and mock configurations.');
}

console.log('\n🚀 Next Steps:');
console.log('   1. Run individual test categories with: npm run test:<category>');
console.log('   2. Run with watch mode for development: npm run test:watch');
console.log('   3. View detailed coverage report in coverage/ directory');
console.log('   4. Test real indexing functionality with: npm run benchmark:current');

console.log('\n' + '='.repeat(80));

// Exit with appropriate code
process.exit(totalFailed > 0 ? 1 : 0);
