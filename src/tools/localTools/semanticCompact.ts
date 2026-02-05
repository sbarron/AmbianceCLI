/**
 * @fileOverview: Local semantic compaction tool with embedding support
 * @module: SemanticCompact
 * @keyFunctions:
 *   - localSemanticCompactTool: Tool definition for local context compression
 *   - handleSemanticCompact(): Handler for semantic compaction requests
 * @context: Provides 60-80% token reduction using local AST parsing with optional embedding enhancement (OpenAI → Local Models → AST-only)
 */

export { handleSemanticCompact } from '../../runtime/context/semanticCompact';

/**
 * Tool definition for enhanced local context
 */
export const localSemanticCompactTool = {
  name: 'local_context',
  description:
    '🚀 Enhanced local context with deterministic query-aware retrieval, AST-grep, and actionable intelligence. Provides: (1) deterministic AnswerDraft, (2) ranked JumpTargets, (3) tight MiniBundle (≤3k tokens), (4) NextActions—all using AST + static heuristics. Optional embedding enhancement when available. Completely offline with zero external dependencies for core functionality.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'Query to focus analysis (required for enhanced mode). Example: "How does database connection and local database storage work?"',
      },
      taskType: {
        type: 'string',
        enum: ['understand', 'debug', 'trace', 'spec', 'test'],
        default: 'understand',
        description: 'Type of analysis task - affects query processing and output format',
      },
      maxSimilarChunks: {
        type: 'number',
        default: 20,
        minimum: 5,
        maximum: 50,
        description:
          'Maximum number of semantically similar code chunks to retrieve. Higher values (30-50) provide broader coverage for exploration; lower values (10-15) focus on highly relevant matches. Default 20 balances breadth and relevance.',
      },
      maxTokens: {
        type: 'number',
        default: 3000,
        minimum: 1000,
        maximum: 8000,
        description: 'Token budget for mini-bundle assembly',
      },
      generateEmbeddingsIfMissing: {
        type: 'boolean',
        default: false,
        description:
          'Generate embeddings if missing (requires OpenAI API key) - leave false for pure AST mode',
      },
      useProjectHintsCache: {
        type: 'boolean',
        default: true,
        description: 'Reuse project_hints indices for faster processing',
      },
      astQueries: {
        type: 'array',
        items: { type: 'object' },
        description: 'Optional custom AST queries to supplement automatic detection',
      },
      attackPlan: {
        type: 'string',
        enum: ['auto', 'init-read-write', 'api-route', 'error-driven', 'auth'],
        default: 'auto',
        description:
          'Analysis strategy: auto-detect from query, or specify: init-read-write (DB/storage), api-route (endpoints), auth (authentication), error-driven (debugging)',
      },
      projectPath: {
        type: 'string',
        description: 'Project directory path. Required. Can be absolute or relative to workspace.',
      },
      folderPath: {
        type: 'string',
        description:
          'Analyze specific folder (falls back to legacy mode if enhanced analysis unavailable)',
      },
      format: {
        type: 'string',
        enum: ['xml', 'structured', 'compact', 'enhanced', 'system-map'],
        default: 'enhanced',
        description:
          'Output format: enhanced (new format with jump targets), system-map (architecture overview), structured (legacy), compact, xml',
      },
      excludePatterns: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Additional patterns to exclude from analysis (e.g., ["*.md", "docs/**", "*.test.js"])',
      },
      useEmbeddings: {
        type: 'boolean',
        default: false,
        description: 'Use embeddings for similarity search if available (legacy parameter)',
      },
      embeddingSimilarityThreshold: {
        type: 'number',
        default: 0.2,
        minimum: 0.0,
        maximum: 1.0,
        description:
          'Minimum similarity score (0.0-1.0) for including chunks. Lower values (0.15-0.2) cast a wider net for related code; higher values (0.25-0.35) return only close matches. Use lower thresholds when exploring unfamiliar code.',
      },
    },
    required: ['query', 'projectPath'],
  },
};
