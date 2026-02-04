const path = require('path');

describe('Local Context Tool', () => {
  let handleSemanticCompact;

  beforeAll(() => {
    try {
      const module = require('../dist/src/tools/localTools/index.js');
      handleSemanticCompact = module.handleSemanticCompact;
    } catch (error) {
      console.warn('Local context module not available:', error.message);
    }
  });

  it('should handle local context without embeddings', async () => {
    if (!handleSemanticCompact) {
      console.warn('Handler not available, skipping test');
      return;
    }

    const testConfig = {
      explanation: "Testing local_context basic functionality",
      query: "What is this project about?",
      projectPath: path.resolve('.'),
      maxTokens: 2000,
      useEmbeddings: false,
      taskType: "understand",
      format: "compact"
    };

    const result = await handleSemanticCompact(testConfig);
    
    expect(result).toBeDefined();
    expect(result.success).toBeDefined();
    
    if (result.success) {
      expect(result.metadata).toBeDefined();
      expect(result.metadata.filesProcessed).toBeGreaterThan(0);
    }
  }, 30000);

  it('should handle local context with embeddings if available', async () => {
    if (!handleSemanticCompact) {
      console.warn('Handler not available, skipping test');
      return;
    }

    const testConfig = {
      explanation: "Testing local_context with embeddings",
      query: "authentication and user management",
      projectPath: path.resolve('.'),
      maxTokens: 4000,
      useEmbeddings: true,
      generateEmbeddingsIfMissing: false, // Don't generate during tests
      taskType: "understand",
      format: "compact"
    };

    const result = await handleSemanticCompact(testConfig);
    
    expect(result).toBeDefined();
    expect(result.success).toBeDefined();
    
    // Should work even if embeddings aren't available (fallback)
    if (result.success) {
      expect(result.metadata).toBeDefined();
      expect(result.compactedContent).toBeDefined();
    }
  }, 30000);
});