/**
 * Test script for parallel embedding generation
 * Demonstrates the difference between sequential and parallel processing modes
 */

const path = require('path');
const { LocalEmbeddingGenerator } = require('../dist/local/embeddingGenerator');

// Test configuration
const TEST_PROJECT_PATH = process.cwd();
const TEST_PROJECT_ID = 'test-parallel-embeddings';

// Sample text chunks for testing
const testChunks = [
  'This is a sample text chunk for embedding generation testing.',
  'Another chunk of text to test the parallel processing capabilities.',
  'The third chunk contains different content for variety in testing.',
  'Fourth chunk to ensure we have enough data for meaningful batches.',
  'Fifth chunk to complete the test dataset for parallel processing.',
  'Sixth chunk provides additional context for embedding quality assessment.',
  'Seventh chunk ensures we have sufficient data for performance comparison.',
  'Eighth chunk rounds out the test set for comprehensive evaluation.',
  'Ninth chunk adds more variety to the embedding generation test.',
  'Tenth and final chunk completes the test dataset for benchmarking.'
];

async function testEmbeddingModes() {
  console.log('🧪 Testing Embedding Generation Modes\n');

  // Create test batches
  const batchSize = 3; // Small batches for testing
  const batches = [];
  for (let i = 0; i < testChunks.length; i += batchSize) {
    batches.push(testChunks.slice(i, i + batchSize));
  }

  console.log(`📊 Test Configuration:`);
  console.log(`   - Total chunks: ${testChunks.length}`);
  console.log(`   - Batch size: ${batchSize}`);
  console.log(`   - Number of batches: ${batches.length}`);
  console.log('');

  const generator = new LocalEmbeddingGenerator();

  // Test sequential mode
  console.log('🔄 Testing Sequential Mode (EMBEDDING_PARALLEL_MODE=false)');
  process.env.EMBEDDING_PARALLEL_MODE = 'false';

  const startSequential = Date.now();
  try {
    const sequentialResults = await generator.generateBatchesEmbeddings(batches, {
      parallelMode: false
    });
    const sequentialTime = Date.now() - startSequential;

    console.log(`✅ Sequential mode completed in ${sequentialTime}ms`);
    console.log(`   - Batches processed: ${sequentialResults.length}`);
    console.log(`   - Total embeddings: ${sequentialResults.flat().length}`);
    console.log('');
  } catch (error) {
    console.error('❌ Sequential mode failed:', error.message);
  }

  // Test parallel mode
  console.log('🚀 Testing Parallel Mode (EMBEDDING_PARALLEL_MODE=true)');
  process.env.EMBEDDING_PARALLEL_MODE = 'true';
  process.env.EMBEDDING_MAX_CONCURRENCY = '5'; // Limit concurrency for testing

  const startParallel = Date.now();
  try {
    const parallelResults = await generator.generateBatchesEmbeddings(batches, {
      parallelMode: true,
      maxConcurrency: 5
    });
    const parallelTime = Date.now() - startParallel;

    console.log(`✅ Parallel mode completed in ${parallelTime}ms`);
    console.log(`   - Batches processed: ${parallelResults.length}`);
    console.log(`   - Total embeddings: ${parallelResults.flat().length}`);
    console.log(`   - Max concurrency: 5`);
    console.log('');
  } catch (error) {
    console.error('❌ Parallel mode failed:', error.message);
  }

  // Environment variable configuration guide
  console.log('🔧 Environment Variable Configuration:');
  console.log('   EMBEDDING_PARALLEL_MODE=true      # Enable parallel processing');
  console.log('   EMBEDDING_PARALLEL_MODE=false     # Use sequential processing (default)');
  console.log('   EMBEDDING_MAX_CONCURRENCY=10      # Max concurrent API calls (default: 10)');
  console.log('   EMBEDDING_BATCH_SIZE=32           # Texts per batch (default: 32)');
  console.log('');

  console.log('📝 Notes:');
  console.log('   - Parallel mode respects OpenAI rate limits (5,000 RPM for Tier 2)');
  console.log('   - Sequential mode is more conservative and reliable');
  console.log('   - Use parallel mode for large projects with many small files');
  console.log('   - Monitor API usage to stay within rate limits');

  await generator.dispose();
}

// Run the test if this script is executed directly
if (require.main === module) {
  testEmbeddingModes().catch(console.error);
}

module.exports = { testEmbeddingModes };
