#!/usr/bin/env node

/**
 * Simple test to verify quantization functionality
 */

const {
  quantizeFloat32ToInt8,
  dequantizeInt8ToFloat32,
  calculateQuantizationError,
  estimateQuantizationSavings,
} = require('../dist/src/local/quantization.js');

console.log('🧪 Testing Quantization Functionality');
console.log('=====================================');

// Test data - create some realistic embedding vectors
const testEmbeddings = [
  // Simple test vectors
  [0.1, 0.2, 0.3, 0.4, 0.5],
  [1.0, 0.0, -0.5, 0.8, -0.2],
  [0.0, 0.0, 0.0, 0.0, 0.0], // Zero vector edge case

  // More realistic embedding (1536 dimensions would be too large for testing)
  Array.from({ length: 100 }, (_, i) => Math.sin(i * 0.01) * Math.random()),
];

let totalOriginalSize = 0;
let totalQuantizedSize = 0;
let totalError = 0;

console.log('\n📊 Testing individual embeddings:');
console.log('----------------------------------');

testEmbeddings.forEach((embedding, index) => {
  try {
    console.log(`\nEmbedding ${index + 1}:`);
    console.log(`  Original dimensions: ${embedding.length}`);
    console.log(`  Original size: ${embedding.length * 4} bytes (float32)`);

    // Quantize
    const quantized = quantizeFloat32ToInt8(embedding);
    console.log(`  Quantized dimensions: ${quantized.data.length}`);
    console.log(`  Quantized size: ${quantized.data.length} bytes (int8)`);

    // Dequantize
    const dequantized = dequantizeInt8ToFloat32(quantized);
    console.log(`  Dequantized dimensions: ${dequantized.length}`);

    // Calculate error
    const error = calculateQuantizationError(embedding, quantized);
    console.log(`  Mean absolute error: ${error.meanAbsoluteError.toFixed(6)}`);
    console.log(`  Max absolute error: ${error.maxAbsoluteError.toFixed(6)}`);
    console.log(`  RMSE: ${error.rootMeanSquareError.toFixed(6)}`);
    console.log(`  Similarity preservation: ${error.similarityPreservation.toFixed(4)}`);

    totalOriginalSize += embedding.length * 4;
    totalQuantizedSize += quantized.data.length;
    totalError += error.rootMeanSquareError;

  } catch (error) {
    console.error(`❌ Error testing embedding ${index + 1}:`, error.message);
  }
});

const compressionRatio = totalOriginalSize / totalQuantizedSize;
const averageError = totalError / testEmbeddings.length;

console.log('\n📈 Overall Results:');
console.log('-------------------');
console.log(`Total original size: ${totalOriginalSize} bytes`);
console.log(`Total quantized size: ${totalQuantizedSize} bytes`);
console.log(`Compression ratio: ${compressionRatio.toFixed(2)}x`);
console.log(`Average RMSE: ${averageError.toFixed(6)}`);
console.log(`Storage savings: ${((1 - 1/compressionRatio) * 100).toFixed(1)}%`);

if (compressionRatio > 3.5 && averageError < 0.01) {
  console.log('\n✅ Quantization test PASSED - Good compression with low error');
} else if (compressionRatio > 2.5) {
  console.log('\n⚠️ Quantization test ACCEPTABLE - Reasonable compression');
} else {
  console.log('\n❌ Quantization test FAILED - Poor compression ratio');
}

console.log('\n🎯 Expected Results:');
console.log('-------------------');
console.log('• Compression ratio: 4-8x (float32 vs int8)');
console.log('• RMSE: < 0.01 for good quality');
console.log('• Similarity preservation: > 0.99');
console.log('• Storage savings: 75-87.5%');

console.log('\n✅ Quantization functionality test completed!');
