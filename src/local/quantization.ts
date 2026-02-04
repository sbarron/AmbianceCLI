/**
 * @fileOverview: Vector quantization utilities for efficient embedding storage
 * @module: Quantization
 * @keyFunctions:
 *   - quantizeFloat32ToInt8(): Convert float32 embeddings to int8 for storage
 *   - dequantizeInt8ToFloat32(): Convert int8 embeddings back to float32 for similarity search
 *   - calculateQuantizationError(): Calculate quantization error for quality assessment
 * @context: Provides 4-8x storage reduction while maintaining similarity search accuracy
 */

import { logger } from '../utils/logger';

/**
 * Quantization parameters for int8 conversion
 */
export interface QuantizationParams {
  min: number;
  max: number;
  scale: number;
  offset: number;
}

/**
 * Quantized embedding with metadata for dequantization
 */
export interface QuantizedEmbedding {
  data: Int8Array;
  params: QuantizationParams;
  originalDimensions: number;
}

/**
 * Convert float32 embedding vector to int8 for efficient storage
 * Uses symmetric quantization around zero for optimal similarity preservation
 */
export function quantizeFloat32ToInt8(embedding: number[]): QuantizedEmbedding {
  if (!embedding || embedding.length === 0) {
    throw new Error('Cannot quantize empty embedding');
  }

  // Find the absolute maximum value for symmetric quantization
  let absMax = 0;
  for (const value of embedding) {
    const abs = Math.abs(value);
    if (abs > absMax) {
      absMax = abs;
    }
  }

  // Handle edge case of all zeros
  if (absMax === 0) {
    return {
      data: new Int8Array(embedding.length),
      params: { min: 0, max: 0, scale: 1, offset: 0 },
      originalDimensions: embedding.length,
    };
  }

  // Calculate quantization parameters
  // Use symmetric range [-absMax, absMax] for better similarity preservation
  const scale = absMax / 127; // 127 to leave room for rounding

  const quantized = new Int8Array(embedding.length);
  for (let i = 0; i < embedding.length; i++) {
    // Quantize to int8 range [-128, 127]
    const quantizedValue = Math.round(embedding[i] / scale);
    // Clamp to int8 range
    quantized[i] = Math.max(-128, Math.min(127, quantizedValue));
  }

  const params: QuantizationParams = {
    min: -absMax,
    max: absMax,
    scale,
    offset: 0, // No offset needed for symmetric quantization
  };

  logger.debug('🔢 Quantized embedding', {
    originalSize: embedding.length * 4, // 4 bytes per float32
    quantizedSize: quantized.length, // 1 byte per int8
    compressionRatio: ((embedding.length * 4) / quantized.length).toFixed(1),
    absMax,
    scale,
  });

  return {
    data: quantized,
    params,
    originalDimensions: embedding.length,
  };
}

/**
 * Convert quantized int8 embedding back to float32 for similarity calculations
 */
export function dequantizeInt8ToFloat32(quantized: QuantizedEmbedding): number[] {
  const dequantized = new Array(quantized.originalDimensions);

  for (let i = 0; i < quantized.originalDimensions; i++) {
    dequantized[i] = quantized.data[i] * quantized.params.scale;
  }

  return dequantized;
}

/**
 * Calculate quantization error to assess quality impact
 */
export function calculateQuantizationError(
  original: number[],
  quantized: QuantizedEmbedding
): {
  meanAbsoluteError: number;
  maxAbsoluteError: number;
  rootMeanSquareError: number;
  similarityPreservation: number;
} {
  if (original.length !== quantized.originalDimensions) {
    throw new Error('Dimension mismatch between original and quantized embedding');
  }

  const dequantized = dequantizeInt8ToFloat32(quantized);
  const errors: number[] = [];

  let sumSquaredError = 0;
  let maxError = 0;
  let sumAbsoluteError = 0;

  for (let i = 0; i < original.length; i++) {
    const error = Math.abs(original[i] - dequantized[i]);
    errors.push(error);
    sumAbsoluteError += error;
    sumSquaredError += error * error;
    if (error > maxError) {
      maxError = error;
    }
  }

  const meanAbsoluteError = sumAbsoluteError / original.length;
  const rootMeanSquareError = Math.sqrt(sumSquaredError / original.length);

  // Estimate similarity preservation using cosine similarity
  const originalNorm = Math.sqrt(original.reduce((sum, val) => sum + val * val, 0));
  const dequantizedNorm = Math.sqrt(dequantized.reduce((sum, val) => sum + val * val, 0));

  let dotProduct = 0;
  for (let i = 0; i < original.length; i++) {
    dotProduct += original[i] * dequantized[i];
  }

  const similarityPreservation =
    originalNorm === 0 || dequantizedNorm === 0
      ? 1.0
      : dotProduct / (originalNorm * dequantizedNorm);

  return {
    meanAbsoluteError,
    maxAbsoluteError: maxError,
    rootMeanSquareError,
    similarityPreservation,
  };
}

/**
 * Check if an embedding is quantized (int8) or raw (float32)
 */
export function isQuantized(
  embedding: number[] | QuantizedEmbedding
): embedding is QuantizedEmbedding {
  return 'data' in embedding && 'params' in embedding;
}

/**
 * Serialize quantized embedding for storage
 */
export function serializeQuantizedEmbedding(quantized: QuantizedEmbedding): Buffer {
  const jsonString = JSON.stringify({
    data: Array.from(quantized.data), // Convert Int8Array to regular array for JSON
    params: quantized.params,
    originalDimensions: quantized.originalDimensions,
  });

  return Buffer.from(jsonString, 'utf8');
}

/**
 * Deserialize quantized embedding from storage
 */
export function deserializeQuantizedEmbedding(buffer: Buffer): QuantizedEmbedding {
  const jsonString = buffer.toString('utf8');
  const parsed = JSON.parse(jsonString);

  return {
    data: new Int8Array(parsed.data),
    params: parsed.params,
    originalDimensions: parsed.originalDimensions,
  };
}

/**
 * Convert any embedding (quantized or float32) to float32 for similarity search
 */
export function normalizeToFloat32(embedding: number[] | QuantizedEmbedding): number[] {
  if (isQuantized(embedding)) {
    return dequantizeInt8ToFloat32(embedding);
  }
  return embedding;
}

/**
 * Get storage size in bytes for an embedding
 */
export function getEmbeddingStorageSize(embedding: number[] | QuantizedEmbedding): number {
  if (isQuantized(embedding)) {
    // JSON overhead + int8 data + metadata
    return JSON.stringify(embedding).length;
  } else {
    // JSON overhead + float32 data (4 bytes per float)
    return JSON.stringify(embedding).length;
  }
}

/**
 * Estimate storage savings from quantization
 */
export function estimateQuantizationSavings(
  float32Embeddings: number[][],
  quantizedEmbeddings: QuantizedEmbedding[]
): {
  originalSize: number;
  quantizedSize: number;
  compressionRatio: number;
  totalSavings: number;
  percentageSaved: number;
} {
  if (float32Embeddings.length !== quantizedEmbeddings.length) {
    throw new Error('Embedding count mismatch');
  }

  let originalSize = 0;
  let quantizedSize = 0;

  for (let i = 0; i < float32Embeddings.length; i++) {
    const original = float32Embeddings[i];
    const quantized = quantizedEmbeddings[i];

    originalSize += JSON.stringify(original).length;
    quantizedSize += JSON.stringify(quantized).length;
  }

  const compressionRatio = originalSize / quantizedSize;
  const totalSavings = originalSize - quantizedSize;
  const percentageSaved = (totalSavings / originalSize) * 100;

  return {
    originalSize,
    quantizedSize,
    compressionRatio,
    totalSavings,
    percentageSaved,
  };
}
