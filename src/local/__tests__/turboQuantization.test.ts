/**
 * @fileOverview: Tests for TurboQuant-style vector quantization
 * @module: TurboQuantizationTests
 * @context: Validates correctness of rotation, quantization, packing, search, and serialization
 */

import {
  turboQuantize,
  turboDequantize,
  turboSearchSimilarities,
  buildDistanceLookupTable,
  turboApproxDotProduct,
  serializeTurboEmbedding,
  deserializeTurboEmbedding,
  isTurboQuantized,
  calculateTurboQuantizationError,
  getTurboStorageSize,
  clearRotationCache,
  TurboQuantizedEmbedding,
  TurboBits,
} from '../turboQuantization';

// Helper: generate a random unit vector of given dimension
function randomUnitVector(dim: number, seed: number = 42): number[] {
  // Simple seeded LCG for reproducibility
  let state = seed;
  const next = () => {
    state = (state * 1664525 + 1013904223) & 0xffffffff;
    return (state >>> 0) / 4294967296;
  };

  const v = new Array(dim);
  let norm = 0;
  for (let i = 0; i < dim; i++) {
    // Box-Muller
    const u1 = next() || 0.0001;
    const u2 = next();
    v[i] = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    norm += v[i] * v[i];
  }
  norm = Math.sqrt(norm);
  for (let i = 0; i < dim; i++) v[i] /= norm;
  return v;
}

// Helper: cosine similarity in float32
function cosineSim(a: number[], b: number[]): number {
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

describe('TurboQuantization', () => {
  const DIM = 384; // Match all-MiniLM-L6-v2
  const SEED = 42;

  beforeEach(() => {
    clearRotationCache();
  });

  describe('turboQuantize / turboDequantize roundtrip', () => {
    it.each([2, 4] as TurboBits[])(
      'should roundtrip at %d-bit with high cosine similarity',
      bits => {
        const vec = randomUnitVector(DIM, 123);
        const quantized = turboQuantize(vec, bits, SEED);
        const reconstructed = turboDequantize(quantized);

        expect(reconstructed.length).toBe(DIM);

        const sim = cosineSim(vec, reconstructed);
        // 4-bit should be > 0.99, 2-bit should be > 0.92
        const minSim = bits === 4 ? 0.99 : 0.9;
        expect(sim).toBeGreaterThan(minSim);
      }
    );

    it('should handle zero vectors', () => {
      const zero = new Array(DIM).fill(0);
      const quantized = turboQuantize(zero, 4, SEED);
      const reconstructed = turboDequantize(quantized);
      expect(reconstructed.every(v => v === 0)).toBe(true);
    });
  });

  describe('packing / unpacking', () => {
    it('4-bit packing should produce dim/2 bytes', () => {
      const vec = randomUnitVector(DIM, 456);
      const q = turboQuantize(vec, 4, SEED);
      expect(q.data.length).toBe(DIM / 2); // 192 bytes for 384 dims
    });

    it('2-bit packing should produce dim/4 bytes', () => {
      const vec = randomUnitVector(DIM, 789);
      const q = turboQuantize(vec, 2, SEED);
      expect(q.data.length).toBe(DIM / 4); // 96 bytes for 384 dims
    });
  });

  describe('compression ratios', () => {
    it('4-bit should achieve ~8x compression vs float32', () => {
      const vec = randomUnitVector(DIM, 111);
      const q = turboQuantize(vec, 4, SEED);
      const originalBytes = DIM * 4; // 1536 bytes
      const turboBytes = getTurboStorageSize(q); // 16 header + 192 data = 208
      const ratio = originalBytes / turboBytes;
      expect(ratio).toBeGreaterThan(7);
    });

    it('2-bit should achieve ~13x+ compression vs float32', () => {
      const vec = randomUnitVector(DIM, 222);
      const q = turboQuantize(vec, 2, SEED);
      const originalBytes = DIM * 4;
      const turboBytes = getTurboStorageSize(q);
      const ratio = originalBytes / turboBytes;
      expect(ratio).toBeGreaterThan(13);
    });
  });

  describe('similarity search correctness', () => {
    it('should preserve ranking order for 4-bit', () => {
      // Create a query and several vectors with known similarity ordering
      const query = randomUnitVector(DIM, 1);
      const vectors = [
        randomUnitVector(DIM, 2), // random, moderate similarity
        randomUnitVector(DIM, 3), // random, moderate similarity
        query.map(v => v + 0.01 * Math.random()), // very similar to query
      ];

      // Ground truth cosine similarities
      const trueSims = vectors.map(v => cosineSim(query, v));

      // Quantize all vectors
      const quantized = vectors.map(v => turboQuantize(v, 4, SEED));

      // Search using lookup table
      const results = turboSearchSimilarities(query, quantized, 4, SEED);

      // The most similar vector (index 2) should rank first
      const trueRanking = trueSims
        .map((s, i) => ({ i, s }))
        .sort((a, b) => b.s - a.s)
        .map(x => x.i);

      const turboRanking = results.map(r => r.index);

      // Top-1 should match
      expect(turboRanking[0]).toBe(trueRanking[0]);
    });

    it('should produce similarities close to ground truth at 4-bit', () => {
      const query = randomUnitVector(DIM, 10);
      const vec = randomUnitVector(DIM, 20);

      const trueSim = cosineSim(query, vec);
      const quantized = turboQuantize(vec, 4, SEED);
      const lut = buildDistanceLookupTable(query, 4, SEED);
      const approxSim = turboApproxDotProduct(lut, quantized);

      // Should be within 0.05 of true value
      expect(Math.abs(approxSim - trueSim)).toBeLessThan(0.05);
    });
  });

  describe('serialization', () => {
    it.each([2, 4] as TurboBits[])('should serialize/deserialize at %d-bit', bits => {
      const vec = randomUnitVector(DIM, 333);
      const original = turboQuantize(vec, bits, SEED);

      const buf = serializeTurboEmbedding(original);
      const restored = deserializeTurboEmbedding(buf);

      expect(restored.bits).toBe(original.bits);
      expect(restored.dimensions).toBe(original.dimensions);
      expect(restored.rotationSeed).toBe(original.rotationSeed);
      expect(Math.abs(restored.norm - original.norm)).toBeLessThan(1e-10);
      expect(restored.data.length).toBe(original.data.length);

      for (let i = 0; i < original.data.length; i++) {
        expect(restored.data[i]).toBe(original.data[i]);
      }
    });

    it('serialized size should be compact', () => {
      const vec = randomUnitVector(DIM, 444);
      const q = turboQuantize(vec, 4, SEED);
      const buf = serializeTurboEmbedding(q);
      expect(buf.length).toBe(16 + DIM / 2); // 208 bytes total
    });
  });

  describe('type guard', () => {
    it('should identify turbo-quantized embeddings', () => {
      const vec = randomUnitVector(DIM, 555);
      const q = turboQuantize(vec, 4, SEED);
      expect(isTurboQuantized(q)).toBe(true);
    });

    it('should not match plain arrays', () => {
      expect(isTurboQuantized([1, 2, 3])).toBe(false);
    });

    it('should not match int8 QuantizedEmbedding', () => {
      const fakeInt8 = {
        data: new Int8Array(10),
        params: { min: -1, max: 1, scale: 0.01, offset: 0 },
        originalDimensions: 10,
      };
      expect(isTurboQuantized(fakeInt8)).toBe(false);
    });
  });

  describe('quality metrics', () => {
    it('should report high similarity preservation at 4-bit', () => {
      const vec = randomUnitVector(DIM, 666);
      const q = turboQuantize(vec, 4, SEED);
      const metrics = calculateTurboQuantizationError(vec, q);

      expect(metrics.cosineSimilarity).toBeGreaterThan(0.99);
      expect(metrics.meanAbsoluteError).toBeLessThan(0.05);
    });

    it('should report acceptable quality at 2-bit', () => {
      const vec = randomUnitVector(DIM, 777);
      const q = turboQuantize(vec, 2, SEED);
      const metrics = calculateTurboQuantizationError(vec, q);

      expect(metrics.cosineSimilarity).toBeGreaterThan(0.9);
    });
  });

  describe('rotation determinism', () => {
    it('should produce identical results with the same seed', () => {
      const vec = randomUnitVector(DIM, 888);

      clearRotationCache();
      const q1 = turboQuantize(vec, 4, SEED);

      clearRotationCache();
      const q2 = turboQuantize(vec, 4, SEED);

      expect(q1.norm).toBe(q2.norm);
      for (let i = 0; i < q1.data.length; i++) {
        expect(q1.data[i]).toBe(q2.data[i]);
      }
    });

    it('should produce different results with different seeds', () => {
      const vec = randomUnitVector(DIM, 999);
      const q1 = turboQuantize(vec, 4, 42);
      const q2 = turboQuantize(vec, 4, 99);

      // At least some codes should differ
      let diffs = 0;
      for (let i = 0; i < q1.data.length; i++) {
        if (q1.data[i] !== q2.data[i]) diffs++;
      }
      expect(diffs).toBeGreaterThan(0);
    });
  });
});
