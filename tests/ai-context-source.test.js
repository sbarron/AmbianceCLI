const fs = require('fs');
const os = require('os');
const path = require('path');
let mockFiles = ['src/dispatch.ts'];
let mockSemanticMatches = [];
jest.mock('globby', () => ({ globby: async () => mockFiles }));
jest.mock('../src/local/enhancedSemanticCompactor', () => ({
  EnhancedSemanticCompactor: { isEnhancedModeAvailable: () => true },
  enhancedSemanticCompactor: {
    generateEnhancedContext: async () => ({
      // The consumer must use structured matches, not this unrelated rendering.
      content: 'rendered results without parseable chunks',
      semanticMatches: mockSemanticMatches,
      metadata: {
        embeddingsUsed: true,
        similarChunksFound: mockSemanticMatches.length,
        totalFiles: mockSemanticMatches.length,
        includedFiles: mockSemanticMatches.length,
        tokenCount: 10,
        compressionRatio: 1,
      },
    }),
  },
}));

const mockCompletion = jest.fn(async () => ({
  choices: [{ message: { content: 'Mock analysis' } }],
  usage: { total_tokens: 1 },
}));
jest.mock('../src/core/openaiService', () => ({
  createOpenAIService: () => ({
    createChatCompletion: mockCompletion,
    getModelForTask: () => 'mock',
    getProviderInfo: () => ({ provider: 'mock', model: 'mock' }),
    dispose() {},
  }),
  resolveProviderApiKey: () => 'test',
  PROVIDER_API_KEY_ENV: {},
}));
jest.mock('../src/core/compactor/semanticCompactor', () => ({
  SemanticCompactor: class {
    async compact() {
      return {
        files: [
          {
            path: 'src/dispatch.ts',
            language: 'typescript',
            nodes: [],
            exports: ['dispatchParcel'],
          },
        ],
        compressionRatio: 1,
        patterns: [],
      };
    }
  },
}));
jest.mock(
  '../src/core/compactor/fileDiscovery.js',
  () => ({
    FileDiscovery: class {
      constructor(root) {
        this.root = root;
      }
      async discoverFiles() {
        return mockFiles.map(relPath => ({ relPath, absPath: path.join(this.root, relPath) }));
      }
    },
  }),
  { virtual: true }
);

describe('AI context source evidence', () => {
  let root;
  beforeEach(() => {
    jest.useFakeTimers();
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-context-source-'));
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(
      path.join(root, 'src', 'dispatch.ts'),
      [
        'export function dispatchParcel(parcel: { delayed: boolean; held: boolean }) {',
        "  if (parcel.held) return { state: 'manual-review', lane: 'window' };",
        "  return { state: 'accepted', lane: 'primary' };",
        '}',
      ].join('\n')
    );
    process.env.AMBIANCE_HOME = path.join(root, '.ambiance');
    mockCompletion.mockClear();
    mockFiles = ['src/dispatch.ts'];
    mockSemanticMatches = [];
  });
  afterEach(() => {
    jest.useRealTimers();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('sends and returns numbered source for an exact symbol with embeddings disabled', async () => {
    const {
      handleAISemanticCompact,
      cleanupOpenAIService,
    } = require('../src/tools/aiTools/aiSemanticCompact');
    const result = await handleAISemanticCompact({
      projectPath: root,
      query: 'What happens in dispatchParcel when held?',
      useEmbeddings: false,
      maxTokens: 3000,
      format: 'structured',
    });
    expect(result.success).toBe(true);
    expect(result.sourceEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'src/dispatch.ts',
          symbol: 'dispatchParcel',
          startLine: 1,
          endLine: 4,
          truncated: false,
          content: expect.stringContaining(
            "2:   if (parcel.held) return { state: 'manual-review', lane: 'window' };"
          ),
        }),
      ])
    );
    const prompt = JSON.stringify(mockCompletion.mock.calls[0][0]);
    expect(prompt).toContain('parcel.held');
    expect(prompt).toContain('manual-review');
    cleanupOpenAIService();
  }, 30000);

  it('recovers source through lexical discovery when structural source is unavailable', async () => {
    fs.unlinkSync(path.join(root, 'src', 'dispatch.ts'));
    mockFiles = ['src/retry.ts'];
    fs.writeFileSync(
      path.join(root, 'src', 'retry.ts'),
      [
        'export function retryDispatch(canRetry: boolean) {',
        "  if (!canRetry) return { action: 'park', delayMs: 0 };",
        "  return { action: 'retry', delayMs: 450 };",
        '}',
      ].join('\n')
    );
    const {
      handleAISemanticCompact,
      cleanupOpenAIService,
    } = require('../src/tools/aiTools/aiSemanticCompact');
    try {
      const result = await handleAISemanticCompact({
        projectPath: root,
        query: 'retryDispatch',
        useEmbeddings: false,
        maxTokens: 8000,
        format: 'structured',
      });
      expect(result.success).toBe(true);
      expect(result.metadata.sourceEvidenceStatus).toBe('available');
      const evidence = result.sourceEvidence.find(item => item.path === 'src/retry.ts');
      expect(evidence).toBeDefined();
      expect(evidence.content).toContain(
        "2:   if (!canRetry) return { action: 'park', delayMs: 0 };"
      );
      expect(JSON.stringify(mockCompletion.mock.calls[0][0])).toContain("action: 'park'");
    } finally {
      cleanupOpenAIService();
    }
  }, 30000);

  it.each([
    [
      'Where do parcels get diverted for human review, and which state and lane are assigned?',
      'src/dispatch.ts',
      2,
      "  if (parcel.held) return { state: 'manual-review', lane: 'window' };",
    ],
    [
      'What happens when another delivery attempt is forbidden?',
      'src/retry.ts',
      2,
      "  if (!canRetry) return { action: 'park', delayMs: 0 };",
    ],
    [
      'How does the system label a receipt when the same parcel appears twice?',
      'src/receipt.ts',
      2,
      "  return { status: duplicate ? 'reused' : 'minted' };",
    ],
  ])(
    'delivers ranked original source for conceptual query: %s',
    async (query, file, line, expected) => {
      const sources = {
        'src/dispatch.ts': [
          'export function dispatchParcel(parcel: { held: boolean }) {',
          "  if (parcel.held) return { state: 'manual-review', lane: 'window' };",
          "  return { state: 'accepted', lane: 'primary' };",
          '}',
        ].join('\n'),
        'src/retry.ts': [
          'export function retryDispatch(canRetry: boolean) {',
          "  if (!canRetry) return { action: 'park', delayMs: 0 };",
          "  return { action: 'retry', delayMs: 450 };",
          '}',
        ].join('\n'),
        'src/receipt.ts': [
          'export function receiptFor(duplicate: boolean) {',
          "  return { status: duplicate ? 'reused' : 'minted' };",
          '}',
        ].join('\n'),
      };
      mockFiles = Object.keys(sources);
      for (const [name, content] of Object.entries(sources))
        fs.writeFileSync(path.join(root, name), content);
      const {
        handleAISemanticCompact,
        cleanupOpenAIService,
      } = require('../src/tools/aiTools/aiSemanticCompact');
      for (const useEmbeddings of [false, true]) {
        // Emulate a ranked embedding hit with stale content to verify evidence is
        // extracted from current source and never from formatted or cached text.
        mockSemanticMatches = [
          {
            filePath: file,
            similarity: 0.95,
            content: 'STALE BODY',
            startLine: 1,
            endLine: 3,
            symbols: [],
            type: 'code',
            semanticRank: 0,
          },
        ];
        mockCompletion.mockClear();
        const result = await handleAISemanticCompact({
          projectPath: root,
          query,
          useEmbeddings,
          maxTokens: 8000,
          format: 'structured',
          generateEmbeddingsIfMissing: false,
        });
        expect(result.success).toBe(true);
        expect(result.metadata.embeddingsUsed).toBe(useEmbeddings);
        const evidence = result.sourceEvidence.find(
          item => item.path === file && item.startLine <= line && item.endLine >= line
        );
        if (useEmbeddings || evidence) {
          expect(evidence).toBeDefined();
          expect(evidence.content).toContain(`${line}: ${expected}`);
        }
        expect(result.metadata.sourceEvidenceStatus).toBe(
          result.sourceEvidence.length ? 'available' : 'no_source_evidence'
        );
        for (const item of result.sourceEvidence) {
          const actualLines = sources[item.path].split('\n');
          const lines = item.content.split('\n');
          expect(item.endLine - item.startLine + 1).toBe(lines.length);
          lines.forEach((text, i) =>
            expect(text).toBe(`${item.startLine + i}: ${actualLines[item.startLine - 1 + i]}`)
          );
        }
        const prompt = JSON.stringify(mockCompletion.mock.calls[0][0]);
        if (evidence) expect(prompt).toContain(expected.trim());
        expect(prompt).not.toContain('STALE BODY');
      }
      cleanupOpenAIService();
    },
    30000
  );
});
