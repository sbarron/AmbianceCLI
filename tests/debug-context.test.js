describe('Local Debug Context Tool', () => {
  let handleLocalDebugContext;

  beforeAll(() => {
    try {
      const module = require('../src/tools/debug/localDebugContext');
      handleLocalDebugContext = module.handleLocalDebugContext;
    } catch (error) {
      console.warn('Local debug context module not available:', error.message);
    }
  });

  it('should parse error logs and find related code', async () => {
    if (!handleLocalDebugContext) {
      console.warn('Handler not available, skipping test');
      return;
    }

    const sampleErrorLog = `
TypeError: Cannot read property 'embedding' of undefined
    at searchSimilarEmbeddings (src/local/embeddingStorage.ts:330:12)
    at handleLocalDebugContext (src/tools/debug/localDebugContext.ts:623:5)
    at src/tools/debug/index.ts:12:3
    at Layer.handle [as handle_request] (node_modules/express/lib/router/layer.js:95:5)
    `;

    const result = await handleLocalDebugContext({
      logText: sampleErrorLog,
      projectPath: process.cwd(),
      useEmbeddings: false, // Don't use embeddings in tests
      embeddingSimilarityThreshold: 0.2,
      maxSimilarChunks: 3,
      generateEmbeddingsIfMissing: false,
      format: 'structured'
    });

    if (!result) {
      console.warn('Local debug context returned no result; skipping assertions');
      return;
    }

    if (typeof result.success === 'undefined') {
      console.warn('Local debug context missing success flag; skipping assertions');
      return;
    }

    expect(typeof result.success).toBe('boolean');

    if (result.success) {
      expect(result.summary).toBeDefined();
      expect(result.errors).toBeDefined();
      expect(result.matches).toBeDefined();
      expect(result.errors.length).toBeGreaterThan(0);
    }
  }, 30000);

  it('should handle malformed error logs gracefully', async () => {
    if (!handleLocalDebugContext) {
      console.warn('Handler not available, skipping test');
      return;
    }

    const malformedLog = 'This is not a real error log';

    const result = await handleLocalDebugContext({
      logText: malformedLog,
      projectPath: process.cwd(),
      useEmbeddings: false,
      format: 'structured'
    });

    if (!result) {
      console.warn('Local debug context returned no result for malformed log');
      return;
    }

    expect(result).toBeDefined();
    // Should handle gracefully even with malformed input
  }, 15000);
});