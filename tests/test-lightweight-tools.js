/**
 * Manual test script for the three lightweight tools
 * This tests the tools against the current project
 */

const {
  handleSemanticCompact,
  handleProjectHints,
  handleFileSummary,
} = require('../dist/src/tools/localTools/index.js');
const path = require('path');

async function testLightweightTools() {
  console.log('🧪 Testing Lightweight Tools');
  console.log('=====================================\n');

  const projectPath = process.cwd();
  let allTestsPassed = true;

  // Test 1: local_context without embeddings
  console.log('1️⃣ Testing local_context (without embeddings)...');
  try {
    const result1 = await handleSemanticCompact({
      projectPath,
      maxTokens: 2000,
      taskType: 'understand',
      useEmbeddings: false,
      query: 'What is this project about?',
    });

    if (result1.success) {
      console.log('✅ local_context (no embeddings): SUCCESS');
      console.log(`   Files processed: ${result1.metadata.filesProcessed}`);
      console.log(`   Symbols found: ${result1.metadata.symbolsFound}`);
      console.log(`   Compression: ${(result1.metadata.compressionRatio * 100).toFixed(1)}%`);
      console.log(
        `   Tokens: ${result1.metadata.originalTokens} → ${result1.metadata.compactedTokens}`
      );
    } else {
      console.log('❌ local_context (no embeddings): FAILED');
      console.log(`   Error: ${result1.error}`);
      allTestsPassed = false;
    }
  } catch (error) {
    console.log('❌ local_context (no embeddings): EXCEPTION');
    console.log(`   Error: ${error.message}`);
    allTestsPassed = false;
  }
  console.log();

  // Test 1b: local_context with embeddings (if OpenAI key available)
  console.log('1️⃣ Testing local_context (with embeddings)...');
  try {
    const result1b = await handleSemanticCompact({
      projectPath,
      maxTokens: 2000,
      taskType: 'understand',
      useEmbeddings: true,
      query: 'How does authentication work in this codebase?',
      embeddingSimilarityThreshold: 0.2,
      maxSimilarChunks: 5,
    });

    if (result1b.success) {
      console.log('✅ local_context (with embeddings): SUCCESS');
      console.log(`   Files processed: ${result1b.metadata.filesProcessed}`);
      console.log(`   Symbols found: ${result1b.metadata.symbolsFound}`);
      console.log(`   Embeddings used: ${result1b.metadata.embeddingsUsed}`);
      console.log(`   Similar chunks found: ${result1b.metadata.similarChunksFound}`);
      console.log(`   Compression: ${(result1b.metadata.compressionRatio * 100).toFixed(1)}%`);
    } else {
      console.log('❌ local_context (with embeddings): FAILED');
      console.log(`   Error: ${result1b.error}`);
      // Don't fail all tests if embeddings fail due to missing API key
      if (result1b.error.includes('API key') || result1b.error.includes('network')) {
        console.log('   ⚠️  This is expected if OpenAI API key is not configured');
      } else {
        allTestsPassed = false;
      }
    }
  } catch (error) {
    console.log('❌ local_context (with embeddings): EXCEPTION');
    console.log(`   Error: ${error.message}`);
    // Don't fail all tests if embeddings fail due to missing API key
    if (error.message.includes('API key') || error.message.includes('network')) {
      console.log('   ⚠️  This is expected if OpenAI API key is not configured');
    } else {
      allTestsPassed = false;
    }
  }
  console.log();

  // Test 2: local_project_hints (handleProjectHints)
  console.log('2️⃣ Testing local_project_hints...');
  try {
    const result2 = await handleProjectHints({
      projectPath,
      format: 'compact',
      maxFiles: 50,
    });

    if (result2.success) {
      console.log('✅ local_project_hints: SUCCESS');
      console.log(`   Files analyzed: ${result2.metadata.filesAnalyzed}`);
      console.log(`   Folders found: ${result2.metadata.foldersFound}`);
      console.log(`   Languages: ${result2.metadata.primaryLanguages.join(', ')}`);
      console.log(`   Architecture: ${result2.metadata.architecturePatterns.join(', ')}`);

      // Check for file composition data
      console.log(`   Full metadata keys: ${Object.keys(result2.metadata).join(', ')}`);
      if (result2.metadata.fileComposition) {
        console.log('   ✅ File Composition found:');
        console.log(`     Total files: ${result2.metadata.fileComposition.totalFiles}`);
        console.log(`     Analyzed files: ${result2.metadata.fileComposition.analyzedFiles}`);
        const topTypes = Object.entries(result2.metadata.fileComposition.byType)
          .sort(([,a], [,b]) => b - a)
          .slice(0, 5);
        console.log(`     Top file types: ${topTypes.map(([ext, count]) => `${ext}:${count}`).join(', ')}`);
      } else {
        console.log('   ❌ No fileComposition found in metadata');
        console.log(`   fileComposition value: ${result2.metadata.fileComposition}`);
        console.log(`   Metadata keys: ${Object.keys(result2.metadata).join(', ')}`);
        console.log(`   Full result:`, JSON.stringify(result2, null, 2));
      }
    } else {
      console.log('❌ local_project_hints: FAILED');
      console.log(`   Error: ${result2.error}`);
      allTestsPassed = false;
    }
  } catch (error) {
    console.log('❌ local_project_hints: EXCEPTION');
    console.log(`   Error: ${error.message}`);
    allTestsPassed = false;
  }
  console.log();

  // Test 3: local_file_summary (handleFileSummary)
  console.log('3️⃣ Testing local_file_summary...');
  try {
    const testFile = path.join(projectPath, 'src', 'tools', 'lightweightTools.ts');
    const result3 = await handleFileSummary({
      filePath: testFile,
      includeSymbols: true,
      maxSymbols: 10,
    });

    if (result3.success) {
      console.log('✅ local_file_summary: SUCCESS');
      console.log(`   File: ${path.basename(result3.summary.file)}`);
      console.log(`   Language: ${result3.summary.language}`);
      console.log(`   Symbols: ${result3.summary.symbolCount}`);
      console.log(`   Complexity: ${result3.summary.complexity}`);
      if (result3.summary.symbols.length > 0) {
        console.log(
          `   Top symbols: ${result3.summary.symbols
            .slice(0, 3)
            .map(s => s.name)
            .join(', ')}`
        );
      }
    } else {
      console.log('❌ local_file_summary: FAILED');
      console.log(`   Error: ${result3.error}`);
      allTestsPassed = false;
    }
  } catch (error) {
    console.log('❌ local_file_summary: EXCEPTION');
    console.log(`   Error: ${error.message}`);
    allTestsPassed = false;
  }
  console.log();

  // Summary
  console.log('=====================================');
  if (allTestsPassed) {
    console.log('🎉 ALL TESTS PASSED! Lightweight tools are working correctly.');
    process.exit(0);
  } else {
    console.log('💥 SOME TESTS FAILED! Check the errors above.');
    process.exit(1);
  }
}

// Simple test for file composition
async function testFileComposition() {
  console.log('🧪 Testing file composition...');

  try {
    const result = await handleProjectHints({
      projectPath: process.cwd(),
      format: 'compact',
      maxFiles: 10, // Small number for quick test
    });

    console.log('Result success:', result.success);
    console.log('Metadata keys:', Object.keys(result.metadata));
    console.log('fileComposition exists:', !!result.metadata.fileComposition);
    if (result.metadata.fileComposition) {
      console.log('fileComposition:', JSON.stringify(result.metadata.fileComposition, null, 2));
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

// Run the tests
testLightweightTools().then(() => {
  console.log('\n🧪 Running file composition test...');
  return testFileComposition();
}).catch(error => {
  console.error('💥 Test script failed:', error);
  process.exit(1);
});
