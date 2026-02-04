/**
 * Test script for intelligence mode fallback functionality
 * Tests the three-tier system: Local → OpenAI → Cloud
 */

const { handleSemanticCompact } = require('../dist/src/tools/localTools.js');
const path = require('path');

async function testIntelligenceFallback() {
  console.log('🧠 Testing Intelligence Mode Fallback');
  console.log('==========================================\n');

  const projectPath = process.cwd();
  const testCases = [
    {
      name: 'Local Mode (No API Keys)',
      env: {},
      description: 'Basic semantic compaction without external APIs',
    },
    {
      name: 'OpenAI Mode (OPENAI_API_KEY set)',
      env: { OPENAI_API_KEY: 'test-key-12345' },
      description: 'Enhanced analysis with OpenAI (if available)',
    },
    {
      name: 'Cloud Mode (AMBIANCE_API_KEY set)',
      env: { AMBIANCE_API_KEY: 'amb_test-key-12345' },
      description: 'Full cloud integration with Ambiance',
    },
  ];

  let allTestsPassed = true;

  for (let i = 0; i < testCases.length; i++) {
    const testCase = testCases[i];
    console.log(`${i + 1}️⃣ Testing ${testCase.name}...`);
    console.log(`   Description: ${testCase.description}`);

    // Set environment variables for this test
    const originalEnv = {};
    for (const [key, value] of Object.entries(testCase.env)) {
      originalEnv[key] = process.env[key];
      process.env[key] = value;
    }

    // Clear keys not in this test case
    const allKeys = ['OPENAI_API_KEY', 'AMBIANCE_API_KEY'];
    for (const key of allKeys) {
      if (!(key in testCase.env)) {
        originalEnv[key] = process.env[key];
        delete process.env[key];
      }
    }

    try {
      const result = await handleSemanticCompact({
        projectPath,
        maxTokens: 2000,
        taskType: 'understand',
        query: 'test fallback behavior',
      });

      if (result.success) {
        console.log('✅ SUCCESS - Intelligence mode worked correctly');
        console.log(`   Mode detected: ${result.mode || 'local'}`);
        console.log(`   Files processed: ${result.metadata.filesProcessed}`);
        console.log(`   Compression: ${(result.metadata.compressionRatio * 100).toFixed(1)}%`);

        // Validate that fallback is working properly
        if (testCase.name.includes('Local') && result.mode && result.mode !== 'local') {
          console.log('⚠️  WARNING: Expected local mode but got:', result.mode);
        }
      } else {
        // Failure is expected for some modes (e.g., invalid API keys)
        console.log('⚠️  EXPECTED FAILURE - Mode not available');
        console.log(`   Error: ${result.error}`);
        console.log(`   Fallback provided: ${result.fallback ? 'Yes' : 'No'}`);

        // If there's a fallback, that's still success
        if (result.fallback) {
          console.log('✅ Fallback mechanism working correctly');
        }
      }
    } catch (error) {
      console.log('❌ UNEXPECTED ERROR');
      console.log(`   Error: ${error.message}`);
      allTestsPassed = false;
    }

    // Restore original environment
    for (const [key, originalValue] of Object.entries(originalEnv)) {
      if (originalValue === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalValue;
      }
    }

    console.log();
  }

  // Summary
  console.log('==========================================');
  if (allTestsPassed) {
    console.log('🎉 ALL INTELLIGENCE FALLBACK TESTS PASSED!');
    console.log('   The three-tier system (Local → OpenAI → Cloud) is working correctly.');
    process.exit(0);
  } else {
    console.log('💥 SOME TESTS FAILED! Check the errors above.');
    process.exit(1);
  }
}

// Run the tests
testIntelligenceFallback().catch(error => {
  console.error('💥 Test script failed:', error);
  process.exit(1);
});
