/**
 * @fileOverview: Deterministic scoring system for project hints without embeddings
 * @module: ProjectScoring
 * @keyFunctions:
 *   - calculateScore(): Main scoring function combining all heuristics
 *   - pathPrior(): Path-based importance scoring
 *   - surfaceBoost(): Public surface visibility boost
 *   - degreeBoost(): Import graph centrality scoring
 *   - recencyBoost(): Git recency factor
 *   - keywordScore(): Query-aware relevance scoring
 * @context: Provides ranked hints using static analysis and deterministic heuristics
 */

import { ExportItem, RouteItem, ToolItem, GitInfo } from './indexers';

export interface ScoredHint {
  file: string;
  symbol?: string;
  line?: number;
  role: string;
  why: string[];
  confidence: number;
  rawScore: number;
}

export interface ScoreComponents {
  pathPrior: number;
  surfaceBoost: number;
  degreeBoost: number;
  recencyBoost: number;
  keywordScore: number;
}

export interface ScoreContext {
  exports: ExportItem[];
  routes: RouteItem[];
  tools: ToolItem[];
  importGraph: Map<string, string[]>;
  gitMap: Record<string, string | undefined>;
  queryTerms: string[];
}

/**
 * Calculate overall score for a file/symbol with component breakdown
 */
export function calculateScore(
  item: ExportItem | RouteItem | ToolItem,
  context: ScoreContext
): { score: number; components: ScoreComponents; why: string[] } {
  const file = item.file;
  const name = 'name' in item ? item.name : 'path' in item ? item.path : '';
  const kind = 'kind' in item ? item.kind : 'method' in item ? 'route' : 'tool';

  const components: ScoreComponents = {
    pathPrior: pathPrior(file),
    surfaceBoost: surfaceBoost(kind),
    degreeBoost: degreeBoost(file, context.importGraph),
    recencyBoost: recencyBoost(context.gitMap[file]),
    keywordScore: keywordScore(name, file, context.queryTerms),
  };

  const score =
    components.pathPrior *
    components.surfaceBoost *
    components.degreeBoost *
    components.recencyBoost *
    components.keywordScore;

  const why = buildWhyArray(components, name, file, context);

  return { score, components, why };
}

/**
 * Path-based importance scoring
 * Prioritizes core directories and important file patterns
 */
export function pathPrior(file: string): number {
  const normalizedFile = file.toLowerCase().replace(/\\/g, '/');

  // Core directories get highest priority
  if (/src\/(local|core|tools)\//.test(normalizedFile)) return 1.3;
  if (/src\/api\//.test(normalizedFile)) return 1.25;
  if (/src\/services?\//.test(normalizedFile)) return 1.2;
  if (/src\/components?\//.test(normalizedFile)) return 1.15;

  // Important file patterns
  if (/(index|main|app|server)\.(ts|js)$/.test(normalizedFile)) return 1.2;
  if (/config\.|\.config\.|settings\./.test(normalizedFile)) return 1.1;

  // Standard src/ gets moderate boost
  if (/^src\//.test(normalizedFile)) return 1.1;

  // Root level files get slight boost
  if (!normalizedFile.includes('/')) return 1.05;

  // Test files get lower priority
  if (
    /(test|spec|__tests__)\//.test(normalizedFile) ||
    /\.(test|spec)\.(ts|js)$/.test(normalizedFile)
  ) {
    return 0.8;
  }

  // Node modules and build files get lowest priority
  if (/(node_modules|dist|build|lib)\//.test(normalizedFile)) return 0.5;

  return 1.0;
}

/**
 * Surface visibility boost for public APIs
 * Prioritizes functions and classes over constants and types
 */
export function surfaceBoost(kind: string): number {
  switch (kind) {
    case 'function':
      return 1.2;
    case 'class':
      return 1.15;
    case 'route':
      return 1.25; // Routes are high-value public surfaces
    case 'tool':
      return 1.3; // Tools are the most actionable surfaces
    case 'interface':
      return 1.05;
    case 'type':
      return 1.0;
    case 'const':
      return 0.95;
    default:
      return 1.0;
  }
}

/**
 * Import graph centrality boost
 * Files with more connections are more important
 */
export function degreeBoost(file: string, importGraph: Map<string, string[]>): number {
  // Calculate both outgoing (dependencies) and incoming (dependents) connections
  const outgoingCount = importGraph.get(file)?.length || 0;

  // Count incoming connections (files that import this file)
  let incomingCount = 0;
  for (const [, imports] of importGraph) {
    if (imports.includes(file)) {
      incomingCount++;
    }
  }

  const totalConnections = outgoingCount + incomingCount * 1.5; // Incoming connections are more valuable

  // Logarithmic scaling to prevent excessive boost
  const boost = 1 + Math.min(0.4, Math.log(totalConnections + 1) * 0.1);

  return boost;
}

/**
 * Git recency boost for recently modified files
 * More recent changes indicate active development
 */
export function recencyBoost(lastCommitDate?: string): number {
  if (!lastCommitDate) return 1.0;

  try {
    const commitTime = new Date(lastCommitDate).getTime();
    const now = Date.now();
    const daysSinceCommit = (now - commitTime) / (1000 * 60 * 60 * 24);

    if (daysSinceCommit < 7) return 1.2; // Last week
    if (daysSinceCommit < 30) return 1.15; // Last month
    if (daysSinceCommit < 90) return 1.1; // Last quarter
    if (daysSinceCommit < 180) return 1.05; // Last 6 months

    return 1.0; // Older changes don't get penalty
  } catch {
    return 1.0;
  }
}

/**
 * Query-aware keyword matching score
 * Matches against symbol names, file paths, and domain terms
 */
export function keywordScore(name: string, file: string, queryTerms: string[]): number {
  if (queryTerms.length === 0) return 1.0;

  const searchText = `${name} ${file}`.toLowerCase();
  const domainAliases = buildDomainAliases();

  let score = 1.0;
  let matchCount = 0;

  for (const term of queryTerms) {
    const normalizedTerm = term.toLowerCase();

    // Exact symbol name match (highest value)
    if (name.toLowerCase() === normalizedTerm) {
      score *= 2.0;
      matchCount++;
      continue;
    }

    // Symbol name contains term
    if (name.toLowerCase().includes(normalizedTerm)) {
      score *= 1.5;
      matchCount++;
      continue;
    }

    // File path contains term
    if (file.toLowerCase().includes(normalizedTerm)) {
      score *= 1.3;
      matchCount++;
      continue;
    }

    // Domain alias matching
    const aliases = domainAliases[normalizedTerm] || [];
    for (const alias of aliases) {
      if (searchText.includes(alias)) {
        score *= 1.2;
        matchCount++;
        break;
      }
    }

    // Fuzzy matching for common patterns
    if (matchesFuzzyPattern(searchText, normalizedTerm)) {
      score *= 1.1;
      matchCount++;
    }
  }

  // Bonus for matching multiple terms
  if (matchCount > 1) {
    score *= 1.1;
  }

  return score;
}

/**
 * Generate actionable hints with ranking
 */
export function generateRankedHints(context: ScoreContext, maxHints: number = 7): ScoredHint[] {
  const allItems: Array<ExportItem | RouteItem | ToolItem> = [
    ...context.exports,
    ...context.routes,
    ...context.tools,
  ];

  const scoredItems = allItems.map(item => {
    const { score, components, why } = calculateScore(item, context);

    return {
      file: item.file,
      symbol: 'name' in item ? item.name : undefined,
      line: item.line,
      role: inferRole(item),
      why,
      confidence: normalizeConfidence(score),
      rawScore: score,
    };
  });

  return scoredItems.sort((a, b) => b.rawScore - a.rawScore).slice(0, maxHints);
}

/**
 * Infer the role/purpose of an item for display
 */
function inferRole(item: ExportItem | RouteItem | ToolItem): string {
  if ('method' in item) {
    return `${item.method.toUpperCase()} endpoint`;
  }

  if ('kind' in item) {
    const name = item.name.toLowerCase();

    if (/init|initialize|bootstrap|setup/.test(name)) return 'initializer';
    if (/search|query|find|filter/.test(name)) return 'search/query';
    if (/provider|pipeline|factory/.test(name)) return 'provider/factory';
    if (/store|save|insert|upsert|write/.test(name)) return 'write/storage';
    if (/get|read|fetch|load|retrieve/.test(name)) return 'read/access';
    if (/validate|verify|check|test/.test(name)) return 'validation';
    if (/config|setting|option/.test(name)) return 'configuration';
    if (/handle|process|execute/.test(name)) return 'handler/processor';
    if (/parse|transform|convert|format/.test(name)) return 'transformation';
    if (/connect|disconnect|close|open/.test(name)) return 'connection';

    switch (item.kind) {
      case 'function':
        return 'exported function';
      case 'class':
        return 'exported class';
      case 'interface':
        return 'type definition';
      case 'type':
        return 'type alias';
      case 'const':
        return 'exported constant';
      default:
        return 'exported API';
    }
  }

  // Tool item
  return 'MCP tool';
}

/**
 * Build explanation array for why a hint was ranked highly
 */
function buildWhyArray(
  components: ScoreComponents,
  name: string,
  file: string,
  context: ScoreContext
): string[] {
  const why: string[] = [];

  // Path importance
  if (components.pathPrior > 1.1) {
    why.push('high-priority directory');
  }

  // Surface visibility
  if (components.surfaceBoost > 1.1) {
    why.push('public API surface');
  }

  // Import centrality
  if (components.degreeBoost > 1.2) {
    const connections = context.importGraph.get(file)?.length || 0;
    if (connections > 0) {
      why.push(`${connections} import connections`);
    } else {
      why.push('central to import graph');
    }
  }

  // Recency
  if (components.recencyBoost > 1.05) {
    why.push('recently modified');
  }

  // Keyword matching
  if (components.keywordScore > 1.1) {
    if (context.queryTerms.length > 0) {
      const matchedTerms = context.queryTerms.filter(
        term =>
          name.toLowerCase().includes(term.toLowerCase()) ||
          file.toLowerCase().includes(term.toLowerCase())
      );
      if (matchedTerms.length > 0) {
        why.push(`matches: ${matchedTerms.join(', ')}`);
      } else {
        why.push('keyword relevance');
      }
    }
  }

  // Fallback if no specific reasons
  if (why.length === 0) {
    why.push('exported symbol');
  }

  return why;
}

/**
 * Normalize raw scores to confidence values between 0.5 and 0.98
 */
function normalizeConfidence(rawScore: number): number {
  // Raw scores typically range from 0.5 to 4.0+
  // Map to confidence range [0.5, 0.98]
  const minScore = 0.5;
  const maxScore = 3.0;
  const minConfidence = 0.5;
  const maxConfidence = 0.98;

  const clampedScore = Math.max(minScore, Math.min(maxScore, rawScore));
  const normalized = (clampedScore - minScore) / (maxScore - minScore);
  const confidence = minConfidence + normalized * (maxConfidence - minConfidence);

  return Math.round(confidence * 100) / 100; // Round to 2 decimal places
}

/**
 * Build domain-specific keyword aliases for better matching
 */
function buildDomainAliases(): Record<string, string[]> {
  return {
    // Database & Storage
    database: ['db', 'storage', 'store', 'repo', 'repository', 'persist', 'save', 'query'],
    db: ['database', 'storage', 'sqlite', 'postgres', 'mysql', 'mongo'],
    storage: ['store', 'persist', 'save', 'cache', 'memory', 'disk'],

    // Search & Retrieval
    search: ['query', 'find', 'filter', 'lookup', 'retrieve', 'get', 'fetch'],
    query: ['search', 'find', 'filter', 'select', 'where'],
    index: ['search', 'catalog', 'directory', 'registry'],

    // Authentication & Security
    auth: ['login', 'token', 'jwt', 'session', 'password', 'credential', 'oauth'],
    login: ['auth', 'signin', 'authenticate', 'credential'],
    token: ['jwt', 'auth', 'bearer', 'session'],

    // API & Network
    api: ['endpoint', 'route', 'handler', 'controller', 'service', 'request'],
    endpoint: ['api', 'route', 'url', 'path', 'handler'],
    route: ['endpoint', 'path', 'url', 'handler', 'controller'],

    // Processing & Logic
    process: ['handle', 'execute', 'run', 'perform', 'action'],
    handle: ['process', 'execute', 'manage', 'deal', 'action'],
    transform: ['convert', 'parse', 'format', 'change', 'modify'],

    // Files & Content
    file: ['document', 'content', 'upload', 'download', 'attachment'],
    upload: ['file', 'attach', 'send', 'post', 'submit'],
    download: ['file', 'get', 'fetch', 'retrieve', 'export'],

    // User & Account
    user: ['account', 'profile', 'member', 'person', 'identity'],
    account: ['user', 'profile', 'member', 'credential'],
    profile: ['user', 'account', 'info', 'details'],

    // Configuration & Settings
    config: ['setting', 'option', 'preference', 'parameter', 'env'],
    setting: ['config', 'option', 'preference', 'parameter'],
    env: ['environment', 'config', 'setting', 'variable'],
  };
}

/**
 * Fuzzy pattern matching for flexible search
 */
function matchesFuzzyPattern(text: string, pattern: string): boolean {
  if (pattern.length < 3) return false;

  // Check for partial word matches
  const words = text.split(/[\s\-_./\\]/);
  return words.some(word => word.includes(pattern) || pattern.includes(word.substring(0, 3)));
}
