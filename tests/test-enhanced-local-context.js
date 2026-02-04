#!/usr/bin/env node

/**
 * Test script for enhanced local context implementation
 * Run this to validate the new functionality works correctly
 */

const path = require('path');
const fs = require('fs');

// Set up path to the compiled JavaScript
const projectRoot = path.join(__dirname, '..');
const compiledPath = path.join(projectRoot, 'dist', 'src', 'tools', 'localTools');

console.log('🧪 Testing Enhanced Local Context Implementation\n');
console.log('Project root:', projectRoot);
console.log('Looking for compiled files in:', compiledPath);

// Check if compiled files exist
const requiredFiles = [
  'enhancedLocalContext.js',
  'astQueryEngine.js',
  'candidateRanking.js',
  'miniBundleAssembler.js',
  'answerDraftGenerator.js'
];

console.log('\n📋 Checking compiled files...');
let allFilesExist = true;

for (const file of requiredFiles) {
  const filePath = path.join(compiledPath, file);
  const exists = fs.existsSync(filePath);
  console.log(`${exists ? '✅' : '❌'} ${file}`);
  if (!exists) allFilesExist = false;
}

if (!allFilesExist) {
  console.log('\n⚠️  Some compiled files are missing. Please run:');
  console.log('npm run build');
  process.exit(1);
}

// Test basic functionality
async function testEnhancedLocalContext() {
  try {
    console.log('\n🚀 Testing basic functionality...');
    
    // Import the enhanced local context
    const { localContext } = require(path.join(compiledPath, 'enhancedLocalContext.js'));
    
    console.log('✅ Enhanced local context module loaded successfully');
    
    // Test with a simple query
    const testQuery = {
      query: 'How does database connection and local storage work?',
      taskType: 'understand',
      maxTokens: 2000,
      maxSimilarChunks: 10,
      useProjectHintsCache: false, // Don't rely on cache for testing
      attackPlan: 'auto'
    };
    
    console.log('\n📊 Running test query:', testQuery.query);
    console.log('Parameters:', {
      taskType: testQuery.taskType,
      maxTokens: testQuery.maxTokens,
      attackPlan: testQuery.attackPlan
    });
    
    const startTime = Date.now();
    const result = await localContext(testQuery);
    const endTime = Date.now();
    
    console.log('\n📈 Results:');
    console.log('Success:', result.success);
    console.log('Processing time:', endTime - startTime, 'ms');
    
    if (result.success) {
      console.log('✅ Enhanced local context is working!');
      console.log('\n📄 Answer draft:', result.answerDraft.substring(0, 100) + '...');
      console.log('🎯 Jump targets found:', result.jumpTargets.length);
      console.log('📦 Mini bundle items:', result.miniBundle.length);
      console.log('🔍 Evidence pieces:', result.evidence.length);
      console.log('📊 Metadata:', {
        filesScanned: result.metadata.filesScanned,
        symbolsConsidered: result.metadata.symbolsConsidered,
        bundleTokens: result.metadata.bundleTokens
      });
      
      if (result.jumpTargets.length > 0) {
        console.log('\n🎯 Top jump targets:');
        result.jumpTargets.slice(0, 3).forEach((target, i) => {
          console.log(`  ${i + 1}. ${target.symbol} (${target.role}) - ${Math.round(target.confidence * 100)}% confidence`);
        });
      }
    } else {
      console.log('❌ Test failed:', result);
    }
    
  } catch (error) {
    console.log('❌ Test failed with error:', error.message);
    console.log('Stack trace:', error.stack);
  }
}

// Test semantic compact integration
async function testSemanticCompactIntegration() {
  try {
    console.log('\n🔧 Testing semantic compact integration...');
    
    const { handleSemanticCompact } = require(path.join(compiledPath, 'semanticCompact.js'));
    
    const testArgs = {
      query: 'Show me database initialization and storage patterns',
      format: 'enhanced',
      taskType: 'understand',
      maxTokens: 2000,
      attackPlan: 'init-read-write'
    };
    
    console.log('Testing with args:', testArgs);
    
    const result = await handleSemanticCompact(testArgs);
    
    console.log('Integration test result:');
    console.log('Success:', result.success);
    console.log('Enhanced mode:', result.enhanced);
    console.log('Has jump targets:', !!result.jumpTargets);
    console.log('Has answer draft:', !!result.answerDraft);
    
    if (result.success && result.enhanced) {
      console.log('✅ Semantic compact integration working!');
    } else {
      console.log('⚠️  Integration test did not use enhanced mode (this is expected if query conditions are not met)');
    }
    
  } catch (error) {
    console.log('❌ Integration test failed:', error.message);
  }
}

// Run tests
async function runAllTests() {
  await testEnhancedLocalContext();
  await testSemanticCompactIntegration();
  
  console.log('\n🎉 Testing complete!');
  console.log('\n📝 Usage instructions:');
  console.log('To use the enhanced local context, call local_context with:');
  console.log('- query: A specific question about your code');
  console.log('- format: "enhanced" (for new format)');
  console.log('- taskType: "understand", "debug", "trace", "spec", or "test"');
  console.log('- attackPlan: "auto", "init-read-write", "api-route", "auth", or "error-driven"');
  console.log('\nExample:');
  console.log('{');
  console.log('  "query": "How does authentication work in this project?",');
  console.log('  "format": "enhanced",');
  console.log('  "taskType": "understand",');
  console.log('  "attackPlan": "auth"');
  console.log('}');
}

// Execute if run directly
if (require.main === module) {
  runAllTests().catch(error => {
    console.error('💥 Test script failed:', error);
    process.exit(1);
  });
}

module.exports = { testEnhancedLocalContext, testSemanticCompactIntegration };