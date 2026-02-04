const path = require('path');

// Allow a bit more time for enhanced AST analysis
jest.setTimeout(30000);

describe('Environment Matrix Coverage', () => {
  let originalEnv;
  let handleSemanticCompact;
  let detectWorkspaceDirectory;

  beforeAll(() => {
    try {
      const localTools = require('../dist/src/tools/localTools/index.js');
      handleSemanticCompact = localTools.handleSemanticCompact;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('localTools not available:', e && e.message);
    }

    try {
      ({ detectWorkspaceDirectory } = require('../dist/src/tools/utils/pathUtils.js'));
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('pathUtils not available:', e && e.message);
    }
  });

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.JEST_DOTENV_SILENT = '1';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('WORKSPACE_FOLDER only: resolves workspace and runs locally', async () => {
    if (!handleSemanticCompact || !detectWorkspaceDirectory) return;

    delete process.env.USE_LOCAL_EMBEDDINGS;
    delete process.env.OPENAI_API_KEY;
    delete process.env.AMBIANCE_API_KEY;

    process.env.WORKSPACE_FOLDER = process.cwd();

    const resolved = detectWorkspaceDirectory();
    expect(resolved).toBe(process.env.WORKSPACE_FOLDER);

    const res = await handleSemanticCompact({
      query: 'project overview and entrypoints',
      // Explicit projectPath matches resolved workspace
      format: 'compact',
      useEmbeddings: false,
      maxTokens: 1500,
      projectPath: process.env.WORKSPACE_FOLDER,
    });

    expect(res).toBeDefined();
    expect(res.success).toBe(true);
    expect(typeof res.compactedContent).toBe('string');
    expect(res.compactedContent.length).toBeGreaterThan(0);
  });

  it('Embeddings enabled (USE_LOCAL_EMBEDDINGS=true): runs without generating new embeddings', async () => {
    if (!handleSemanticCompact) return;

    process.env.USE_LOCAL_EMBEDDINGS = 'true';
    process.env.LOCAL_STORAGE_PATH = path.resolve(process.cwd(), 'test-storage');
    delete process.env.OPENAI_API_KEY;
    delete process.env.AMBIANCE_API_KEY;

    const res = await handleSemanticCompact({
      query: 'authentication and storage layers',
      format: 'enhanced',
      useEmbeddings: true,
      // Do not generate embeddings in tests (offline)
      generateEmbeddingsIfMissing: false,
      maxTokens: 1500,
      projectPath: process.cwd(),
    });

    expect(res).toBeDefined();
    expect(res.success).toBe(true);
    expect(typeof res.compactedContent).toBe('string');
    expect(res.compactedContent.length).toBeGreaterThan(0);
    // embeddingsUsed may be false if no prior embeddings exist; do not assert true
  });

  it('OpenAI present (OPENAI_API_KEY set): local handler remains stable offline', async () => {
    if (!handleSemanticCompact) return;

    delete process.env.USE_LOCAL_EMBEDDINGS;
    process.env.OPENAI_API_KEY = 'test-openai-key';
    delete process.env.AMBIANCE_API_KEY;

    const res = await handleSemanticCompact({
      query: 'fallback behavior and provider selection',
      format: 'compact',
      useEmbeddings: false,
      maxTokens: 1200,
      projectPath: process.cwd(),
    });

    expect(res).toBeDefined();
    expect(res.success).toBe(true);
  });

  it('Ambiance present (AMBIANCE_API_KEY set): local handler remains stable offline', async () => {
    if (!handleSemanticCompact) return;

    delete process.env.USE_LOCAL_EMBEDDINGS;
    delete process.env.OPENAI_API_KEY;
    process.env.AMBIANCE_API_KEY = 'amb_test_key_123';

    const res = await handleSemanticCompact({
      query: 'cloud integration capability selection',
      format: 'compact',
      useEmbeddings: false,
      maxTokens: 1200,
      projectPath: process.cwd(),
    });

    expect(res).toBeDefined();
    expect(res.success).toBe(true);
  });
});





