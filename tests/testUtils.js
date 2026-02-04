/**
 * Test utilities for better error handling and debugging
 */

/**
 * Enhanced expect wrapper that provides better error context
 */
function expectWithContext(value, context = '') {
  const enhancedExpect = expect(value);
  
  // Add custom matchers for better error messages
  enhancedExpect.toThrowWithContext = function(expectedError, errorContext = '') {
    try {
      if (typeof value === 'function') {
        value();
      }
      throw new Error('Expected function to throw an error');
    } catch (error) {
      const fullContext = context ? `${context}: ${errorContext}` : errorContext;
      const message = fullContext ? `${fullContext}\nActual error: ${error.message}` : error.message;
      
      if (expectedError) {
        expect(error.message).toContain(expectedError);
      }
      
      return enhancedExpect;
    }
  };
  
  return enhancedExpect;
}

/**
 * Test helper that captures and formats errors for better debugging
 */
function captureTestError(testFn, testName = '') {
  return async () => {
    try {
      await testFn();
    } catch (error) {
      console.error(`\n❌ Test failed: ${testName}`);
      console.error(`Error type: ${error.constructor.name}`);
      console.error(`Error message: ${error.message}`);
      
      if (error.stack) {
        // Show only the relevant part of the stack trace
        const stackLines = error.stack.split('\n');
        const relevantLines = stackLines.slice(0, 5); // First 5 lines
        console.error('Stack trace:');
        relevantLines.forEach(line => console.error(`  ${line}`));
      }
      
      throw error; // Re-throw to let Jest handle it
    }
  };
}

/**
 * Utility to create descriptive test names
 */
function describeTest(testName, testFn) {
  return describe(testName, () => {
    beforeAll(() => {
      console.log(`\n🧪 Running test suite: ${testName}`);
    });
    
    afterAll(() => {
      console.log(`✅ Completed test suite: ${testName}`);
    });
    
    testFn();
  });
}

/**
 * Utility to create descriptive test cases
 */
function itShould(description, testFn) {
  return it(`should ${description}`, captureTestError(testFn, description));
}

/**
 * Enhanced assertion for async operations
 */
async function expectAsync(promise, expectedError = null) {
  try {
    const result = await promise;
    return expect(result);
  } catch (error) {
    if (expectedError) {
      expect(error.message).toContain(expectedError);
    }
    throw error;
  }
}

module.exports = {
  expectWithContext,
  captureTestError,
  describeTest,
  itShould,
  expectAsync
};
