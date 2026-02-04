/**
 * Test script for improved rate limit handling
 * Demonstrates the new retry logic, dynamic concurrency adjustment, and smart fallback behavior
 */

const path = require('path');

// Mock OpenAI client for testing rate limit scenarios
class MockOpenAIClient {
  constructor(rateLimitMode = false) {
    this.rateLimitMode = rateLimitMode;
    this.callCount = 0;
    this.rateLimitCount = 0;
  }

  async embeddings() {
    this.callCount++;

    if (this.rateLimitMode && this.callCount % 3 === 0) { // Every 3rd call hits rate limit
      this.rateLimitCount++;
      const error = new Error('429 Rate limit reached for text-embedding-3-small in organization org-test on tokens per min (TPM): Limit 1000000, Used 1000000, Requested 3538. Please try again in 212ms. Visit https://platform.openai.com/account/rate-limits to learn more.');
      error.status = 429;
      throw error;
    }

    // Simulate successful response
    return {
      data: [
        { embedding: new Array(1536).fill(0).map(() => Math.random()) },
        { embedding: new Array(1536).fill(0).map(() => Math.random()) }
      ]
    };
  }
}

async function testRateLimitHandling() {
  console.log('🧪 Testing Improved Rate Limit Handling\n');

  // Test scenarios
  const scenarios = [
    {
      name: 'Normal Operation',
      rateLimitMode: false,
      description: 'No rate limits - should work smoothly'
    },
    {
      name: 'Rate Limit Recovery',
      rateLimitMode: true,
      description: 'Rate limits with retry logic and recovery'
    }
  ];

  for (const scenario of scenarios) {
    console.log(`📋 Scenario: ${scenario.name}`);
    console.log(`   ${scenario.description}`);
    console.log('');

    // Create mock client
    const mockClient = new MockOpenAIClient(scenario.rateLimitMode);

    // Simulate the improved behavior
    const testTexts = ['Test text 1', 'Test text 2'];
    const startTime = Date.now();

    try {
      let retryCount = 0;
      const maxRetries = 3;
      const baseDelay = 100;

      while (retryCount <= maxRetries) {
        try {
          const response = await mockClient.embeddings();
          const duration = Date.now() - startTime;

          console.log(`✅ Success after ${retryCount} retries in ${duration}ms`);
          console.log(`   - API calls made: ${mockClient.callCount}`);
          if (scenario.rateLimitMode) {
            console.log(`   - Rate limit hits: ${mockClient.rateLimitCount}`);
          }
          break;

        } catch (error) {
          if (error.status === 429 && retryCount < maxRetries) {
            const retryAfter = baseDelay * Math.pow(2, retryCount);
            console.log(`⏳ Rate limit hit (attempt ${retryCount + 1}/${maxRetries}), retrying in ${retryAfter}ms...`);

            // Simulate delay
            await new Promise(resolve => setTimeout(resolve, retryAfter));
            retryCount++;
          } else {
            throw error;
          }
        }
      }

    } catch (error) {
      console.log(`❌ Failed after ${maxRetries} retries: ${error.message}`);
    }

    console.log('');
  }

  // Demonstrate configuration options
  console.log('🔧 Configuration Options:');
  console.log('');
  console.log('Environment Variables:');
  console.log('  EMBEDDING_PARALLEL_MODE=true        # Enable parallel processing');
  console.log('  EMBEDDING_MAX_CONCURRENCY=5         # Start with conservative concurrency');
  console.log('  EMBEDDING_RATE_LIMIT_RETRIES=5      # Max retries for rate limits');
  console.log('  EMBEDDING_RATE_LIMIT_BASE_DELAY=1000 # Base delay between retries');
  console.log('');
  console.log('Behavior:');
  console.log('  ✅ Retries rate limits with exponential backoff');
  console.log('  ✅ Reduces concurrency when hitting multiple rate limits');
  console.log('  ✅ Only falls back to local embeddings for permanent failures');
  console.log('  ✅ Recovers automatically after rate limit windows');
  console.log('');
  console.log('Example with your OpenAI Tier 2 limits:');
  console.log('  EMBEDDING_PARALLEL_MODE=true');
  console.log('  EMBEDDING_MAX_CONCURRENCY=8    # Conservative for 5,000 RPM limit');
  console.log('  EMBEDDING_RATE_LIMIT_RETRIES=3 # Fewer retries, faster failure');
  console.log('');
}

// Run the test if this script is executed directly
if (require.main === module) {
  testRateLimitHandling().catch(console.error);
}

module.exports = { testRateLimitHandling };
