/**
 * @fileOverview: Enhanced hint builder with capabilities mapping and risk assessment
 * @module: EnhancedHints
 * @keyFunctions:
 *   - buildEnhancedProjectSummary(): Create rich project analysis with actionable hints
 *   - buildCapabilitiesMap(): Infer domain capabilities from code surfaces
 *   - assessRisks(): Identify potential project risks and issues
 *   - generateNextActions(): Propose concrete next steps for agents
 *   - generateAnswerDraft(): Deterministic query responses
 * @context: Transforms raw indexing data into actionable intelligence for AI agents
 */

import { FileInfo } from '../../core/compactor/fileDiscovery';
import {
  ExportItem,
  RouteItem,
  ToolItem,
  EnvItem,
  DbInfo,
  GitInfo,
  buildExportIndex,
  buildImportGraph,
  detectRoutes,
  detectMcpTools,
  detectEnvKeys,
  detectDb,
  detectGitInfo,
} from './indexers';
import { generateRankedHints, ScoredHint, ScoreContext } from './scoring';
import { logger } from '../../utils/logger';
import { toPosix } from './utils/pathUtils';
import { formatSignature } from './utils/publicApi';
import * as path from 'path';

export interface EnhancedProjectSummary {
  summary: ProjectSummary;
  surfaces: PublicSurfaces;
  systems: SystemsDetection;
  capabilities: CapabilitiesMap;
  risks: RiskAssessment;
  hints: ScoredHint[];
  next: NextActions;
}

export interface ProjectSummary {
  languages: string[];
  files: number;
  entryPoints: string[];
  codebaseSize: string;
}

export interface PublicSurfaces {
  exports: ExportSummary[];
  routes: RouteSummary[];
  mcpTools: ToolSummary[];
  envKeys: string[];
}

export interface SystemsDetection {
  db?: {
    engine: string;
    initializers: string[];
    confidence: number;
  };
  provider?: {
    initializer: string;
    confidence: number;
  };
  architecture: string[];
}

export interface CapabilitiesMap {
  domains: string[];
  operations: string[];
  integrations: string[];
}

export interface RiskAssessment {
  flags: RiskFlag[];
  score: number; // 0-100, lower is better
  recommendations: string[];
}

export interface NextActions {
  mode: 'code_lookup' | 'project_research' | 'implementation_ready';
  openFiles: string[];
  checks: string[];
  focus: string;
}

// Simplified interfaces for surfaces
export interface ExportSummary {
  name: string;
  kind: string;
  file: string;
  line: number;
  role?: string;
}

export interface RouteSummary {
  method: string;
  path: string;
  file: string;
  line: number;
}

export interface ToolSummary {
  name: string;
  file: string;
  line: number;
}

export interface RiskFlag {
  type: 'security' | 'performance' | 'maintenance' | 'config';
  severity: 'low' | 'medium' | 'high';
  message: string;
  file?: string;
}

/**
 * Build enhanced project summary with all intelligence layers
 */
export async function buildEnhancedProjectSummary(
  projectPath: string,
  files: FileInfo[],
  query?: string,
  maxHints: number = 7
): Promise<EnhancedProjectSummary> {
  logger.info('Building enhanced project summary', {
    projectPath,
    fileCount: files.length,
    hasQuery: !!query,
  });

  try {
    // Build all indices in parallel for performance
    const [exports, importGraph, routes, mcpTools, envKeys, dbInfo, gitInfo] = await Promise.all([
      buildExportIndex(files),
      buildImportGraph(files),
      detectRoutes(files),
      detectMcpTools(files),
      detectEnvKeys(files),
      detectDb(files),
      detectGitInfo(projectPath),
    ]);

    // Build git commit map for recency scoring
    const gitMap: Record<string, string | undefined> = {};
    if (gitInfo.lastCommitDate) {
      // For now, assume all files have the same last commit date
      // In a real implementation, you'd get per-file git info
      files.forEach(file => {
        gitMap[file.relPath] = gitInfo.lastCommitDate;
      });
    }

    // Prepare scoring context
    const queryTerms = query ? query.split(/\W+/).filter(term => term.length > 2) : [];
    const scoreContext: ScoreContext = {
      exports,
      routes,
      tools: mcpTools,
      importGraph,
      gitMap,
      queryTerms,
    };

    // Generate ranked hints
    const hints = generateRankedHints(scoreContext, maxHints);

    // Build all analysis components
    const summary = buildProjectSummary(files);
    const surfaces = buildPublicSurfaces(exports, routes, mcpTools, envKeys);
    const systems = buildSystemsDetection(dbInfo, exports, files);
    const capabilities = buildCapabilitiesMap(exports, routes, mcpTools, envKeys);
    const risks = assessRisks(files, envKeys, exports, mcpTools);
    const next = generateNextActions(hints, query, capabilities, risks);

    const result: EnhancedProjectSummary = {
      summary,
      surfaces,
      systems,
      capabilities,
      risks,
      hints,
      next,
    };

    logger.info('Enhanced project summary built', {
      hintsCount: hints.length,
      capabilitiesCount: capabilities.domains.length,
      risksCount: risks.flags.length,
      nextMode: next.mode,
    });

    return result;
  } catch (error) {
    logger.error('Failed to build enhanced project summary', {
      error: (error as Error).message,
      projectPath,
    });
    throw error;
  }
}

/**
 * Build basic project summary
 */
function buildProjectSummary(files: FileInfo[]): ProjectSummary {
  const languageCounts = files.reduce(
    (acc, file) => {
      acc[file.language] = (acc[file.language] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  const languages = Object.entries(languageCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([lang]) => lang);

  const entryPoints = files
    .filter(file => /(index|main|app|server)\.(ts|js|py)$/i.test(file.relPath))
    .map(file => file.relPath)
    .slice(0, 5);

  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  const codebaseSize = formatFileSize(totalSize);

  return {
    languages,
    files: files.length,
    entryPoints,
    codebaseSize,
  };
}

/**
 * Build public surfaces summary
 * Fix for critique item #2: Exclude HTTP method exports from Public API Surfaces
 */
function buildPublicSurfaces(
  exports: ExportItem[],
  routes: RouteItem[],
  mcpTools: ToolItem[],
  envKeys: EnvItem[]
): PublicSurfaces {
  // Filter out HTTP method exports that are actually route handlers
  const filteredExports = filterRouteExportsFromPublicAPI(exports, routes);

  return {
    exports: filteredExports.slice(0, 15).map(exp => ({
      name: exp.name,
      kind: exp.kind,
      file: toPosix(exp.file), // Ensure POSIX paths in JSON
      line: exp.line,
      role: exp.role || inferExportRole(exp.name, exp.kind),
      signature: exp.signature || formatSignature(exp),
    })),
    routes: routes.slice(0, 10).map(route => ({
      method: route.method,
      path: route.path, // Already POSIX from indexers
      file: toPosix(route.file),
      line: route.line,
    })),
    mcpTools: mcpTools.slice(0, 10).map(tool => ({
      name: tool.name,
      file: toPosix(tool.file),
      line: tool.line,
    })),
    envKeys: [...new Set(envKeys.map(env => env.key))].slice(0, 15),
  };
}

/**
 * Build systems detection from database and provider analysis
 */
function buildSystemsDetection(
  dbInfo: DbInfo,
  exports: ExportItem[],
  files: FileInfo[]
): SystemsDetection {
  const systems: SystemsDetection = {
    architecture: [],
  };

  // Database system with evidence-based confidence
  if (dbInfo.engine && dbInfo.engine !== 'unknown') {
    systems.db = {
      engine: dbInfo.engine,
      initializers: dbInfo.initializers.map(init => `${toPosix(init.file)}:${init.symbol}`),
      confidence: dbInfo.confidence || 0.6, // Use evidence-based confidence or fallback
    };
  }

  // Provider/Pipeline detection
  const providerExports = exports.filter(
    exp =>
      /provider|pipeline|factory|manager|service/i.test(exp.name) &&
      /init|create|setup|build/.test(exp.name.toLowerCase())
  );

  if (providerExports.length > 0) {
    const mainProvider = providerExports[0];
    systems.provider = {
      initializer: `${toPosix(mainProvider.file)}:${mainProvider.name}`,
      confidence: 0.8,
    };
  }

  // Architecture patterns
  const patterns = new Set<string>();

  // Framework detection
  if (files.some(f => f.relPath.includes('package.json'))) {
    patterns.add('nodejs');
  }
  if (exports.some(exp => /react|component|jsx/i.test(exp.name))) {
    patterns.add('react');
  }
  if (exports.some(exp => /express|fastify|koa/i.test(exp.name))) {
    patterns.add('web-framework');
  }
  if (exports.some(exp => /mcp|tool|handler/i.test(exp.name))) {
    patterns.add('mcp-server');
  }
  if (dbInfo.engine && dbInfo.engine !== 'unknown') {
    patterns.add('database-driven');
  }

  systems.architecture = Array.from(patterns);
  return systems;
}

/**
 * Build capabilities map from code analysis
 */
function buildCapabilitiesMap(
  exports: ExportItem[],
  routes: RouteItem[],
  mcpTools: ToolItem[],
  envKeys: EnvItem[]
): CapabilitiesMap {
  const domains = new Set<string>();
  const operations = new Set<string>();
  const integrations = new Set<string>();

  // Verifier #5: Filter exports with noise reduction
  const filteredExports = filterNoisySymbols(exports);

  // Analyze filtered exports for domain capabilities
  for (const exp of filteredExports) {
    const name = exp.name.toLowerCase();

    // Domain detection
    if (/auth|login|token|session/.test(name)) domains.add('authentication');
    if (/search|index|query|find/.test(name)) domains.add('search');
    if (/embed|vector|semantic/.test(name)) domains.add('embeddings');
    if (/db|database|store|persist/.test(name)) domains.add('storage');
    if (/file|upload|download|blob/.test(name)) domains.add('files');
    if (/api|endpoint|route|handler/.test(name)) domains.add('api');
    if (/user|account|profile/.test(name)) domains.add('user-management');
    if (/config|setting|env/.test(name)) domains.add('configuration');
    if (/tool|command|action/.test(name)) domains.add('tools');
    if (/cache|memory|redis/.test(name)) domains.add('caching');

    // Operation detection
    if (/create|add|insert|save|store/.test(name)) operations.add('create');
    if (/get|read|fetch|load|retrieve/.test(name)) operations.add('read');
    if (/update|modify|edit|change/.test(name)) operations.add('update');
    if (/delete|remove|destroy/.test(name)) operations.add('delete');
    if (/search|query|find|filter/.test(name)) operations.add('search');
    if (/validate|verify|check/.test(name)) operations.add('validation');
    if (/transform|convert|parse|format/.test(name)) operations.add('transformation');
    if (/sync|replicate|backup/.test(name)) operations.add('synchronization');
  }

  // Analyze routes for API capabilities
  for (const route of routes) {
    operations.add(route.method.toLowerCase());

    const pathLower = route.path.toLowerCase();
    if (/\/api\//.test(pathLower)) domains.add('api');
    if (/\/auth\//.test(pathLower)) domains.add('authentication');
    if (/\/user/.test(pathLower)) domains.add('user-management');
    if (/\/search/.test(pathLower)) domains.add('search');
    if (/\/file|\/upload/.test(pathLower)) domains.add('files');
  }

  // Analyze MCP tools for capabilities
  for (const tool of mcpTools) {
    domains.add('mcp-tools');
    const toolName = tool.name.toLowerCase();

    if (/search|query|find/.test(toolName)) domains.add('search');
    if (/context|hint|project/.test(toolName)) domains.add('project-analysis');
    if (/file|directory/.test(toolName)) domains.add('file-system');
  }

  // Analyze environment keys for integrations
  for (const env of envKeys) {
    const key = env.key.toLowerCase();

    if (/openai|anthropic|claude/.test(key)) integrations.add('ai-services');
    if (/supabase|firebase/.test(key)) integrations.add('backend-as-service');
    if (/postgres|mysql|mongo/.test(key)) integrations.add('database');
    if (/redis|cache/.test(key)) integrations.add('caching');
    if (/stripe|payment/.test(key)) integrations.add('payments');
    if (/aws|azure|gcp|s3/.test(key)) integrations.add('cloud-services');
    if (/smtp|email|sendgrid/.test(key)) integrations.add('email-services');
    if (/github|gitlab|git/.test(key)) integrations.add('version-control');
  }

  return {
    domains: Array.from(domains).slice(0, 10),
    operations: Array.from(operations).slice(0, 10),
    integrations: Array.from(integrations).slice(0, 8),
  };
}

/**
 * Assess project risks and generate recommendations
 */
function assessRisks(
  files: FileInfo[],
  envKeys: EnvItem[],
  exports: ExportItem[],
  mcpTools: ToolItem[]
): RiskAssessment {
  const flags: RiskFlag[] = [];
  let riskScore = 0;

  // Security risks - Smart .env handling for MCP servers
  // Note: MCP servers typically configure environment variables in mcp.json rather than .env files
  // since MCP clients (like Claude Desktop) pass env vars when launching the server

  // Improved env.example detection - scan for nested env.example files
  const hasEnvExample = files.some(f => {
    const relPath = f.relPath.replace(/\\/g, '/');
    // Check for exact .env.example files at any nesting level
    return (
      relPath.endsWith('.env.example') ||
      relPath.endsWith('/.env.example') ||
      relPath.includes('/env.example') ||
      relPath.includes('/.env.example')
    );
  });

  const hasEnvFile = files.some(f => {
    const relPath = f.relPath.replace(/\\/g, '/');
    // Check for .env files but exclude .env.example files
    return (
      relPath.includes('.env') &&
      !relPath.includes('.env.example') &&
      !relPath.endsWith('.env.example') &&
      !relPath.includes('/env.example')
    );
  });

  const hasMcpConfig = files.some(f => {
    const relPath = f.relPath.replace(/\\/g, '/');
    return (
      relPath.includes('mcp.json') ||
      relPath.includes('.mcp.json') ||
      relPath.includes('.mcp') ||
      relPath.endsWith('mcp.json') ||
      relPath.endsWith('.mcp.json')
    );
  });

  // Primary indicator: presence of MCP tools (more reliable than config file detection)
  // Secondary indicator: MCP config file detected in analyzed files
  const isMcpServer = mcpTools.length > 0 || hasMcpConfig;

  // For regular projects, missing .env.example is a documentation issue
  // For MCP servers, env vars are configured in the client's mcp.json, so .env.example is optional
  if (envKeys.length > 0 && !hasEnvExample && !isMcpServer) {
    flags.push({
      type: 'security',
      severity: 'medium',
      message: 'Missing .env.example file - environment variables are not documented',
      file: 'ENV-001',
    });
    riskScore += 15;
  } else if (envKeys.length > 0 && !hasEnvExample && isMcpServer && !hasMcpConfig) {
    // MCP server without detectable mcp.json config - suggest documenting env vars
    flags.push({
      type: 'config',
      severity: 'low',
      message:
        'MCP server: Consider documenting environment variables in README or mcp.json examples',
      file: 'MCP-ENV-001',
    });
    riskScore += 5;
  }
  // Note: If isMcpServer && (hasMcpConfig || no additional check needed), no env warning is generated

  if (hasEnvFile) {
    flags.push({
      type: 'security',
      severity: 'low',
      message: ".env file found in repository - ensure it's in .gitignore",
      file: 'ENV-001',
    });
    riskScore += 5;
  }

  // Verifier #8: Enhanced risk rules

  // ENV-002: Server-only env keys referenced in UI/web code
  const webFiles = files.filter(f => {
    const posixPath = toPosix(f.relPath);
    return (
      posixPath.includes('/web/') ||
      posixPath.includes('/components/') ||
      (posixPath.includes('/pages/') && !posixPath.includes('/pages/api/'))
    );
  });

  const serverOnlyEnvKeys = envKeys.filter(
    env =>
      !env.key.startsWith('NEXT_PUBLIC_') &&
      !env.key.startsWith('PUBLIC_') &&
      !env.key.startsWith('VITE_')
  );

  const webEnvLeaks = webFiles.filter(webFile => {
    const webFilePosix = toPosix(webFile.relPath);
    return serverOnlyEnvKeys.some(env => toPosix(env.file) === webFilePosix);
  });

  if (webEnvLeaks.length > 0) {
    flags.push({
      type: 'security',
      severity: 'high',
      message: `Server-only environment variables referenced in client code - potential leak risk`,
      file: toPosix(webEnvLeaks[0].relPath),
    });
    riskScore += 25;
  }

  // API-AUTH-001: API route without auth guard
  const apiRoutes = files.filter(f => {
    const posixPath = toPosix(f.relPath);
    return posixPath.includes('/api/') || posixPath.match(/app\/.*\/route\.(ts|js)$/);
  });

  const authGuardFiles = files.filter(f => /auth|middleware|guard|verify/i.test(f.relPath));

  const hasAuthSystem =
    authGuardFiles.length > 0 ||
    exports.some(exp => /auth|verify|middleware|guard/i.test(exp.name));

  if (apiRoutes.length > 0 && !hasAuthSystem) {
    flags.push({
      type: 'security',
      severity: 'medium',
      message: `${apiRoutes.length} API routes detected without apparent authentication system`,
      file: toPosix(apiRoutes[0].relPath),
    });
    riskScore += 20;
  }

  // MCP-002: MCP tool handlers without input validation (only fires when MCP tools exist)
  const actualMcpToolsCount = mcpTools.length;

  if (actualMcpToolsCount > 0) {
    const mcpToolFiles = files.filter(f => {
      const posixPath = toPosix(f.relPath);
      return (
        /tool|handler|mcp/i.test(posixPath) &&
        !posixPath.includes('/__tests__/') &&
        !posixPath.endsWith('.tsx') && // Exclude UI files
        !posixPath.includes('/components/')
      ); // Exclude components
    });

    const hasValidationLibs = exports.some(exp => /zod|joi|yup|ajv|schema/i.test(exp.name));

    if (mcpToolFiles.length > 0 && !hasValidationLibs) {
      flags.push({
        type: 'security',
        severity: 'medium',
        message: `MCP tool handlers detected without input validation library (${actualMcpToolsCount} tools found)`,
        file: toPosix(mcpToolFiles[0].relPath),
      });
      riskScore += 15;
    }
  } else {
    // Skip MCP-002 if no MCP tools detected
  }

  // BUILD-001: Build output directories tracked and included
  const buildArtifacts = files.filter(f => {
    const posixPath = toPosix(f.relPath).toLowerCase();
    return (
      posixPath.includes('/dist/') ||
      posixPath.includes('/build/') ||
      posixPath.includes('/.next/') ||
      posixPath.includes('/out/')
    );
  });

  if (buildArtifacts.length > 0) {
    flags.push({
      type: 'maintenance',
      severity: 'low',
      message: `${buildArtifacts.length} build artifacts found in analysis - may inflate signals`,
      file: toPosix(buildArtifacts[0].relPath),
    });
    riskScore += 10;
  }

  // Performance risks
  const oversizedFiles = files.filter(f => f.size > 100000); // 100KB+
  if (oversizedFiles.length > 0) {
    flags.push({
      type: 'performance',
      severity: 'low',
      message: `${oversizedFiles.length} large files found (>100KB) - may impact context loading`,
      file: toPosix(oversizedFiles[0].relPath),
    });
    riskScore += 10;
  }

  // Maintenance risks
  const hasTests = files.some(f => /(test|spec)/i.test(f.relPath));
  if (!hasTests && exports.length > 20) {
    flags.push({
      type: 'maintenance',
      severity: 'medium',
      message: 'No test files detected in project with significant codebase',
    });
    riskScore += 20;
  }

  // Configuration risks
  const hasPackageJson = files.some(f => f.relPath.includes('package.json'));
  const hasTsConfig = files.some(f => f.relPath.includes('tsconfig.json'));

  if (files.some(f => f.language === 'typescript') && !hasTsConfig) {
    flags.push({
      type: 'config',
      severity: 'medium',
      message: 'TypeScript files found but no tsconfig.json detected',
    });
    riskScore += 15;
  }

  const recommendations = generateRiskRecommendations(flags);

  return {
    flags,
    score: Math.min(100, riskScore),
    recommendations,
  };
}

/**
 * Generate concrete next actions for agents
 */
function generateNextActions(
  hints: ScoredHint[],
  query: string | undefined,
  capabilities: CapabilitiesMap,
  risks: RiskAssessment
): NextActions {
  const openFiles: string[] = [];
  const checks: string[] = [];
  let focus = 'project exploration';
  let mode: NextActions['mode'] = 'project_research';

  // Determine mode based on query and hints
  if (query) {
    const queryLower = query.toLowerCase();

    if (/implement|add|create|build/.test(queryLower)) {
      mode = 'implementation_ready';
      focus = 'feature implementation';
    } else if (/debug|fix|error|issue/.test(queryLower)) {
      mode = 'code_lookup';
      focus = 'debugging and analysis';
    } else if (/how|what|where|understand|explain/.test(queryLower)) {
      mode = 'project_research';
      focus = 'code understanding';
    }
  }

  // Build file list from top hints
  for (const hint of hints.slice(0, 3)) {
    if (hint.line) {
      const lineRange = Math.max(1, hint.line - 35) + '-' + (hint.line + 35);
      openFiles.push(`${hint.file}:${lineRange}`);
    } else {
      openFiles.push(hint.file);
    }
  }

  // Add checks based on capabilities and query
  if (capabilities.domains.includes('storage') || capabilities.domains.includes('database')) {
    checks.push('rg -n "database|connect|init" src -m 10');
  }

  if (capabilities.domains.includes('api') || capabilities.domains.includes('mcp-tools')) {
    checks.push('rg --files src | rg -n "(route|handler|tool)" -m 10');
  }

  if (query && /test/i.test(query)) {
    checks.push('rg --files . | rg -n "(test|spec)" -m 10');
  }

  // Risk-based checks
  if (risks.score > 30) {
    checks.push('rg --files . | rg -n "^\\.env" -m 10');
  }

  return {
    mode,
    openFiles: openFiles.slice(0, 6),
    checks: checks.slice(0, 4),
    focus,
  };
}

/**
 * Generate deterministic answer draft for queries
 */
export function generateAnswerDraft(
  summary: EnhancedProjectSummary,
  query?: string
): string | undefined {
  if (!query) return undefined;

  const queryLower = query.toLowerCase();
  const { systems, capabilities, hints } = summary;

  // Database queries
  if (/database|db|storage|persist/.test(queryLower)) {
    if (systems.db) {
      const topDbHints = hints
        .filter(
          h =>
            h.role.includes('storage') ||
            h.role.includes('initializer') ||
            h.file.includes('database') ||
            h.file.includes('storage')
        )
        .slice(0, 2);

      return (
        `This project uses ${systems.db.engine} for data storage. ` +
        `Key database components: ${topDbHints.map(h => `${h.symbol} in ${path.basename(h.file)}`).join(', ')}. ` +
        `Database initialization handled by: ${systems.db.initializers.join(', ')}.`
      );
    }
  }

  // Search queries
  if (/search|query|find/.test(queryLower) && capabilities.domains.includes('search')) {
    const searchHints = hints
      .filter(
        h =>
          h.role.includes('search') ||
          h.symbol?.toLowerCase().includes('search') ||
          h.symbol?.toLowerCase().includes('query')
      )
      .slice(0, 2);

    if (searchHints.length > 0) {
      return (
        `Search functionality is implemented through: ${searchHints.map(h => h.symbol).join(', ')}. ` +
        `Primary search components located in: ${searchHints.map(h => path.basename(h.file)).join(', ')}.`
      );
    }
  }

  // API/MCP tools queries
  if (/api|tool|endpoint/.test(queryLower) && capabilities.domains.includes('mcp-tools')) {
    const toolCount = summary.surfaces.mcpTools.length;
    const routeCount = summary.surfaces.routes.length;

    return (
      `This project implements ${toolCount} MCP tools` +
      (routeCount > 0 ? ` and ${routeCount} HTTP endpoints` : '') +
      '. ' +
      `Key tools: ${summary.surfaces.mcpTools
        .slice(0, 3)
        .map(t => t.name)
        .join(', ')}.`
    );
  }

  return undefined;
}

// Helper functions

function inferExportRole(name: string, kind: string): string {
  const nameLower = name.toLowerCase();

  if (/init|initialize|bootstrap|setup/.test(nameLower)) return 'initializer';
  if (/search|query|find/.test(nameLower)) return 'search';
  if (/provider|pipeline|factory/.test(nameLower)) return 'provider';
  if (/store|save|insert|upsert/.test(nameLower)) return 'storage';
  if (/validate|verify|check/.test(nameLower)) return 'validation';
  if (/handle|process|execute/.test(nameLower)) return 'handler';

  return kind;
}

function generateRiskRecommendations(flags: RiskFlag[]): string[] {
  const recommendations: string[] = [];

  for (const flag of flags) {
    switch (flag.type) {
      case 'security':
        if (flag.message.includes('.env.example')) {
          recommendations.push(
            'Create .env.example file documenting required environment variables'
          );
        }
        if (flag.message.includes('.env file')) {
          recommendations.push('Ensure .env file is listed in .gitignore');
        }
        break;
      case 'maintenance':
        if (flag.message.includes('test')) {
          recommendations.push('Add test files to improve code reliability');
        }
        break;
      case 'config':
        if (flag.message.includes('tsconfig')) {
          recommendations.push('Add tsconfig.json for proper TypeScript configuration');
        }
        if (flag.message.includes('MCP server: Consider documenting')) {
          recommendations.push('Document environment variables in mcp.json configuration file');
        }
        break;
      case 'performance':
        if (flag.message.includes('large files')) {
          recommendations.push('Consider breaking down large files for better maintainability');
        }
        break;
    }
  }

  return recommendations.slice(0, 5);
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/**
 * Verifier #5: Symbol & Import Noise Filters
 */
function filterNoisySymbols(exports: ExportItem[]): ExportItem[] {
  // Function stopwords - too generic unless in meaningful context
  const functionStopwords = new Set([
    'render',
    'handler',
    'default',
    'index',
    'config',
    'props',
    'children',
    'value',
    'data',
    'item',
    'element',
    'component',
    'wrapper',
    'container',
  ]);

  return exports.filter(exp => {
    const name = exp.name.toLowerCase();

    // Filter out generic function names unless in server contexts
    if (functionStopwords.has(name)) {
      // Allow in server/API contexts
      const isServerContext = /\/(api|server|mcpServer|worker|lib|core|utils|services)\//.test(
        exp.file.replace(/\\/g, '/')
      );
      return isServerContext;
    }

    // Filter out obvious UI component patterns
    if (/^(button|card|modal|dialog|input|form|label|text|icon|image)$/i.test(name)) {
      return false;
    }

    // Filter out React/UI patterns
    if (/^(use[A-Z]|with[A-Z]|create[A-Z].*Component)/.test(exp.name)) {
      return false;
    }

    // Keep meaningful exports
    return true;
  });
}

/**
 * Collapse UI imports into categories and focus on infrastructure
 */
function collapseImports(imports: string[]): string[] {
  const collapsed: string[] = [];
  const uiImports = new Set<string>();

  for (const imp of imports) {
    // Collapse UI framework imports
    if (/^(@\/components\/ui|shadcn\/ui|lucide-react|@radix-ui)/.test(imp)) {
      uiImports.add('ui-kit');
      continue;
    }

    // Collapse React ecosystem
    if (/^(react|next\/|@next\/)/.test(imp)) {
      uiImports.add('react-ecosystem');
      continue;
    }

    // Keep infrastructure and local program modules
    if (imp.startsWith('./') || imp.startsWith('../')) {
      collapsed.push(imp); // Local modules
    } else if (/^(pg|postgres|supabase|redis|ioredis|mongodb|mysql)/.test(imp)) {
      collapsed.push(imp); // Database
    } else if (/^(express|fastify|koa|hapi)/.test(imp)) {
      collapsed.push(imp); // Web frameworks
    } else if (/^(@anthropic|openai|claude)/.test(imp)) {
      collapsed.push(imp); // AI services
    } else if (/^(bullmq|agenda|node-cron)/.test(imp)) {
      collapsed.push(imp); // Job queues
    } else if (/^(zod|joi|yup|ajv)/.test(imp)) {
      collapsed.push(imp); // Validation
    } else if (/^(dotenv|config)/.test(imp)) {
      collapsed.push(imp); // Configuration
    }
  }

  // Add collapsed UI categories
  if (uiImports.size > 0) {
    collapsed.push(...Array.from(uiImports));
  }

  return collapsed.slice(0, 10); // Limit for focus
}

/**
 * Fix for critique item #2: Filter out HTTP method exports from Public API Surfaces
 * Route handler exports (GET, POST, etc.) should only appear in routes section
 */
function filterRouteExportsFromPublicAPI(exports: ExportItem[], routes: RouteItem[]): ExportItem[] {
  const httpMethods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
  const routeFiles = new Set(routes.map(route => route.file.replace(/\\/g, '/')));

  return exports.filter(exp => {
    // If this is an HTTP method export
    if (httpMethods.has(exp.name.toUpperCase())) {
      const normalizedFile = exp.file.replace(/\\/g, '/');
      // Check if it's from a route file
      if (
        routeFiles.has(normalizedFile) ||
        normalizedFile.match(/app\/.*\/route\.(ts|js)$/) ||
        normalizedFile.includes('/api/')
      ) {
        return false; // Exclude from public API, it's a route handler
      }
    }

    return true; // Include in public API
  });
}
