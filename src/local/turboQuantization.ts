/**
 * @fileOverview: TurboQuant-style vector quantization for high-compression, high-speed embedding search
 * @module: TurboQuantization
 * @keyFunctions:
 *   - turboQuantize(): Rotate + quantize float32 embedding to 2-bit or 4-bit packed representation
 *   - turboSearchSimilarities(): Compute approximate cosine similarities using precomputed lookup tables
 *   - buildDistanceLookupTable(): Precompute per-dimension distance contributions for a query vector
 * @context: Provides 8-16x storage compression (vs float32) with near-lossless similarity preservation.
 *   The key insight: apply a random orthogonal rotation to decorrelate embedding coordinates,
 *   then use optimal Lloyd-Max scalar quantizers per coordinate. Rotation preserves inner products
 *   exactly — only the scalar quantization introduces (minimal, optimal) error.
 */

import { logger } from '../utils/logger';

// ─────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────

export type TurboBits = 2 | 4;

/**
 * A turbo-quantized embedding: packed bit codes + metadata for reconstruction
 */
export interface TurboQuantizedEmbedding {
  /** Packed quantization codes. 4-bit: 2 values/byte, 2-bit: 4 values/byte */
  data: Uint8Array;
  /** Bit depth used */
  bits: TurboBits;
  /** Original vector dimensionality */
  dimensions: number;
  /** Seed used to generate the rotation matrix (deterministic per project) */
  rotationSeed: number;
  /** L2 norm of the original vector (needed for dot product / cosine reconstruction) */
  norm: number;
}

/**
 * Precomputed lookup table for fast distance computation against a single query.
 * table[d * numLevels + code] = contribution of dimension d when code = code
 */
export interface DistanceLookupTable {
  /** Flat array: dimensions × numLevels entries */
  table: Float64Array;
  /** Number of quantization levels (4 for 2-bit, 16 for 4-bit) */
  numLevels: number;
  /** Dimensionality */
  dimensions: number;
}

// ─────────────────────────────────────────────────
// Lloyd-Max codebooks for N(0,1)
// ─────────────────────────────────────────────────
// Optimal scalar quantizer centroids and decision boundaries for a standard Gaussian.
// After rotation, unit-norm vectors have per-coordinate variance ≈ 1/d,
// so we scale by sqrt(d) before quantizing to map into N(0,1) territory.

/** 2-bit (4 levels) Lloyd-Max for N(0,1) */
const LLOYD_MAX_2BIT = {
  /** Decision boundaries (3 values, implicitly -∞ on left, +∞ on right) */
  boundaries: [-0.9816, 0.0, 0.9816],
  /** Reconstruction centroids (4 values, one per code 0-3) */
  centroids: [-1.51, -0.4528, 0.4528, 1.51],
  numLevels: 4,
};

/** 4-bit (16 levels) Lloyd-Max for N(0,1) */
const LLOYD_MAX_4BIT = {
  boundaries: [
    -2.401, -1.844, -1.437, -1.099, -0.7996, -0.5224, -0.2582, 0.0,
    0.2582, 0.5224, 0.7996, 1.099, 1.437, 1.844, 2.401,
  ],
  centroids: [
    -2.733, -2.069, -1.618, -1.256, -0.9424, -0.6568, -0.3881, -0.1284,
    0.1284, 0.3881, 0.6568, 0.9424, 1.256, 1.618, 2.069, 2.733,
  ],
  numLevels: 16,
};

function getCodebook(bits: TurboBits) {
  return bits === 2 ? LLOYD_MAX_2BIT : LLOYD_MAX_4BIT;
}

// ─────────────────────────────────────────────────
// Seeded PRNG (xoshiro128** — fast, deterministic)
// ─────────────────────────────────────────────────

class SeededRNG {
  private s: Uint32Array;

  constructor(seed: number) {
    // SplitMix32 to expand a single seed into 4 state words
    this.s = new Uint32Array(4);
    let z = seed >>> 0;
    for (let i = 0; i < 4; i++) {
      z = (z + 0x9e3779b9) >>> 0;
      let t = z ^ (z >>> 16);
      t = Math.imul(t, 0x85ebca6b);
      t = t ^ (t >>> 13);
      t = Math.imul(t, 0xc2b2ae35);
      t = t ^ (t >>> 16);
      this.s[i] = t >>> 0;
    }
  }

  /** Returns a uniform uint32 */
  private next(): number {
    const s = this.s;
    const result = (Math.imul(s[1], 5) << 7 | Math.imul(s[1], 5) >>> 25) * 9;
    const t = s[1] << 9;
    s[2] ^= s[0];
    s[3] ^= s[1];
    s[1] ^= s[2];
    s[0] ^= s[3];
    s[2] ^= t;
    s[3] = (s[3] << 11 | s[3] >>> 21);
    return result >>> 0;
  }

  /** Returns a uniform float in [0, 1) */
  uniform(): number {
    return this.next() / 4294967296;
  }

  /** Returns a standard Gaussian sample via Box-Muller */
  gaussian(): number {
    let u1 = this.uniform();
    let u2 = this.uniform();
    // Avoid log(0)
    while (u1 === 0) u1 = this.uniform();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }
}

// ─────────────────────────────────────────────────
// Rotation matrix generation & caching
// ─────────────────────────────────────────────────

/** Cache rotation matrices keyed by "seed-dim" to avoid regenerating */
const rotationCache = new Map<string, Float64Array>();
const CACHE_MAX_ENTRIES = 8;

/**
 * Generate a random orthogonal matrix via modified Gram-Schmidt on a random Gaussian matrix.
 * O(d^3) one-time cost, ~50-100ms for d=384.
 */
function generateOrthogonalMatrix(dim: number, seed: number): Float64Array {
  const key = `${seed}-${dim}`;
  const cached = rotationCache.get(key);
  if (cached) return cached;

  const rng = new SeededRNG(seed);
  const matrix = new Float64Array(dim * dim);

  // Fill with random Gaussian entries
  for (let i = 0; i < dim * dim; i++) {
    matrix[i] = rng.gaussian();
  }

  // Modified Gram-Schmidt orthogonalization (row-major: row i = matrix[i*dim .. (i+1)*dim-1])
  for (let i = 0; i < dim; i++) {
    const iOff = i * dim;

    // Subtract projections onto all previous rows
    for (let j = 0; j < i; j++) {
      const jOff = j * dim;
      let dot = 0;
      for (let k = 0; k < dim; k++) {
        dot += matrix[iOff + k] * matrix[jOff + k];
      }
      for (let k = 0; k < dim; k++) {
        matrix[iOff + k] -= dot * matrix[jOff + k];
      }
    }

    // Normalize
    let norm = 0;
    for (let k = 0; k < dim; k++) {
      norm += matrix[iOff + k] * matrix[iOff + k];
    }
    norm = Math.sqrt(norm);
    if (norm < 1e-10) {
      // Degenerate row — extremely unlikely, but handle it
      throw new Error(`Degenerate row ${i} during orthogonalization (seed=${seed})`);
    }
    for (let k = 0; k < dim; k++) {
      matrix[iOff + k] /= norm;
    }
  }

  // Evict oldest entry if cache is full
  if (rotationCache.size >= CACHE_MAX_ENTRIES) {
    const firstKey = rotationCache.keys().next().value;
    if (firstKey !== undefined) {
      rotationCache.delete(firstKey);
    }
  }
  rotationCache.set(key, matrix);

  logger.debug('🔄 Generated orthogonal rotation matrix', {
    dim,
    seed,
    sizeBytes: matrix.byteLength,
  });

  return matrix;
}

/**
 * Apply rotation matrix R to a vector: result = R * v
 * R is row-major: result[i] = sum_k R[i*dim + k] * v[k]
 */
function applyRotation(matrix: Float64Array, v: number[] | Float64Array, dim: number): Float64Array {
  const result = new Float64Array(dim);
  for (let i = 0; i < dim; i++) {
    const iOff = i * dim;
    let sum = 0;
    for (let k = 0; k < dim; k++) {
      sum += matrix[iOff + k] * v[k];
    }
    result[i] = sum;
  }
  return result;
}

// ─────────────────────────────────────────────────
// Core quantization
// ─────────────────────────────────────────────────

/**
 * Quantize a single scalar using Lloyd-Max boundaries.
 * Returns the code index (0..numLevels-1).
 */
function quantizeScalar(value: number, boundaries: number[]): number {
  // Binary search through sorted boundaries
  let lo = 0;
  let hi = boundaries.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (value > boundaries[mid]) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

/**
 * Pack quantization codes into a compact Uint8Array.
 * - 4-bit: 2 codes per byte (high nibble = even index, low nibble = odd index)
 * - 2-bit: 4 codes per byte (bits 6-7 = idx 0, bits 4-5 = idx 1, bits 2-3 = idx 2, bits 0-1 = idx 3)
 */
function packCodes(codes: Uint8Array, bits: TurboBits): Uint8Array {
  const dim = codes.length;
  if (bits === 4) {
    const packed = new Uint8Array(Math.ceil(dim / 2));
    for (let i = 0; i < dim; i += 2) {
      const high = codes[i] << 4;
      const low = i + 1 < dim ? codes[i + 1] : 0;
      packed[i >> 1] = high | low;
    }
    return packed;
  } else {
    // 2-bit
    const packed = new Uint8Array(Math.ceil(dim / 4));
    for (let i = 0; i < dim; i += 4) {
      let byte = 0;
      for (let j = 0; j < 4 && i + j < dim; j++) {
        byte |= (codes[i + j] & 0x03) << (6 - j * 2);
      }
      packed[i >> 2] = byte;
    }
    return packed;
  }
}

/**
 * Unpack quantization codes from a compact Uint8Array.
 */
function unpackCodes(packed: Uint8Array, dimensions: number, bits: TurboBits): Uint8Array {
  const codes = new Uint8Array(dimensions);
  if (bits === 4) {
    for (let i = 0; i < dimensions; i += 2) {
      const byte = packed[i >> 1];
      codes[i] = (byte >> 4) & 0x0F;
      if (i + 1 < dimensions) {
        codes[i + 1] = byte & 0x0F;
      }
    }
  } else {
    // 2-bit
    for (let i = 0; i < dimensions; i += 4) {
      const byte = packed[i >> 2];
      for (let j = 0; j < 4 && i + j < dimensions; j++) {
        codes[i + j] = (byte >> (6 - j * 2)) & 0x03;
      }
    }
  }
  return codes;
}

// ─────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────

/**
 * Turbo-quantize a float32 embedding vector.
 *
 * Pipeline:
 * 1. Compute and store L2 norm
 * 2. Normalize to unit vector
 * 3. Apply random orthogonal rotation (decorrelates coordinates)
 * 4. Scale by sqrt(dim) so coordinates are ~N(0,1)
 * 5. Apply Lloyd-Max quantizer per coordinate
 * 6. Pack codes into compact byte array
 */
export function turboQuantize(
  embedding: number[],
  bits: TurboBits,
  rotationSeed: number
): TurboQuantizedEmbedding {
  const dim = embedding.length;
  if (dim === 0) throw new Error('Cannot turbo-quantize empty embedding');

  // 1. Compute L2 norm
  let normSq = 0;
  for (let i = 0; i < dim; i++) normSq += embedding[i] * embedding[i];
  const norm = Math.sqrt(normSq);

  if (norm < 1e-12) {
    // Zero vector edge case
    return {
      data: new Uint8Array(Math.ceil(dim / (bits === 4 ? 2 : 4))),
      bits,
      dimensions: dim,
      rotationSeed,
      norm: 0,
    };
  }

  // 2. Normalize to unit vector
  const unit = new Float64Array(dim);
  for (let i = 0; i < dim; i++) unit[i] = embedding[i] / norm;

  // 3. Apply rotation
  const R = generateOrthogonalMatrix(dim, rotationSeed);
  const rotated = applyRotation(R, unit, dim);

  // 4. Scale by sqrt(dim) → coordinates ~ N(0, 1)
  const scale = Math.sqrt(dim);
  for (let i = 0; i < dim; i++) rotated[i] *= scale;

  // 5. Lloyd-Max quantization per coordinate
  const codebook = getCodebook(bits);
  const codes = new Uint8Array(dim);
  for (let i = 0; i < dim; i++) {
    codes[i] = quantizeScalar(rotated[i], codebook.boundaries);
  }

  // 6. Pack
  const packed = packCodes(codes, bits);

  logger.debug('⚡ Turbo-quantized embedding', {
    bits,
    dimensions: dim,
    originalBytes: dim * 4,
    packedBytes: packed.length,
    compressionRatio: ((dim * 4) / packed.length).toFixed(1),
    norm: norm.toFixed(4),
  });

  return {
    data: packed,
    bits,
    dimensions: dim,
    rotationSeed,
    norm,
  };
}

/**
 * Dequantize a turbo-quantized embedding back to float32 (for compatibility / debugging).
 * Inverse: unpack codes → centroids → scale by 1/sqrt(dim) → inverse rotation → scale by norm
 */
export function turboDequantize(quantized: TurboQuantizedEmbedding): number[] {
  const { data, bits, dimensions, rotationSeed, norm } = quantized;

  if (norm < 1e-12) return new Array(dimensions).fill(0);

  const codebook = getCodebook(bits);
  const codes = unpackCodes(data, dimensions, bits);

  // Reconstruct scaled rotated vector from centroids
  const rotated = new Float64Array(dimensions);
  const invScale = 1.0 / Math.sqrt(dimensions);
  for (let i = 0; i < dimensions; i++) {
    rotated[i] = codebook.centroids[codes[i]] * invScale;
  }

  // Inverse rotation: R^T * rotated (R is orthogonal, so R^{-1} = R^T)
  const R = generateOrthogonalMatrix(dimensions, rotationSeed);
  const result = new Array<number>(dimensions);
  for (let i = 0; i < dimensions; i++) {
    let sum = 0;
    // R^T: column i of R = row-major R[j*dim + i] for each j
    for (let j = 0; j < dimensions; j++) {
      sum += R[j * dimensions + i] * rotated[j];
    }
    result[i] = sum * norm;
  }

  return result;
}

/**
 * Build a distance lookup table for a query vector.
 *
 * This precomputes the dot-product contribution of each (dimension, code) pair,
 * so that the inner product with any stored vector is just a sum of table lookups.
 *
 * For cosine similarity: rotate the query, then for each dimension d and code c,
 * table[d * numLevels + c] = rotatedQuery[d] * centroid[c] / dim
 *
 * The total approximate dot product between the unit query and a stored unit vector =
 * sum over d of table[d * numLevels + storedCode[d]]
 */
export function buildDistanceLookupTable(
  queryEmbedding: number[],
  bits: TurboBits,
  rotationSeed: number
): DistanceLookupTable {
  const dim = queryEmbedding.length;
  const codebook = getCodebook(bits);
  const numLevels = codebook.numLevels;

  // Normalize query to unit vector
  let normSq = 0;
  for (let i = 0; i < dim; i++) normSq += queryEmbedding[i] * queryEmbedding[i];
  const queryNorm = Math.sqrt(normSq);

  const unit = new Float64Array(dim);
  if (queryNorm > 1e-12) {
    for (let i = 0; i < dim; i++) unit[i] = queryEmbedding[i] / queryNorm;
  }

  // Rotate the query
  const R = generateOrthogonalMatrix(dim, rotationSeed);
  const rotatedQuery = applyRotation(R, unit, dim);

  // Scale by sqrt(dim) to match the stored coordinate scale
  const scale = Math.sqrt(dim);
  for (let i = 0; i < dim; i++) rotatedQuery[i] *= scale;

  // Build the table: for each (dimension, code), precompute the dot product contribution
  // The stored values are centroid[code] (in scaled space).
  // Dot product in rotated space = sum_d (rotatedQuery[d] * centroid[code_d]) / dim
  // (dividing by dim because both sides were scaled by sqrt(dim))
  const table = new Float64Array(dim * numLevels);
  const invDim = 1.0 / dim;

  for (let d = 0; d < dim; d++) {
    const offset = d * numLevels;
    for (let c = 0; c < numLevels; c++) {
      table[offset + c] = rotatedQuery[d] * codebook.centroids[c] * invDim;
    }
  }

  return { table, numLevels, dimensions: dim };
}

/**
 * Compute approximate cosine similarity between a query and a turbo-quantized stored vector
 * using a precomputed lookup table. O(dim) additions only — no multiplications, no dequantization.
 */
export function turboApproxDotProduct(
  lut: DistanceLookupTable,
  quantized: TurboQuantizedEmbedding
): number {
  const { data, bits, dimensions } = quantized;
  const { table, numLevels } = lut;

  // Fast-path: unpack and lookup in a single pass
  let dotProduct = 0;

  if (bits === 4) {
    // 4-bit: 2 codes per byte
    for (let i = 0; i < dimensions; i += 2) {
      const byte = data[i >> 1];
      const code0 = (byte >> 4) & 0x0F;
      dotProduct += table[i * numLevels + code0];
      if (i + 1 < dimensions) {
        const code1 = byte & 0x0F;
        dotProduct += table[(i + 1) * numLevels + code1];
      }
    }
  } else {
    // 2-bit: 4 codes per byte
    for (let i = 0; i < dimensions; i += 4) {
      const byte = data[i >> 2];
      for (let j = 0; j < 4 && i + j < dimensions; j++) {
        const code = (byte >> (6 - j * 2)) & 0x03;
        dotProduct += table[(i + j) * numLevels + code];
      }
    }
  }

  // dotProduct is the approximate cosine similarity between the two unit vectors
  // (norms were factored out during quantization)
  return dotProduct;
}

/**
 * Batch-compute approximate cosine similarities between a query and multiple
 * turbo-quantized stored vectors. The lookup table is built once and reused.
 *
 * Returns an array of { index, similarity } sorted descending by similarity.
 */
export function turboSearchSimilarities(
  queryEmbedding: number[],
  storedEmbeddings: TurboQuantizedEmbedding[],
  bits: TurboBits,
  rotationSeed: number
): { index: number; similarity: number }[] {
  if (storedEmbeddings.length === 0) return [];

  // Build lookup table once for this query
  const lut = buildDistanceLookupTable(queryEmbedding, bits, rotationSeed);

  // Compute approximate cosine similarity for each stored embedding
  const results = storedEmbeddings.map((emb, index) => ({
    index,
    similarity: turboApproxDotProduct(lut, emb),
  }));

  // Sort descending
  results.sort((a, b) => b.similarity - a.similarity);

  return results;
}

// ─────────────────────────────────────────────────
// Serialization (compact binary, not JSON)
// ─────────────────────────────────────────────────

/**
 * Serialize a TurboQuantizedEmbedding to a Buffer for SQLite storage.
 *
 * Binary format (little-endian):
 *   [0]       uint8   magic byte (0xTQ = 0x54)
 *   [1]       uint8   bits (2 or 4)
 *   [2..3]    uint16  dimensions
 *   [4..7]    uint32  rotationSeed
 *   [8..15]   float64 norm
 *   [16..]    uint8[] packed quantization codes
 */
export function serializeTurboEmbedding(quantized: TurboQuantizedEmbedding): Buffer {
  const headerSize = 16;
  const buf = Buffer.alloc(headerSize + quantized.data.length);

  buf.writeUInt8(0x54, 0);                       // magic 'T'
  buf.writeUInt8(quantized.bits, 1);              // bits
  buf.writeUInt16LE(quantized.dimensions, 2);     // dimensions
  buf.writeUInt32LE(quantized.rotationSeed, 4);   // seed
  buf.writeDoubleLE(quantized.norm, 8);           // norm

  // Copy packed data
  Buffer.from(quantized.data.buffer, quantized.data.byteOffset, quantized.data.byteLength)
    .copy(buf, headerSize);

  return buf;
}

/**
 * Deserialize a TurboQuantizedEmbedding from a Buffer.
 */
export function deserializeTurboEmbedding(buf: Buffer): TurboQuantizedEmbedding {
  if (buf.length < 16) throw new Error('Buffer too small for turbo embedding header');
  if (buf.readUInt8(0) !== 0x54) throw new Error('Invalid turbo embedding magic byte');

  const bits = buf.readUInt8(1) as TurboBits;
  if (bits !== 2 && bits !== 4) throw new Error(`Invalid turbo bits: ${bits}`);

  const dimensions = buf.readUInt16LE(2);
  const rotationSeed = buf.readUInt32LE(4);
  const norm = buf.readDoubleLE(8);

  const data = new Uint8Array(buf.buffer, buf.byteOffset + 16, buf.length - 16);

  return { data, bits, dimensions, rotationSeed, norm };
}

// ─────────────────────────────────────────────────
// Type guard
// ─────────────────────────────────────────────────

export function isTurboQuantized(
  embedding: unknown
): embedding is TurboQuantizedEmbedding {
  return (
    typeof embedding === 'object' &&
    embedding !== null &&
    'data' in embedding &&
    'bits' in embedding &&
    'rotationSeed' in embedding &&
    'norm' in embedding
  );
}

// ─────────────────────────────────────────────────
// Quality metrics
// ─────────────────────────────────────────────────

/**
 * Measure quantization quality by comparing original and reconstructed vectors.
 */
export function calculateTurboQuantizationError(
  original: number[],
  quantized: TurboQuantizedEmbedding
): {
  meanAbsoluteError: number;
  rootMeanSquareError: number;
  cosineSimilarity: number;
} {
  const reconstructed = turboDequantize(quantized);
  const dim = original.length;

  let sumAbsErr = 0;
  let sumSqErr = 0;
  let dotProduct = 0;
  let normOrig = 0;
  let normRecon = 0;

  for (let i = 0; i < dim; i++) {
    const err = Math.abs(original[i] - reconstructed[i]);
    sumAbsErr += err;
    sumSqErr += err * err;
    dotProduct += original[i] * reconstructed[i];
    normOrig += original[i] * original[i];
    normRecon += reconstructed[i] * reconstructed[i];
  }

  const denom = Math.sqrt(normOrig) * Math.sqrt(normRecon);

  return {
    meanAbsoluteError: sumAbsErr / dim,
    rootMeanSquareError: Math.sqrt(sumSqErr / dim),
    cosineSimilarity: denom > 0 ? dotProduct / denom : 1.0,
  };
}

/**
 * Get storage size in bytes for a turbo-quantized embedding (serialized form).
 */
export function getTurboStorageSize(quantized: TurboQuantizedEmbedding): number {
  return 16 + quantized.data.length; // 16-byte header + packed codes
}

/**
 * Clear the rotation matrix cache (useful for testing or memory pressure).
 */
export function clearRotationCache(): void {
  rotationCache.clear();
}
