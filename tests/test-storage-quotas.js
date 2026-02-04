#!/usr/bin/env node

/**
 * Test storage quota functionality
 */

const { LocalEmbeddingStorage } = require('../dist/src/local/embeddingStorage.js');

console.log('🧪 Testing Storage Quota Functionality');
console.log('=====================================');

async function testStorageQuotas() {
  // Create storage with quotas enabled
  const storage = new LocalEmbeddingStorage(undefined, false); // Disable quantization for this test
  await storage.initializeDatabase();

  console.log('\n📊 Testing quota configuration:');
  console.log('------------------------------');

  console.log(`Quotas enabled: ${storage.isQuotasEnabled()}`);
  console.log(`Global quota: ${storage.getGlobalQuota()} bytes (${(storage.getGlobalQuota() / 1024 / 1024 / 1024).toFixed(1)}GB)`);

  // Set a small project quota for testing
  const testProjectId = 'test-project';
  const testQuota = 10 * 1024; // 10KB for testing
  storage.setProjectQuota(testProjectId, testQuota);

  console.log(`Project quota for ${testProjectId}: ${testQuota} bytes`);

  // Test quota checking
  console.log('\n🔍 Testing quota checking:');
  console.log('---------------------------');

  const usage = await storage.getProjectStorageUsage(testProjectId);
  console.log('Initial usage:', {
    totalBytes: usage.totalBytes,
    quotaBytes: usage.quotaBytes,
    usagePercentage: usage.usagePercentage.toFixed(1) + '%',
    remainingBytes: usage.remainingBytes,
  });

  // Create some test embeddings
  const testEmbeddings = [
    {
      id: `${testProjectId}_file1_chunk1`,
      projectId: testProjectId,
      fileId: 'file1',
      filePath: '/test/file1.ts',
      chunkIndex: 0,
      content: 'console.log("test");',
      embedding: [0.1, 0.2, 0.3, 0.4, 0.5], // Small embedding for testing
      metadata: {
        type: 'code' as const,
        startLine: 1,
        endLine: 1,
      },
      hash: 'test-hash-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: `${testProjectId}_file1_chunk2`,
      projectId: testProjectId,
      fileId: 'file1',
      filePath: '/test/file1.ts',
      chunkIndex: 1,
      content: 'function test() { return "hello"; }',
      embedding: [0.2, 0.3, 0.4, 0.5, 0.6],
      metadata: {
        type: 'code' as const,
        startLine: 2,
        endLine: 4,
      },
      hash: 'test-hash-2',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  console.log('\n💾 Testing embedding storage:');
  console.log('-----------------------------');

  try {
    await storage.storeEmbedding(testEmbeddings[0]);
    console.log('✅ First embedding stored successfully');

    const usageAfter1 = await storage.getProjectStorageUsage(testProjectId);
    console.log('Usage after first embedding:', {
      totalBytes: usageAfter1.totalBytes,
      usagePercentage: usageAfter1.usagePercentage.toFixed(1) + '%',
      remainingBytes: usageAfter1.remainingBytes,
    });

    await storage.storeEmbedding(testEmbeddings[1]);
    console.log('✅ Second embedding stored successfully');

    const usageAfter2 = await storage.getProjectStorageUsage(testProjectId);
    console.log('Usage after second embedding:', {
      totalBytes: usageAfter2.totalBytes,
      usagePercentage: usageAfter2.usagePercentage.toFixed(1) + '%',
      remainingBytes: usageAfter2.remainingBytes,
    });

    // Test quota enforcement by trying to store a large embedding
    const largeEmbedding = {
      id: `${testProjectId}_large_file`,
      projectId: testProjectId,
      fileId: 'large_file',
      filePath: '/test/large.ts',
      chunkIndex: 0,
      content: 'x'.repeat(1000), // Large content
      embedding: new Array(1536).fill(0.1), // Large embedding
      metadata: {
        type: 'code' as const,
        startLine: 1,
        endLine: 100,
      },
      hash: 'test-large-hash',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    console.log('\n⚠️ Testing quota enforcement:');
    console.log('-----------------------------');

    try {
      await storage.storeEmbedding(largeEmbedding);
      console.log('❌ Large embedding stored - quota not enforced');
    } catch (error) {
      console.log('✅ Large embedding rejected - quota properly enforced');
      console.log('Error message:', error.message);
    }

    // Check final usage
    const finalUsage = await storage.getProjectStorageUsage(testProjectId);
    console.log('\n📈 Final storage usage:');
    console.log('-----------------------');
    console.log('Total bytes:', finalUsage.totalBytes);
    console.log('Quota bytes:', finalUsage.quotaBytes);
    console.log('Usage percentage:', finalUsage.usagePercentage.toFixed(1) + '%');
    console.log('Remaining bytes:', finalUsage.remainingBytes);
    console.log('Embedding count:', finalUsage.embeddingCount);

    if (finalUsage.usagePercentage < 100) {
      console.log('✅ Test PASSED - Quotas working correctly');
    } else {
      console.log('❌ Test FAILED - Quota exceeded');
    }

  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
  }

  // Clean up
  await storage.close();
  console.log('\n🧹 Storage test completed and cleaned up');
}

testStorageQuotas().catch(console.error);
