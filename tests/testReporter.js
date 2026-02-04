/**
 * Custom Jest Reporter for detailed test failure tracking
 * This reporter captures all test failures and displays them in a clear format at the end
 */

class TestFailureReporter {
  constructor() {
    this.failures = [];
    this.currentTest = null;
  }

  onRunStart() {
    console.log('\n🧪 Starting test run...\n');
  }

  onTestStart(test) {
    this.currentTest = test;
  }

  onTestResult(test, testResult) {
    // Track any failures in this test suite
    testResult.testResults.forEach(result => {
      if (result.status === 'failed') {
        this.failures.push({
          testFile: test.path,
          testName: result.fullName,
          error: result.failureMessages,
          duration: result.duration
        });
      }
    });
  }

  onRunComplete(contexts, results) {
    console.log('\n' + '='.repeat(80));
    console.log('📊 TEST RUN SUMMARY');
    console.log('='.repeat(80));
    
    const { numTotalTests, numPassedTests, numFailedTests, numPendingTests } = results;
    
    console.log(`Total Tests: ${numTotalTests}`);
    console.log(`✅ Passed: ${numPassedTests}`);
    console.log(`❌ Failed: ${numFailedTests}`);
    console.log(`⏸️  Pending: ${numPendingTests}`);
    
    if (this.failures.length > 0) {
      console.log('\n' + '❌'.repeat(20) + ' FAILED TESTS ' + '❌'.repeat(20));
      
      this.failures.forEach((failure, index) => {
        console.log(`\n${index + 1}. ${failure.testName}`);
        console.log(`   File: ${failure.testFile}`);
        console.log(`   Duration: ${failure.duration}ms`);
        console.log('   Error:');
        
        failure.error.forEach(error => {
          // Clean up the error message for better readability
          const cleanError = error
            .replace(/Error: /g, '')
            .replace(/at.*\(.*\)/g, '') // Remove stack trace lines
            .replace(/\n\s*\n/g, '\n') // Remove extra blank lines
            .trim();
          
          console.log(`     ${cleanError}`);
        });
        
        console.log('-'.repeat(60));
      });
      
      console.log(`\n💡 Total Failures: ${this.failures.length}`);
      console.log('\n🔍 To debug a specific failure, run:');
      console.log(`   npm test -- --testNamePattern="${this.failures[0].testName}"`);
    } else {
      console.log('\n🎉 All tests passed!');
    }
    
    console.log('='.repeat(80));
  }
}

export default TestFailureReporter;
