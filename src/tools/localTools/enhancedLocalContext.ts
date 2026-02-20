/**
 * @fileOverview: Enhanced local_context tool with deterministic retrieval and analysis
 * @module: EnhancedLocalContext
 * @keyFunctions:
 *   - localContext(): Main entry point for enhanced context retrieval
 *   - buildCandidateGeneration(): AST-based candidate generation with ranking
 *   - assembleMiniBundle(): Token-budgeted snippet assembly
 *   - generateAnswerDraft(): Template-based deterministic answers
 * @context: Provides actionable context through AST-grep, call-graph slicing, and snippet assembly
 */

import { FileInfo } from '../../core/compactor/fileDiscovery';
import { EnhancedProjectSummary } from './enhancedHints';
import { logger } from '../../utils/logger';
import * as path from 'path';
import { estimateTokens as estimateTokensShared } from '../utils/toolHelpers';
import { validateAndResolvePath } from '../utils/pathUtils';
import { compileExcludePatterns, isExcludedPath } from '../utils/toolHelpers';

// ===== API INTERFACES =====

export interface LocalContextRequest {
  projectPath: string;
  query: string;
  taskType?: 'understand' | 'debug' | 'trace' | 'spec' | 'test';
  maxSimilarChunks?: number;
  maxTokens?: number;
  generateEmbeddingsIfMissing?: boolean;
  useProjectHintsCache?: boolean;
  astQueries?: AstQuery[];
  attackPlan?: 'auto' | 'init-read-write' | 'api-route' | 'error-driven' | 'auth';
  excludePatterns?: string[];
}

export interface LocalContextResponse {
  success: boolean;
  answerDraft: string;
  jumpTargets: JumpTarget[];
  byFile?: Record<string, JumpTarget[]>; // Jump targets grouped by file
  miniBundle: BundleSnippet[];
  next: NextActions;
  evidence: string[];
  metadata: ContextMetadata;
  llmBundle?: LocalContextOut;
}

export interface JumpTarget {
  file: string;
  symbol: string;
  start?: number;
  end?: number;
  role: string;
  confidence: number;
  relevance?: number; // Separate relevance score for query importance
  why: string[];
  snippet?: string; // Code snippet preview (5-10 lines)
}

export interface BundleSnippet {
  file: string;
  symbol: string;
  snippet: string;
  byteLen: number;
}

export interface NextActions {
  mode: 'code_lookup' | 'project_research' | 'implementation_ready';
  openFiles: string[];
  checks: string[];
}

export interface ContextMetadata {
  filesScanned: number;
  symbolsConsidered: number;
  originalTokens: number;
  compactedTokens: number;
  bundleTokens: number;
  processingTimeMs: number;
  roleDistribution?: Record<string, number>; // Count of symbols by role
}

// ===== AST QUERY DSL =====

export type AstQuery =
  | { kind: 'import'; source: string | RegExp; importName?: string | RegExp }
  | { kind: 'export'; name: string | RegExp }
  | { kind: 'call'; callee: string | RegExp; inFiles?: string[] }
  | { kind: 'new'; className: string | RegExp }
  | { kind: 'assign'; lhs: string | RegExp; rhsCallee?: string | RegExp }
  | { kind: 'env'; key: string | RegExp }
  | { kind: 'route'; method?: string | RegExp; path?: string | RegExp };

// ===== ATTACK PLAN RECIPES =====

export const ATTACK_PLAN_RECIPES: Record<string, AstQuery[]> = {
  'init-read-write': [
    { kind: 'import', source: /(sqlite|better-sqlite3|knex|drizzle|typeorm|mongoose|pg)/i },
    { kind: 'export', name: /(initialize(Database|DB)|connect|open|init)/i },
    {
      kind: 'call',
      callee: /(createTable|prepare|run|exec|insert|upsert|select|query|find|save)/i,
      inFiles: ['**/local/**', '**/db/**', '**/database/**'],
    },
    { kind: 'env', key: /(DB_PATH|DATABASE_URL|EMBEDDING_MODEL|DB_)/i },
  ],
  'api-route': [
    { kind: 'import', source: /(express|fastify|koa|hapi|next|router)/i },
    { kind: 'route', method: /(get|post|put|delete|patch)/i },
    {
      kind: 'call',
      callee: /(app\.(get|post|put|delete|patch)|router\.(get|post|put|delete|patch))/i,
    },
    { kind: 'export', name: /(handler|route|controller|api)/i },
  ],
  'error-driven': [
    { kind: 'call', callee: /(throw|error|catch|reject)/i },
    { kind: 'export', name: /(error|exception|handler)/i },
    { kind: 'import', source: /(error|exception|logging)/i },
  ],
  auth: [
    {
      kind: 'import',
      source:
        /(jwt|jose|passport|auth|session|bcrypt|crypto|@supabase\/supabase-js|next-auth|cookies)/i,
    },
    {
      kind: 'export',
      name: /(auth|login|signin|signout|logout|verify|token|session|middleware|guard|requireAuth|withAuth)/i,
    },
    {
      kind: 'call',
      callee:
        /(sign|verify|hash|compare|authenticate|authorize|createClient|getSession|getUser|onAuthStateChange|cookies|jwt\.(sign|verify)|jwtVerify|setCookie|getCookie)/i,
    },
    { kind: 'route', method: /(get|post|put|delete|patch)/i },
    {
      kind: 'env',
      key: /(JWT_SECRET|AUTH_SECRET|SESSION_SECRET|API_KEY|SUPABASE_(URL|ANON_KEY|SERVICE_ROLE_KEY))/i,
    },
  ],
};

// ===== DOMAIN KEYWORD MAPS =====

export const DOMAIN_KEYWORDS = {
  database: [
    'db',
    'database',
    'storage',
    'sqlite',
    'postgres',
    'mongo',
    'store',
    'persist',
    'save',
    'query',
    'search',
    'index',
  ],
  auth: [
    'auth',
    'login',
    'signin',
    'signout',
    'logout',
    'session',
    'token',
    'jwt',
    'cookie',
    'supabase',
    'nextauth',
    'oauth',
    'clerk',
    'firebase',
    'jose',
    'jsonwebtoken',
    'verify',
    'rls',
    'policy',
    'user',
    'guard',
    'middleware',
  ],
  api: ['api', 'route', 'endpoint', 'handler', 'controller', 'service', 'rest', 'graphql'],
  search: ['search', 'find', 'query', 'embedding', 'vector', 'similarity', 'index', 'retrieval'],
  provider: ['provider', 'client', 'adapter', 'wrapper', 'service', 'connection'],
  config: ['config', 'env', 'setting', 'option', 'variable', 'param'],
  init: ['init', 'initialize', 'setup', 'start', 'boot', 'load', 'create'],
  tool: ['tool', 'command', 'cli', 'script', 'util', 'helper'],
};

// ===== TEMPLATE SYSTEM =====

export interface AnswerTemplate {
  pattern: string;
  variables: string[];
}

export const ANSWER_TEMPLATES: Record<string, Record<string, AnswerTemplate>> = {
  understand: {
    'init-read-write': {
      pattern: `{engine} database system using {initFile}:{initSymbol} for initialization. Data is stored through {writeSymbols} and retrieved via {readSymbols}. Configuration uses {envKeys}. Entry point: {triggerPoints}. Tests: {testFiles}.`,
      variables: [
        'engine',
        'initFile',
        'initSymbol',
        'writeSymbols',
        'readSymbols',
        'envKeys',
        'triggerPoints',
        'testFiles',
      ],
    },
    'api-route': {
      pattern: `{framework} API with routes defined in {routeFiles}. Handlers: {handlers}. Entry point: {entryPoint}. Configuration: {envKeys}.`,
      variables: ['framework', 'routeFiles', 'handlers', 'entryPoint', 'envKeys'],
    },
    auth: {
      pattern: `Authentication using {authStrategy} with {tokenHandling}. Session management: {sessionFiles}. Security config: {envKeys}. Middleware: {middlewareFiles}.`,
      variables: ['authStrategy', 'tokenHandling', 'sessionFiles', 'envKeys', 'middlewareFiles'],
    },
  },
  debug: {
    'init-read-write': {
      pattern: `Common failure points: missing {envKeys}, {initSymbol} initialization errors, permission issues with {storePath}. Verify: {checks}.`,
      variables: ['envKeys', 'initSymbol', 'storePath', 'checks'],
    },
  },
  trace: {
    'init-read-write': {
      pattern: `Call flow: {entryPoint} → {initSymbol} → {storageSetup} → {readWriteMethods}. Chain: {callChain}.`,
      variables: ['entryPoint', 'initSymbol', 'storageSetup', 'readWriteMethods', 'callChain'],
    },
  },
};

// ===== CANDIDATE SCORING =====

export interface CandidateSymbol {
  file: string;
  symbol: string;
  start: number;
  end: number;
  kind: string;
  score: number;
  reasons: string[];
  role?: string;
}

export interface ScoringContext {
  queryTokens: string[];
  attackPlan: string;
  domainKeywords: string[];
  projectIndices: any; // From project_hints
}

// ===== TOPIC DETECTION & STOPLISTS =====

export type Topic =
  | 'auth'
  | 'db'
  | 'api'
  | 'state'
  | 'components'
  | 'errors'
  | 'config'
  | 'unknown';

function detectTopic(q: string): Topic {
  const s = (q || '').toLowerCase();
  if (/\bauth(entication)?\b|login|token|session|jwt|oauth|supabase/.test(s)) return 'auth';
  if (/\b(db|database|prisma|sql|query|model)\b/.test(s)) return 'db';
  if (/\bapi|endpoint|route|handler|controller\b/.test(s)) return 'api';
  if (/\bstate|redux|context\s*api|use(state|reducer)\b/.test(s)) return 'state';
  if (/\bcomponent|ui|view|page|jsx|template|sfc\b/.test(s)) return 'components';
  if (/\berror|exception|retry|circuit|fallback\b/.test(s)) return 'errors';
  if (/\bconfig|configuration|env|setting(s)?\b/.test(s)) return 'config';
  return 'unknown';
}

export const UNIVERSAL_NEGATIVES = [
  '**/*.test.*',
  '**/*.spec.*',
  '**/__tests__/**',
  '**/__mocks__/**',
  '**/*.stories.*',
  '**/fixtures/**',
  '**/examples/**',
  '**/benchmarks/**',
  '**/coverage/**',
  '**/*.config.*',
  '**/*.d.ts',
  '**/scripts/**',
  '**/tests/**',
  '**/dist/**',
  '**/build/**',
  '**/projection_matrix.*',
  '**/*.md',
  '**/README*',
];

const STOPLIST_BY_TOPIC: Record<Topic, string[]> = {
  auth: [...UNIVERSAL_NEGATIVES, '**/*.md', '**/README*', '**/docs/**'],
  db: UNIVERSAL_NEGATIVES,
  api: UNIVERSAL_NEGATIVES,
  state: UNIVERSAL_NEGATIVES,
  components: UNIVERSAL_NEGATIVES,
  errors: UNIVERSAL_NEGATIVES,
  config: UNIVERSAL_NEGATIVES,
  unknown: UNIVERSAL_NEGATIVES,
};

// Auth path hints and regexes (generic providers without project name hardcoding)
const AUTH_FILE_HINTS: string[] = [
  '**/middleware/**',
  '**/*auth*',
  '**/*Auth*',
  '**/services/**/auth*',
  '**/integration/**/auth*',
  '**/lib/supabase*',
  '**/supabase*',
];

const AUTH_REGEXES: RegExp[] = [
  /\bcreateClient(Component)?Client\b/,
  /\buseAuth\b|\bAuthContext\b|\bAuthProvider\b/,
  /from\s+['"]@supabase\/supabase-js['"]/,
  /process\.env\.(SUPABASE|NEXTAUTH|AUTH0|CLERK|JWT)_/i,
  /\b(signIn|signOut|signUp|getSession|setSession)\b/,
  /\bverify(Jwt|Token)\b|\bjwt\.verify\b|\bAuthMiddleware\b/,
];

// ===== LLM-READY BUNDLE TYPES =====

export type LocalContextOut = {
  success: true;
  query: string;
  topic: Topic;
  fingerprint?: { languages: string[]; frameworks: string[]; families: string[] };
  anchors: { file: string; score: number; reasons: string[]; features: string[] }[];
  neighbors: string[];
  coverage?: Record<string, { found: number; requiredMin: number }>;
  envHints: string[];
  suggestedExcerpts: { file: string; ranges: { start: number; end: number }[] }[];
  summaryPlan: string[];
  answerFrame: string[];
  warnings?: string[];
  debug?: { filesScanned: number; strategies: string[] };
};

// ===== MAIN IMPLEMENTATION =====

/**
 * Enhanced local context with deterministic retrieval
 */
export async function localContext(req: LocalContextRequest): Promise<LocalContextResponse> {
  const startTime = Date.now();

  logger.info('🔍 Enhanced local context request', {
    projectPath: req.projectPath,
    query: req.query,
    taskType: req.taskType,
    attackPlan: req.attackPlan,
    maxTokens: req.maxTokens,
  });

  // Validate that projectPath is provided
  if (!req.projectPath) {
    throw new Error(
      '❌ projectPath is required. Please provide an absolute path to the project directory.'
    );
  }

  // Set defaults
  const request = {
    taskType: 'understand',
    maxSimilarChunks: 20,
    maxTokens: 3000,
    generateEmbeddingsIfMissing: false,
    useProjectHintsCache: true,
    attackPlan: 'auto',
    ...req,
  } as Required<LocalContextRequest>;

  try {
    // 1. Load project indices (reuse project_hints cache)
    const indices = await loadProjectIndices(request.projectPath, request.useProjectHintsCache);

    // 2. Choose attack plan
    const plan = chooseAttackPlan(request.attackPlan, request.query);
    const topic = detectTopic(request.query);

    // 3. Build DSL queries for this plan
    const dslQueries = buildDslQueriesForPlan(plan, request.query, request.astQueries);

    // 3.5 Topic-aware file prioritization and stoplist filtering
    const prioritizedFiles = prioritizeFilesForTopic(indices.files, topic);

    const customExcludePatterns = request.excludePatterns || [];
    const allExcludePatterns = [...UNIVERSAL_NEGATIVES, ...customExcludePatterns];
    const excludeMatchers = compileExcludePatterns(allExcludePatterns);

    const filteredFiles = prioritizedFiles.filter(
      file => !isExcludedPath(file.relPath, excludeMatchers)
    );

    // 4. Run AST queries to find matches
    const astMatches = await runAstQueries(filteredFiles, dslQueries);

    // 4.5 Family/topic-aware detectors beyond generic AST (no embeddings)
    const extraCandidates: CandidateSymbol[] = [];
    if (topic === 'api') {
      const apiExtras = await gatherApiRouteCandidates(filteredFiles);
      extraCandidates.push(...apiExtras);
    } else if (topic === 'components') {
      const compExtras = await gatherComponentCandidates(filteredFiles);
      extraCandidates.push(...compExtras);
    } else if (topic === 'db') {
      const dbExtras = await gatherDbSchemaCandidates(filteredFiles);
      extraCandidates.push(...dbExtras);
    }

    // 5. Generate and rank candidates
    const allMatches = [...astMatches, ...extraCandidates];
    const candidates = await rankCandidates(allMatches, indices, request.query, plan);

  // 6. Select top jump targets (respect maxSimilarChunks) with enhancements
    let jumpTargets = await selectJumpTargets(candidates, {
      max: Math.max(1, Math.min(request.maxSimilarChunks, 20)),
      query: request.query,
      files: indices.files,
    });

    if (jumpTargets.length === 0 && candidates.length > 0) {
      const candidate = candidates[0];
      const range = await resolveCandidateLineRange(candidate, indices.files);
      const lineStart = range.start ?? candidate.start ?? 1;
      const lineEnd = range.end ?? candidate.end ?? lineStart;
      const previewCandidate = {
        ...candidate,
        start: lineStart,
        end: lineEnd,
      };
      const snippet = await extractSnippetPreview(previewCandidate, indices.files);
      const relevance = calculateRelevance(candidate, request.query);
      jumpTargets = [
        {
          file: candidate.file,
          symbol: candidate.symbol,
          start: lineStart,
          end: lineEnd,
          role: candidate.role || inferRoleFromSymbol(candidate.symbol),
          confidence: candidate.score,
          relevance,
          why: candidate.reasons,
          snippet,
        },
      ];
    }

    // 7. Build mini-bundle with token budget
    const miniBundle = await buildMiniBundle(jumpTargets, indices.files, request.maxTokens);

    // 8. Generate deterministic answer draft
    const answerDraft = await generateDeterministicAnswer(
      plan,
      request.taskType,
      jumpTargets,
      indices
    );

    // 9. Compute next actions
    const nextActions = computeNextActions(jumpTargets, request.taskType);

    // 10. Build evidence list
    const evidence = buildEvidence(jumpTargets, astMatches);

    // 11. Build LLM-ready bundle with anchors/neighbors/env hints
    const llmBundle = buildLLMBundle({
      query: request.query,
      topic,
      ranked: candidates,
      files: indices.files,
      importGraph: await getOrBuildImportGraph(indices),
      envKeys: (indices.env || []).map((e: any) => e.key),
      fingerprint: await fingerprintRepo(indices.files),
    });

    const processingTimeMs = Date.now() - startTime;

    // Calculate role distribution
    const roleDistribution: Record<string, number> = {};
    jumpTargets.forEach(target => {
      const role = target.role;
      roleDistribution[role] = (roleDistribution[role] || 0) + 1;
    });

    // Group jump targets by file
    const byFile: Record<string, JumpTarget[]> = {};
    jumpTargets.forEach(target => {
      const relPath = getRelativePath(target.file);
      if (!byFile[relPath]) {
        byFile[relPath] = [];
      }
      byFile[relPath].push(target);
    });

    return {
      success: true,
      answerDraft,
      jumpTargets,
      byFile,
      miniBundle,
      next: nextActions,
      evidence,
      metadata: {
        filesScanned: indices.files.length,
        symbolsConsidered: candidates.length,
        originalTokens: 0,
        compactedTokens: 0,
        bundleTokens: miniBundle.reduce((sum, item) => sum + estimateTokensShared(item.snippet), 0),
        processingTimeMs,
        roleDistribution,
      },
      llmBundle,
    };
  } catch (error) {
    logger.error('❌ Enhanced local context failed', {
      error: error instanceof Error ? error.message : String(error),
      query: req.query,
    });

    return {
      success: false,
      answerDraft: `Unable to analyze query "${req.query}". ${error instanceof Error ? error.message : String(error)}`,
      jumpTargets: [],
      miniBundle: [],
      next: { mode: 'project_research', openFiles: [], checks: [] },
      evidence: [],
      metadata: {
        filesScanned: 0,
        symbolsConsidered: 0,
        originalTokens: 0,
        compactedTokens: 0,
        bundleTokens: 0,
        processingTimeMs: Date.now() - startTime,
      },
    };
  }
}

// ===== IMPLEMENTATION FUNCTIONS =====

async function loadProjectIndices(projectPath: string, useCache: boolean): Promise<ProjectContext> {
  // Import project hints functionality
  const { buildEnhancedProjectSummary } = await import('./enhancedHints');
  const { FileDiscovery } = await import('../../core/compactor/fileDiscovery');

  // Validate and resolve the project path
  const validatedProjectPath = validateAndResolvePath(projectPath);

  try {
    const fileDiscovery = new FileDiscovery(validatedProjectPath, {
      maxFileSize: 200000,
    });

    const files = await fileDiscovery.discoverFiles();

    if (useCache) {
      // Try to reuse existing enhanced project summary
      const enhancedSummary = await buildEnhancedProjectSummary(
        validatedProjectPath,
        files.slice(0, 100)
      );

      return {
        files,
        exports: enhancedSummary.surfaces.exports,
        // Extract import metadata from import graph keys for lightweight summaries
        imports: await (async () => {
          try {
            // Using dynamic import for consistency and to avoid require() issues
            const indexersModule = await import('./indexers');
            const graph = (await indexersModule.buildImportGraph(files)) as
              | Map<string, string[]>
              | Record<string, string[]>;
            const entries: { file: string; imports: string[] }[] = [];
            if (graph instanceof Map) {
              for (const [file, imps] of graph.entries()) {
                entries.push({ file, imports: imps.slice(0, 10) });
              }
            } else if (typeof graph === 'object') {
              for (const k of Object.keys(graph)) {
                const imps = (graph as any)[k] || [];
                entries.push({ file: k, imports: imps.slice(0, 10) });
              }
            }
            return entries.slice(0, 50);
          } catch {
            return [];
          }
        })(),
        routes: enhancedSummary.surfaces.routes,
        env: enhancedSummary.surfaces.envKeys,
        systems: enhancedSummary.systems,
      };
    } else {
      return {
        files,
        exports: [],
        imports: [],
        routes: [],
        env: [],
        systems: {},
      };
    }
  } catch (error) {
    logger.warn('⚠️ Failed to load project indices, using minimal context', { error });
    return {
      files: [],
      exports: [],
      imports: [],
      routes: [],
      env: [],
      systems: {},
    };
  }
}

function chooseAttackPlan(plan: string, query: string): string {
  if (plan !== 'auto') return plan;

  // Auto-detect plan based on query keywords with more sophisticated matching
  const queryLower = query.toLowerCase();
  const words = queryLower.split(/\s+/);

  // Score each plan based on keyword presence
  const planScores = {
    'init-read-write': 0,
    'api-route': 0,
    auth: 0,
    'error-driven': 0,
  };

  // Database/storage keywords
  const dbKeywords = [
    'database',
    'storage',
    'db',
    'sqlite',
    'persist',
    'save',
    'query',
    'search',
    'index',
    'store',
    'connection',
    'local',
    'embedding',
  ];
  const apiKeywords = [
    'api',
    'route',
    'endpoint',
    'handler',
    'controller',
    'server',
    'http',
    'request',
    'response',
  ];
  const authKeywords = [
    'auth',
    'login',
    'session',
    'token',
    'jwt',
    'permission',
    'user',
    'password',
    'security',
  ];
  const errorKeywords = ['error', 'exception', 'fail', 'bug', 'issue', 'debug', 'trace', 'problem'];

  // Count matches for each category
  for (const word of words) {
    if (dbKeywords.some(kw => word.includes(kw))) planScores['init-read-write']++;
    if (apiKeywords.some(kw => word.includes(kw))) planScores['api-route']++;
    if (authKeywords.some(kw => word.includes(kw))) planScores['auth']++;
    if (errorKeywords.some(kw => word.includes(kw))) planScores['error-driven']++;
  }

  // Find highest scoring plan
  const topPlan = Object.entries(planScores).sort(([, a], [, b]) => b - a)[0][0];

  return planScores[topPlan as keyof typeof planScores] > 0 ? topPlan : 'init-read-write';
}

function buildDslQueriesForPlan(
  plan: string,
  query: string,
  userQueries: AstQuery[] = []
): AstQuery[] {
  const planQueries = ATTACK_PLAN_RECIPES[plan] || [];

  // Add query-specific queries if they don't exist
  const queryWords = query.toLowerCase().split(/\s+/);
  const dynamicQueries: AstQuery[] = [];

  // Add dynamic function/symbol queries based on query content
  for (const word of queryWords) {
    if (word.length > 3 && !['the', 'and', 'how', 'does', 'what', 'when', 'where'].includes(word)) {
      dynamicQueries.push({ kind: 'export', name: new RegExp(word, 'i') });
      dynamicQueries.push({ kind: 'call', callee: new RegExp(word, 'i') });
    }
  }

  return [...planQueries, ...dynamicQueries, ...userQueries];
}

async function runAstQueries(files: FileInfo[], queries: AstQuery[]): Promise<CandidateSymbol[]> {
  const { runAstQueriesOnFiles } = await import('./astQueryEngine');
  return runAstQueriesOnFiles(files, queries, 100);
}

async function rankCandidates(
  matches: CandidateSymbol[],
  indices: ProjectContext,
  query: string,
  plan: string
): Promise<CandidateSymbol[]> {
  const { rankCandidatesWithScoring } = await import('./candidateRanking');
  const ranked = await rankCandidatesWithScoring(matches, indices, query, plan);
  return ranked.slice(0, 20); // Return top 20 candidates
}

async function selectJumpTargets(
  candidates: CandidateSymbol[],
  options: { max: number; query?: string; files?: FileInfo[] }
): Promise<JumpTarget[]> {
  // 1. Deduplicate by file+symbol+start
  const seen = new Set<string>();
  const deduplicated = candidates.filter(candidate => {
    const key = `${candidate.file}:${candidate.symbol}:${candidate.start}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });

  // 2. Take top N after deduplication
  const topCandidates = deduplicated.slice(0, options.max);

  // 3. Create jump targets with enhancements
  const targets = await Promise.all(
    topCandidates.map(async candidate => {
      const range = await resolveCandidateLineRange(candidate, options.files || []);
      // Calculate relevance based on query match (if query provided)
      let relevance: number | undefined;
      if (options.query) {
        relevance = calculateRelevance(candidate, options.query);
      }

      // Extract snippet preview (5-10 lines)
      let snippet: string | undefined;
      if (options.files && range.start && range.end) {
        const lineStart = range.start ?? candidate.start ?? 1;
        const lineEnd = range.end ?? candidate.end ?? lineStart;
        const previewCandidate = {
          ...candidate,
          start: lineStart,
          end: lineEnd,
        };
        snippet = await extractSnippetPreview(previewCandidate, options.files);
      }

      return {
        file: candidate.file,
        symbol: candidate.symbol,
        start: range.start,
        end: range.end,
        role: candidate.role || inferRoleFromSymbol(candidate.symbol),
        confidence: candidate.score,
        relevance,
        why: candidate.reasons,
        snippet,
      };
    })
  );

  return targets;
}

async function resolveCandidateLineRange(
  candidate: CandidateSymbol,
  files: FileInfo[]
): Promise<{ start?: number; end?: number }> {
  if (!candidate.start || candidate.start < 1) {
    return { start: 1, end: 1 };
  }

  const fileInfo = files.find(f => f.absPath === candidate.file || f.relPath === candidate.file);
  if (!fileInfo) {
    return { start: candidate.start, end: candidate.end || candidate.start };
  }

  try {
    const fs = await import('fs').then(m => m.promises);
    const content = await fs.readFile(fileInfo.absPath, 'utf-8');
    const totalLines = content.split('\n').length;

    const rawStart = candidate.start;
    const rawEnd = candidate.end || rawStart;

    // If range already appears to be line-based, keep it.
    if (rawStart <= totalLines && rawEnd <= totalLines + 1) {
      return {
        start: Math.max(1, rawStart),
        end: Math.max(1, Math.min(totalLines, rawEnd)),
      };
    }

    const toLine = (offset: number) => {
      const clamped = Math.max(0, Math.min(offset, content.length));
      let line = 1;
      for (let i = 0; i < clamped; i++) {
        if (content.charCodeAt(i) === 10) line += 1; // '\n'
      }
      return line;
    };

    const lineStart = toLine(rawStart);
    const lineEnd = Math.max(lineStart, toLine(rawEnd));
    return { start: lineStart, end: lineEnd };
  } catch {
    return { start: candidate.start, end: candidate.end || candidate.start };
  }
}

/**
 * Calculate relevance score based on how well the candidate matches the query
 */
function calculateRelevance(candidate: CandidateSymbol, query: string): number {
  const queryLower = query.toLowerCase();
  const symbolLower = candidate.symbol.toLowerCase();
  const fileLower = candidate.file.toLowerCase();

  let score = 0.5; // Base relevance

  // Exact symbol match: high relevance
  if (symbolLower.includes(queryLower)) {
    score += 0.3;
  }

  // Query words match symbol parts
  const queryWords = queryLower.split(/\s+/);
  const matchedWords = queryWords.filter(
    word => word.length > 2 && symbolLower.includes(word)
  );
  score += (matchedWords.length / queryWords.length) * 0.2;

  // File path relevance
  if (fileLower.includes(queryLower)) {
    score += 0.15;
  }

  // Role-based boost
  const role = candidate.role || inferRoleFromSymbol(candidate.symbol);
  if (role === 'interface' || role === 'export') {
    score += 0.1; // Public APIs are more relevant
  }

  // Normalize to 0-1 range
  return Math.min(1.0, score);
}

/**
 * Extract a snippet preview (5-10 lines) from the file
 */
async function extractSnippetPreview(
  candidate: CandidateSymbol,
  files: FileInfo[]
): Promise<string | undefined> {
  try {
    const fs = await import('fs').then(m => m.promises);

    // Find the file
    const fileInfo = files.find(f => f.absPath === candidate.file || f.relPath === candidate.file);
    if (!fileInfo) {
      return undefined;
    }

    // Read the file content
    const content = await fs.readFile(fileInfo.absPath, 'utf-8');
    const lines = content.split('\n');

    // Extract lines around the symbol (show context)
    const startLine = Math.max(0, candidate.start - 1); // Convert to 0-indexed
    const endLine = Math.min(lines.length, candidate.end || candidate.start + 5);

    // Take at most 10 lines
    const maxLines = 10;
    const actualEnd = Math.min(endLine, startLine + maxLines);

    const snippetLines = lines.slice(startLine, actualEnd);

    // Trim leading/trailing empty lines
    while (snippetLines.length > 0 && snippetLines[0].trim() === '') {
      snippetLines.shift();
    }
    while (snippetLines.length > 0 && snippetLines[snippetLines.length - 1].trim() === '') {
      snippetLines.pop();
    }

    return snippetLines.join('\n');
  } catch (error) {
    logger.debug('Failed to extract snippet preview', {
      file: candidate.file,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

async function buildMiniBundle(
  targets: JumpTarget[],
  files: FileInfo[],
  maxTokens: number
): Promise<BundleSnippet[]> {
  const { assembleMiniBundle } = await import('./miniBundleAssembler');
  return assembleMiniBundle(targets, files, maxTokens);
}

async function generateDeterministicAnswer(
  plan: string,
  taskType: string,
  targets: JumpTarget[],
  indices: ProjectContext
): Promise<string> {
  // Using dynamic import for consistency and to avoid require() issues
  const answerModule = await import('./answerDraftGenerator');
  return answerModule.generateDeterministicAnswer(plan, taskType, targets, indices);
}

function computeNextActions(targets: JumpTarget[], taskType: string): NextActions {
  const mode: 'code_lookup' | 'project_research' | 'implementation_ready' =
    targets.length > 0 ? 'code_lookup' : 'project_research';

  const openFiles = targets.slice(0, 3).map(t => {
    if (t.start && t.end) {
      return `${getRelativePath(t.file)}:${t.start}-${t.end}`;
    }
    return getRelativePath(t.file);
  });

  const checks: string[] = [];

  // Add task-specific checks
  switch (taskType) {
    case 'debug':
      checks.push('npm test');
      checks.push('rg -n "TODO|FIXME" src -m 10');
      break;
    case 'understand':
      checks.push('rg --files src | rg -n "(README|\\.md$)" -m 5');
      break;
    case 'trace':
      checks.push('rg -n "console\\.log|logger" src -m 10');
      break;
  }

  return { mode, openFiles, checks };
}

function buildEvidence(targets: JumpTarget[], matches: CandidateSymbol[]): string[] {
  const evidence: string[] = [];

  // Add key findings
  targets.forEach(target => {
    evidence.push(`${target.symbol} @ ${getRelativePath(target.file)}:${target.start || 0}`);
  });

  // Add import/export evidence
  matches
    .filter(m => m.kind === 'import' || m.kind === 'export')
    .slice(0, 3)
    .forEach(match => {
      evidence.push(`${match.kind}: ${match.symbol} @ ${getRelativePath(match.file)}`);
    });

  return evidence.slice(0, 10); // Limit to top 10 pieces of evidence
}

function estimateTokens(text: string): number {
  // More accurate token estimation
  const words = text.split(/\s+/).length;
  const punctuation = (text.match(/[.,;:!?(){}\[\]]/g) || []).length;
  const numbers = (text.match(/\d+/g) || []).length;

  // Rough formula: words + punctuation/2 + numbers
  return Math.ceil(words + punctuation / 2 + numbers);
}

// ===== UTILITY FUNCTIONS =====

function inferRoleFromSymbol(symbol: string): string {
  const symbolLower = symbol.toLowerCase();

  if (symbolLower.match(/^(init|initialize|setup|create)/)) return 'initialization';
  if (symbolLower.match(/(read|query|search|find|get)/)) return 'read operation';
  if (symbolLower.match(/(write|insert|save|update|store)/)) return 'write operation';
  if (symbolLower.match(/(handler|controller|route)/)) return 'request handler';
  if (symbolLower.match(/(middleware|guard|auth)/)) return 'middleware';
  if (symbolLower.match(/(test|spec)/)) return 'test';
  if (symbolLower.match(/(config|env|setting)/)) return 'configuration';
  if (symbolLower.includes('provider')) return 'service provider';

  return 'code symbol';
}

function getRelativePath(absolutePath: string): string {
  const parts = absolutePath.split(/[\/\\]/);
  const srcIndex = parts.findIndex(part => part === 'src');
  if (srcIndex >= 0) {
    return parts.slice(srcIndex).join('/');
  }
  return parts.slice(-2).join('/');
}

// ===== HELPERS FOR LLM BUNDLE =====

async function getOrBuildImportGraph(indices: ProjectContext): Promise<Map<string, string[]>> {
  if (indices.callGraph) {
    // Reuse if present in same shape
    return indices.callGraph as Map<string, string[]>;
  }
  // Reuse indexers import graph which maps files to imports
  try {
    const { buildImportGraph } = await import('./indexers');
    // indexers.buildImportGraph expects FileInfo[]
    return await buildImportGraph(indices.files);
  } catch {
    return new Map<string, string[]>();
  }
}

function unique<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function chooseSnippetWindows(
  file: string,
  contextLines: number
): { start: number; end: number }[] {
  // Without re-parsing, offer a simple window: line 1 to contextLines as a fallback
  // Real implementation could anchor on strongest AST hit per file
  return [{ start: 1, end: Math.max(1, contextLines) }];
}

type RankedForBundle = CandidateSymbol & {
  finalScore?: number;
  score?: number;
  reasons?: string[];
};

function buildLLMBundle(args: {
  query: string;
  topic: Topic;
  ranked: RankedForBundle[];
  files: FileInfo[];
  importGraph: Map<string, string[]>;
  envKeys: string[];
  fingerprint: { languages: string[]; frameworks: string[]; families: string[] };
}): LocalContextOut {
  // Anchor files: top 8 distinct by score
  const rankedByScore = [...args.ranked].sort(
    (a, b) => (b.finalScore ?? b.score ?? 0) - (a.finalScore ?? a.score ?? 0)
  );
  const anchorFiles: { file: string; score: number; reasons: string[]; features: string[] }[] = [];
  const seen = new Set<string>();
  for (const c of rankedByScore) {
    const file = c.file;
    if (seen.has(file)) continue;
    seen.add(file);
    const score = c.finalScore ?? c.score ?? 0;
    const reasons = c.reasons || [];
    const features: string[] = [];
    if (/supabase/i.test(file)) features.push('import:supabase');
    if (/auth/i.test(file)) features.push('path:auth');
    anchorFiles.push({ file, score, reasons, features });
    if (anchorFiles.length >= 8) break;
  }

  // One-hop neighbors via import graph
  const neighborsSet = new Set<string>();
  for (const a of anchorFiles) {
    const rel = toRel(a.file, args.files);
    const n = args.importGraph.get(rel) || [];
    for (const m of n) neighborsSet.add(m);
  }

  const neighbors = Array.from(neighborsSet).slice(0, 12);

  // Suggested excerpts: simple line windows for now
  const suggestedExcerpts = anchorFiles.map(a => ({
    file: a.file,
    ranges: chooseSnippetWindows(a.file, 30),
  }));

  // Env hints: merge detected + common auth vars if topic auth
  const envHintsBase = unique(args.envKeys);
  const authBonus = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'NEXTAUTH_URL', 'JWT_SECRET'];
  const envHints = unique(
    args.topic === 'auth' ? envHintsBase.concat(authBonus) : envHintsBase
  ).slice(0, 12);

  const summaryPlan = [
    'Identify auth providers & clients',
    'Locate middleware/guards',
    'Find token/session handlers',
    'Surface env requirements',
    'Show primary routes invoking auth',
  ];

  const answerFrame = [
    'Where client is created & injected',
    'How requests are authenticated (middleware)',
    'How sessions/tokens are validated/rotated',
    'What env vars are required & where read',
    'Entry points: routes/components that trigger auth',
  ];

  // Simple result-set coverage shaping (frontend/api/backend/db buckets)
  const isUi = (f: string) =>
    /\.(tsx|jsx|vue|svelte)$/i.test(f) || /components|pages|app\//i.test(f);
  const isApi = (f: string) => /api|route\.(ts|js)$/i.test(f) || /router|controller/i.test(f);
  const isBackend = (f: string) => /middleware|service|integration|lib\//i.test(f);
  const isDb = (f: string) => /schema|migrate|db|database|prisma|drizzle/i.test(f);

  const coverageTargets = [
    {
      name: 'frontend',
      match: isUi,
      min: /components|ui|view|page/.test(args.query) ? 4 : 0,
      max: 8,
    },
    { name: 'api', match: isApi, min: 2, max: 6 },
    { name: 'backend', match: isBackend, min: 2, max: 6 },
    { name: 'db', match: isDb, min: 1, max: 4 },
  ];

  const coverage: Record<string, { found: number; requiredMin: number }> = {};
  for (const t of coverageTargets) {
    const found = anchorFiles.filter(a => t.match(a.file)).length;
    coverage[t.name] = { found, requiredMin: t.min };
  }
  const warnings: string[] = [];
  for (const [name, cov] of Object.entries(coverage)) {
    if (cov.found < cov.requiredMin)
      warnings.push(
        `Insufficient ${name} coverage: found ${cov.found}, require >= ${cov.requiredMin}`
      );
  }

  return {
    success: true,
    query: args.query,
    topic: args.topic,
    fingerprint: args.fingerprint,
    anchors: anchorFiles,
    neighbors,
    coverage,
    envHints,
    suggestedExcerpts,
    summaryPlan,
    answerFrame,
    warnings: warnings.length ? warnings : undefined,
    debug: { filesScanned: args.files.length, strategies: ['ast', 'rank', 'one-hop'] },
  };
}

function toRel(absFile: string, files: FileInfo[]): string {
  const found = files.find(f => f.absPath === absFile);
  return found ? found.relPath.replace(/\\/g, '/') : absFile.split(/[\\/]/).slice(-3).join('/');
}

// ===== REPO FINGERPRINTING (framework-agnostic) =====
async function fingerprintRepo(
  files: FileInfo[]
): Promise<{ languages: string[]; frameworks: string[]; families: string[] }> {
  const languages = unique(files.map(f => f.language));
  const frameworks = new Set<string>();
  const families = new Set<string>();

  // Heuristic on filenames to detect frameworks
  const names = files.map(f => f.relPath.toLowerCase());
  if (names.some(n => n.endsWith('package.json'))) frameworks.add('node');
  if (names.some(n => n.endsWith('pyproject.toml') || n.endsWith('requirements.txt')))
    frameworks.add('python');
  if (names.some(n => n.endsWith('go.mod'))) frameworks.add('go');
  if (names.some(n => n.endsWith('cargo.toml'))) frameworks.add('rust');
  if (names.some(n => n.endsWith('pom.xml') || n.endsWith('build.gradle'))) frameworks.add('java');

  // Family detection from path text (lightweight)
  if (names.some(n => /next\//.test(n) || /app\/.*\/route\.(ts|js)/.test(n)))
    families.add('file_router');
  if (names.some(n => /api\//.test(n))) families.add('method_call_router');

  return { languages, frameworks: Array.from(frameworks), families: Array.from(families) };
}

// ===== EXTRA DETECTORS (API / Components / DB) =====
async function gatherApiRouteCandidates(files: FileInfo[]): Promise<CandidateSymbol[]> {
  try {
    const { detectRoutes } = await import('./indexers');
    const routes = await detectRoutes(files);
    return routes.map(
      r =>
        ({
          file: r.file,
          symbol: `${r.method.toUpperCase()} ${r.path}`,
          start: r.line,
          end: r.line,
          kind: 'export',
          score: 0.85,
          reasons: ['api:route'],
          role: 'request handler',
        }) as CandidateSymbol
    );
  } catch {
    return [];
  }
}

async function gatherComponentCandidates(files: FileInfo[]): Promise<CandidateSymbol[]> {
  const results: CandidateSymbol[] = [];
  for (const f of files) {
    const rel = f.relPath.replace(/\\/g, '/');
    if (/\.(tsx|jsx)$/i.test(rel) || /\/components\//i.test(rel)) {
      results.push({
        file: f.absPath,
        symbol: 'ComponentFile',
        start: 1,
        end: 1,
        kind: 'export',
        score: 0.6,
        reasons: ['ui:component:path'],
        role: 'component',
      } as CandidateSymbol);
    }
  }
  return results;
}

async function gatherDbSchemaCandidates(files: FileInfo[]): Promise<CandidateSymbol[]> {
  const results: CandidateSymbol[] = [];
  for (const f of files) {
    const rel = f.relPath.replace(/\\/g, '/').toLowerCase();
    if (
      rel.endsWith('.prisma') ||
      rel.endsWith('.sql') ||
      rel.includes('/db/migrate/') ||
      rel.includes('/migrations/')
    ) {
      results.push({
        file: f.absPath,
        symbol: 'DbSchema',
        start: 1,
        end: 1,
        kind: 'export',
        score: 0.8,
        reasons: ['db:schema:path'],
        role: 'schema',
      } as CandidateSymbol);
    }
  }
  return results;
}

// ===== INTERFACES FOR INTEGRATION =====

export interface ProjectContext {
  files: FileInfo[];
  exports: any[];
  imports: any[];
  routes: any[];
  env: any[];
  systems: any;
  callGraph?: Map<string, string[]>;
}

// Topic-aware file prioritization: apply stoplist and add auth path hint boosts
function prioritizeFilesForTopic(files: FileInfo[], topic: Topic): FileInfo[] {
  const stoplist = STOPLIST_BY_TOPIC[topic] || [];

  // Simple glob matcher similar to astQueryEngine.matchesGlob
  const matchesGlob = (filePath: string, pattern: string) => {
    const posix = filePath.replace(/\\/g, '/');
    const regex = pattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '.')
      .replace(/\//g, '\\/');
    return new RegExp('^' + regex + '$').test(posix);
  };

  const notStopped = files.filter(f => !stoplist.some(glob => matchesGlob(f.relPath, glob)));

  if (topic === 'api') {
    // Frontload Next.js file-router and generic api folders
    const apiHinted: FileInfo[] = [];
    const apiOthers: FileInfo[] = [];
    for (const f of notStopped) {
      const rel = f.relPath.replace(/\\/g, '/');
      if (
        /app\/.*\/route\.(ts|js)$/i.test(rel) ||
        /pages\/api\//i.test(rel) ||
        /\/api\//i.test(rel)
      ) {
        apiHinted.push(f);
      } else {
        apiOthers.push(f);
      }
    }
    return [...apiHinted, ...apiOthers];
  }

  if (topic === 'components') {
    // Frontload common frontend component locations
    const uiHinted: FileInfo[] = [];
    const uiOthers: FileInfo[] = [];
    for (const f of notStopped) {
      const rel = f.relPath.replace(/\\/g, '/');
      if (
        /\.(tsx|jsx)$/i.test(rel) ||
        /\/app\/components\//i.test(rel) ||
        /\/components\//i.test(rel) ||
        /\/pages\//i.test(rel)
      ) {
        uiHinted.push(f);
      } else {
        uiOthers.push(f);
      }
    }
    return [...uiHinted, ...uiOthers];
  }

  if (topic !== 'auth') return notStopped;

  // For auth topic, boost auth-hinted files to the front
  const hinted: FileInfo[] = [];
  const others: FileInfo[] = [];
  for (const f of notStopped) {
    const rel = f.relPath.replace(/\\/g, '/');
    if (AUTH_FILE_HINTS.some(glob => matchesGlob(rel, glob)) || /auth/i.test(rel)) {
      hinted.push(f);
    } else {
      others.push(f);
    }
  }
  return [...hinted, ...others];
}
