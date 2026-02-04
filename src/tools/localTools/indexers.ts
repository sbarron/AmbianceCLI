/**
 * @fileOverview: Enhanced project indexers for AST-derived surfaces and public APIs
 * @module: ProjectIndexers
 * @keyFunctions:
 *   - buildExportIndex(): Extract all exports with AST parsing
 *   - buildImportGraph(): Build cross-file import relationships
 *   - detectRoutes(): Find HTTP routes and API endpoints
 *   - detectMcpTools(): Discover MCP tools and handlers
 *   - detectEnvKeys(): Find environment variable usage
 *   - detectDb(): Database and storage engine detection
 *   - detectGitInfo(): Get recent commit information
 * @context: Provides rich indexing for public surfaces that agents can act on immediately
 */

import { readFile } from 'fs/promises';
import * as path from 'path';
import { logger } from '../../utils/logger';
import { FileInfo } from '../../core/compactor/fileDiscovery';
import { toPosix, nextAppRouteToPath, isServerishPath } from './utils/pathUtils';
import {
  collectDbEvidence,
  dbInitializersForFile,
  calculateDbConfidence,
  detectDatabaseEngine,
} from './utils/dbEvidence';
import {
  isPublicSurface,
  extractApiSignature,
  formatSignature,
  inferExportRole,
  shouldExcludeFromPublicApi,
  ApiSymbol,
} from './utils/publicApi';

export interface ExportItem {
  name: string;
  kind: 'function' | 'class' | 'const' | 'interface' | 'type';
  file: string;
  line: number;
  jsdoc?: string;
  params?: number;
  signature?: string;
  role?: string;
}

export interface RouteItem {
  method: string;
  path: string;
  file: string;
  line: number;
  handler?: string;
}

export interface ToolItem {
  name: string;
  file: string;
  line: number;
  description?: string;
}

export interface EnvItem {
  key: string;
  file: string;
  line: number;
  usage: 'read' | 'default' | 'config';
}

export interface DbInfo {
  engine?: 'sqlite' | 'postgresql' | 'mysql' | 'mongodb' | 'redis' | 'unknown';
  initializers: Array<{ file: string; symbol: string; line: number }>;
  connections: Array<{ file: string; line: number; pattern: string }>;
  evidence?: Array<{ file: string; line: number; match: string; type: 'import' | 'env' | 'usage' }>;
  confidence?: number;
}

export interface GitInfo {
  lastCommitDate?: string;
  lastAuthor?: string;
  commitCount?: number;
}

/**
 * Build comprehensive export index from files using AST-like parsing
 */
export async function buildExportIndex(files: FileInfo[]): Promise<ExportItem[]> {
  const exports: ExportItem[] = [];

  for (const file of files) {
    // Expand to support multiple languages for export analysis
    const exportLanguages = ['typescript', 'javascript', 'python', 'go', 'php', 'ruby'];
    if (!exportLanguages.includes(file.language)) continue;

    // Use improved public API surface scoping
    const posixPath = toPosix(file.relPath);
    if (!isPublicSurface(posixPath)) {
      continue;
    }

    try {
      const content = await readFile(file.absPath, 'utf-8');
      const fileExports = extractExportsFromContent(content, toPosix(file.relPath), file.language);

      // Enhance exports with signatures and roles
      const enhancedExports = fileExports.map(exp => {
        const { params, signature } = extractApiSignature(content, exp.name, exp.kind);
        const role = inferExportRole(exp.name, exp.kind, exp.file);

        return {
          ...exp,
          file: toPosix(exp.file),
          params,
          signature,
          role,
        };
      });

      // Filter out noise
      const filteredExports = enhancedExports.filter(
        exp => !shouldExcludeFromPublicApi(exp.name, exp.kind, exp.file)
      );

      exports.push(...filteredExports);
    } catch (error) {
      logger.warn('Could not read file for export analysis', {
        file: file.relPath,
        error: (error as Error).message,
      });
    }
  }

  // Verifier #7: De-duplicate exports
  const dedupedExports = deduplicateExports(exports);

  return dedupedExports.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Build import graph mapping from file to imported files
 */
export async function buildImportGraph(files: FileInfo[]): Promise<Map<string, string[]>> {
  const graph = new Map<string, string[]>();

  for (const file of files) {
    if (!['typescript', 'javascript'].includes(file.language)) continue;

    try {
      const content = await readFile(file.absPath, 'utf-8');
      const imports = extractImportsFromContent(content);

      const resolvedImports = imports
        .filter(imp => imp.startsWith('./') || imp.startsWith('../'))
        .map(imp => resolveImportPath(imp, file.relPath))
        .filter(Boolean) as string[];

      graph.set(file.relPath, resolvedImports);
    } catch (error) {
      logger.warn('Could not build import graph for file', {
        file: file.relPath,
        error: (error as Error).message,
      });
    }
  }

  return graph;
}

/**
 * Detect HTTP routes and API endpoints
 */
export async function detectRoutes(files: FileInfo[]): Promise<RouteItem[]> {
  const routes: RouteItem[] = [];

  for (const file of files) {
    if (!['typescript', 'javascript'].includes(file.language)) continue;

    try {
      const content = await readFile(file.absPath, 'utf-8');
      const fileRoutes = extractRoutesFromContent(content, toPosix(file.relPath));
      routes.push(...fileRoutes);
    } catch (error) {
      logger.warn('Could not analyze routes in file', {
        file: file.relPath,
        error: (error as Error).message,
      });
    }
  }

  // Fix for critique items #1 and #5: Deduplicate routes and normalize paths
  return deduplicateRoutes(routes);
}

/**
 * Detect MCP tools and handlers
 */
export async function detectMcpTools(files: FileInfo[]): Promise<ToolItem[]> {
  const tools: ToolItem[] = [];

  for (const file of files) {
    // Expand to support multiple languages for MCP servers
    const mcpLanguages = ['typescript', 'javascript', 'python', 'go', 'php', 'ruby'];
    if (!mcpLanguages.includes(file.language)) continue;

    try {
      const content = await readFile(file.absPath, 'utf-8');
      const fileTools = extractMcpToolsFromContent(content, toPosix(file.relPath), file.language);
      tools.push(...fileTools);
    } catch (error) {
      logger.warn('Could not analyze MCP tools in file', {
        file: file.relPath,
        error: (error as Error).message,
      });
    }
  }

  return tools;
}

/**
 * Detect environment variable usage
 */
export async function detectEnvKeys(files: FileInfo[]): Promise<EnvItem[]> {
  const envKeys: EnvItem[] = [];

  for (const file of files) {
    // Expand to support multiple languages
    const supportedLanguages = ['typescript', 'javascript', 'python', 'php', 'go', 'ruby'];
    if (!supportedLanguages.includes(file.language)) continue;

    try {
      const content = await readFile(file.absPath, 'utf-8');
      const fileEnvKeys = extractEnvKeysFromContent(content, toPosix(file.relPath), file.language);
      envKeys.push(...fileEnvKeys);
    } catch (error) {
      logger.warn('Could not analyze env keys in file', {
        file: file.relPath,
        error: (error as Error).message,
      });
    }
  }

  // Deduplicate by key
  const uniqueKeys = new Map<string, EnvItem>();
  for (const envKey of envKeys) {
    if (!uniqueKeys.has(envKey.key)) {
      uniqueKeys.set(envKey.key, envKey);
    }
  }

  return Array.from(uniqueKeys.values()).sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Detect database engines and initialization patterns
 */
export async function detectDb(files: FileInfo[]): Promise<DbInfo> {
  let engine: DbInfo['engine'] = 'unknown';
  const initializers: DbInfo['initializers'] = [];
  const connections: DbInfo['connections'] = [];
  const evidence: Array<{
    file: string;
    line: number;
    match: string;
    type: 'import' | 'env' | 'usage';
  }> = [];

  const allEvidence: Array<{ file: string; line: number; match: string }> = [];
  const engineVotes: Record<string, number> = {};

  for (const file of files) {
    if (!['typescript', 'javascript', 'python'].includes(file.language)) continue;

    try {
      const content = await readFile(file.absPath, 'utf-8');
      const posixPath = toPosix(file.relPath);

      // Use improved database detection
      const { engine: detectedEngine, evidence: fileEvidence } = detectDatabaseEngine(content);
      if (detectedEngine !== 'unknown') {
        engineVotes[detectedEngine] = (engineVotes[detectedEngine] || 0) + fileEvidence.length;
      }

      // Collect evidence with POSIX paths
      const enhancedEvidence = fileEvidence.map(e => ({
        ...e,
        file: posixPath,
      }));
      allEvidence.push(...enhancedEvidence);

      // Extract database initializers (with evidence gating)
      const fileInitializers = dbInitializersForFile(posixPath, content);
      const initializerObjects = fileInitializers.map(init => ({
        file: init.file,
        symbol: init.match.split(' (')[0], // Extract symbol name
        line: init.line,
      }));
      initializers.push(...initializerObjects);

      // Extract connections (keep existing logic but with POSIX paths)
      const fileConnections = extractDbConnections(content, posixPath);
      connections.push(...fileConnections);
    } catch (error) {
      logger.warn('Could not analyze database patterns in file', {
        file: file.relPath,
        error: (error as Error).message,
      });
    }
  }

  // Determine primary engine from votes
  const topEngine = Object.entries(engineVotes).sort(([, a], [, b]) => b - a)[0];
  if (topEngine) {
    engine = topEngine[0] as DbInfo['engine'];
  }

  // Calculate confidence from all evidence
  const confidence = calculateDbConfidence(allEvidence);

  // Convert evidence format
  const formattedEvidence = allEvidence
    .map(e => ({
      ...e,
      type: 'usage' as const, // simplified for now
    }))
    .slice(0, 10);

  return {
    engine,
    initializers: initializers.slice(0, 10),
    connections: connections.slice(0, 10),
    evidence: formattedEvidence,
    confidence: parseFloat(confidence.toFixed(2)),
  };
}

/**
 * Get basic git information (last commit, author, count)
 */
export async function detectGitInfo(projectPath: string): Promise<GitInfo> {
  try {
    const { spawn } = require('child_process');

    const gitInfo: GitInfo = {};

    // Get last commit date and author
    const lastCommitPromise = new Promise<string>(resolve => {
      const process = spawn('git', ['log', '-1', '--format=%ci|%an'], { cwd: projectPath });
      let output = '';
      process.stdout.on('data', (data: Buffer) => {
        output += data.toString();
      });
      process.on('close', () => resolve(output.trim()));
    });

    // Get commit count
    const commitCountPromise = new Promise<string>(resolve => {
      const process = spawn('git', ['rev-list', '--count', 'HEAD'], { cwd: projectPath });
      let output = '';
      process.stdout.on('data', (data: Buffer) => {
        output += data.toString();
      });
      process.on('close', () => resolve(output.trim()));
    });

    const [lastCommit, commitCount] = await Promise.all([lastCommitPromise, commitCountPromise]);

    if (lastCommit) {
      const [date, author] = lastCommit.split('|');
      gitInfo.lastCommitDate = date;
      gitInfo.lastAuthor = author;
    }

    if (commitCount && !isNaN(parseInt(commitCount))) {
      gitInfo.commitCount = parseInt(commitCount);
    }

    return gitInfo;
  } catch (error) {
    logger.warn('Could not get git information', {
      error: (error as Error).message,
    });
    return {};
  }
}

// Helper functions

function extractExportsFromContent(
  content: string,
  filePath: string,
  language: string = 'typescript'
): ExportItem[] {
  const exports: ExportItem[] = [];
  const lines = content.split('\n');

  // Multi-language export patterns
  let patterns: Array<{
    regex: RegExp;
    kind: 'function' | 'class' | 'const' | 'interface' | 'type';
  }> = [];

  switch (language) {
    case 'python':
      patterns = [
        // def function_name():
        { regex: /^def\s+(\w+)\s*\(/gm, kind: 'function' },
        // class ClassName:
        { regex: /^class\s+(\w+)(?:\s*\([^)]*\))?\s*:/gm, kind: 'class' },
        // variable = value (at module level)
        { regex: /^(\w+)\s*=\s*(?!.*#.*private)/gm, kind: 'const' },
      ];
      break;

    case 'php':
      patterns = [
        // function functionName() / public function functionName()
        { regex: /(?:public\s+|private\s+|protected\s+)?function\s+(\w+)\s*\(/g, kind: 'function' },
        // class ClassName
        { regex: /(?:abstract\s+|final\s+)?class\s+(\w+)/g, kind: 'class' },
        // const CONSTANT_NAME = / define('CONSTANT_NAME'
        { regex: /(?:const\s+(\w+)\s*=|define\s*\(\s*['"`](\w+)['"`])/g, kind: 'const' },
        // interface InterfaceName
        { regex: /interface\s+(\w+)/g, kind: 'interface' },
      ];
      break;

    case 'go':
      patterns = [
        // func FunctionName() / func (r *Receiver) FunctionName()
        { regex: /func\s+(?:\(\w+\s+\*?\w+\)\s+)?([A-Z]\w*)\s*\(/g, kind: 'function' },
        // type StructName struct
        { regex: /type\s+([A-Z]\w*)\s+struct/g, kind: 'class' },
        // type InterfaceName interface
        { regex: /type\s+([A-Z]\w*)\s+interface/g, kind: 'interface' },
        // var/const VariableName = (exported if starts with capital)
        { regex: /(?:var|const)\s+([A-Z]\w*)\s*=/g, kind: 'const' },
      ];
      break;

    case 'ruby':
      patterns = [
        // def method_name / def self.method_name
        { regex: /def\s+(?:self\.)?(\w+)/g, kind: 'function' },
        // class ClassName
        { regex: /class\s+(\w+)/g, kind: 'class' },
        // module ModuleName
        { regex: /module\s+(\w+)/g, kind: 'interface' },
        // CONSTANT = value
        { regex: /([A-Z][A-Z0-9_]*)\s*=/g, kind: 'const' },
      ];
      break;

    case 'typescript':
    case 'javascript':
    default:
      patterns = [
        // export function name() / export async function name()
        { regex: /export\s+(?:async\s+)?function\s+(\w+)/g, kind: 'function' },
        // export class Name
        { regex: /export\s+(?:abstract\s+)?class\s+(\w+)/g, kind: 'class' },
        // export const name = / export let name =
        { regex: /export\s+(?:const|let|var)\s+(\w+)\s*=/g, kind: 'const' },
        // export interface Name
        { regex: /export\s+interface\s+(\w+)/g, kind: 'interface' },
        // export type Name =
        { regex: /export\s+type\s+(\w+)\s*=/g, kind: 'type' },
      ];
      break;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    for (const pattern of patterns) {
      const matches = Array.from(line.matchAll(pattern.regex));
      for (const match of matches) {
        const name = match[1] || match[2]; // Handle cases where there are multiple capture groups

        if (!name) continue;

        // Extract documentation from previous lines
        const jsdoc = extractJSDocFromLines(lines, i);

        exports.push({
          name,
          kind: pattern.kind,
          file: filePath,
          line: i + 1,
          jsdoc,
        });
      }
    }
  }

  return exports;
}

function extractImportsFromContent(content: string): string[] {
  const imports: string[] = [];

  // Match import statements
  const importRegex = /import\s+(?:\{[^}]+\}|\w+|\*\s+as\s+\w+)\s+from\s+['"]([^'"]+)['"]/g;
  let match;

  while ((match = importRegex.exec(content)) !== null) {
    imports.push(match[1]);
  }

  return imports;
}

function extractRoutesFromContent(content: string, filePath: string): RouteItem[] {
  const routes: RouteItem[] = [];

  // Framework-aware route detection with verifier rules
  if (!isValidRouteFile(filePath)) {
    return routes;
  }

  const lines = content.split('\n');

  // JavaScript/TypeScript frameworks
  if (isNextAppRoute(filePath)) {
    return extractNextAppRoutes(content, filePath, lines);
  }

  if (isNextPagesApi(filePath)) {
    return extractNextPagesRoutes(content, filePath, lines);
  }

  if (usesExpressOrFastify(content)) {
    return extractExpressFastifyRoutes(content, filePath, lines);
  }

  // Python frameworks
  if (
    isPythonFile(filePath) &&
    (usesFlask(content) || usesDjango(content) || usesFastAPI(content))
  ) {
    return extractPythonRoutes(content, filePath, lines);
  }

  // PHP frameworks
  if (isPHPFile(filePath) && (usesLaravel(content) || usesSlim(content))) {
    return extractPHPRoutes(content, filePath, lines);
  }

  // Go frameworks
  if (isGoFile(filePath) && (usesGin(content) || usesEcho(content) || usesGorilla(content))) {
    return extractGoRoutes(content, filePath, lines);
  }

  // Ruby frameworks
  if (isRubyFile(filePath) && (usesRails(content) || usesSinatra(content))) {
    return extractRubyRoutes(content, filePath, lines);
  }

  return routes;
}

/**
 * Verifier #1: Framework-aware route validation - Multi-language support
 */
function isValidRouteFile(filePath: string): boolean {
  // Reject UI files and test files
  if (filePath.endsWith('.tsx')) return false;
  if (filePath.includes('/components/') || filePath.includes('\\components\\')) return false;
  if (filePath.includes('/portal/') || filePath.includes('\\portal\\')) return false;
  if (filePath.includes('/viewer/') || filePath.includes('\\viewer\\')) return false;
  if (filePath.includes('/__tests__/') || filePath.includes('\\__tests__\\')) return false;
  if (filePath.includes('.test.') || filePath.includes('.spec.')) return false;

  // Accept server-side files from multiple languages
  const serverExtensions = ['.ts', '.js', '.py', '.php', '.go', '.rb'];
  const hasServerExtension = serverExtensions.some(ext => filePath.endsWith(ext));

  if (!hasServerExtension) return false;

  // Include common server directories across languages
  const serverPaths = [
    '/api/',
    '\\api\\', // Generic API
    '/routes/',
    '\\routes\\', // Express, Laravel
    '/views/',
    '\\views\\', // Django, Rails
    '/controllers/',
    '\\controllers\\', // MVC frameworks
    '/handlers/',
    '\\handlers\\', // Go handlers
    '/endpoints/',
    '\\endpoints\\', // Generic
    '/server/',
    '\\server\\', // Server code
    'urls.py', // Django URLs
    'routes.rb', // Rails routes
    'web.php', // Laravel web routes
    'api.php', // Laravel API routes
  ];

  return serverPaths.some(serverPath => filePath.includes(serverPath));
}

function isNextAppRoute(filePath: string): boolean {
  return /app\/.*\/route\.(ts|js)$/.test(filePath.replace(/\\/g, '/'));
}

function isNextPagesApi(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  return normalized.includes('pages/api/') && /\.(ts|js)$/.test(normalized);
}

function usesExpressOrFastify(content: string): boolean {
  return (
    /(?:express|fastify|router)\.(get|post|put|delete|patch)\s*\(/.test(content) ||
    /fastify\.route\s*\(/.test(content)
  );
}

function extractNextAppRoutes(content: string, filePath: string, lines: string[]): RouteItem[] {
  const routes: RouteItem[] = [];
  const httpMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

  // Extract path using utility function
  const routePath = nextAppRouteToPath(filePath);

  // Look for named exports for HTTP methods
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    for (const method of httpMethods) {
      const pattern = new RegExp(`export\\s+(?:async\\s+)?function\\s+${method}\\b`);
      if (pattern.test(line)) {
        routes.push({
          method: method.toLowerCase(),
          path: routePath,
          file: filePath,
          line: i + 1,
          handler: method,
        });
      }
    }
  }

  return routes;
}

function extractNextPagesRoutes(content: string, filePath: string, lines: string[]): RouteItem[] {
  const routes: RouteItem[] = [];

  // Extract path from file structure (pages/api/path/to/file.ts -> /api/path/to/file)
  const pathMatch = filePath.match(/pages\/api\/(.*)\.(?:ts|js)$/);
  if (!pathMatch) return routes;

  let routePath = '/api/' + pathMatch[1];
  if (routePath.endsWith('/index')) {
    routePath = routePath.slice(0, -6);
  }

  // Look for method detection patterns
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for req.method switch/if statements
    const methodMatch = line.match(/req\.method\s*===?\s*['"]([A-Z]+)['"]/);
    if (methodMatch) {
      routes.push({
        method: methodMatch[1].toLowerCase(),
        path: routePath,
        file: filePath,
        line: i + 1,
      });
    }

    // Check for switch cases
    const switchMatch = line.match(/case\s+['"]([A-Z]+)['"]/);
    if (switchMatch && content.includes('req.method')) {
      routes.push({
        method: switchMatch[1].toLowerCase(),
        path: routePath,
        file: filePath,
        line: i + 1,
      });
    }
  }

  // If no specific methods found, assume it handles common methods
  if (routes.length === 0) {
    routes.push({
      method: 'get',
      path: routePath,
      file: filePath,
      line: 1,
    });
  }

  return routes;
}

function extractExpressFastifyRoutes(
  content: string,
  filePath: string,
  lines: string[]
): RouteItem[] {
  const routes: RouteItem[] = [];

  // Patterns for Express/Fastify routes with literal path verification
  const routePatterns = [
    // app.get('/path', handler) / router.post('/path', handler)
    /(?:app|router|server|fastify)\.(?<method>get|post|put|delete|patch|head|options)\s*\(\s*['"`](?<path>[^'"`]+)['"`]\s*,/g,
    // fastify.route({ method: 'GET', url: '/path', handler })
    /fastify\.route\s*\(\s*\{[^}]*method:\s*['"`](?<method>[^'"`]+)['"`][^}]*url:\s*['"`](?<path>[^'"`]+)['"`]/g,
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    for (const pattern of routePatterns) {
      const matches = Array.from(line.matchAll(pattern));
      for (const match of matches) {
        const method = (match.groups?.method || '').toLowerCase();
        const path = match.groups?.path || '';
        const handler = match.groups?.handler;

        // Only include if path is a literal string (not a variable)
        if (path && path.startsWith('/')) {
          routes.push({
            method,
            path,
            file: filePath,
            line: i + 1,
            handler,
          });
        }
      }
    }
  }

  return routes;
}

function extractMcpToolsFromContent(
  content: string,
  filePath: string,
  language: string = 'typescript'
): ToolItem[] {
  const tools: ToolItem[] = [];

  // Verifier #2: MCP Tools (server only)
  if (!isValidMcpToolFile(filePath)) {
    return tools;
  }

  const lines = content.split('\n');

  // Multi-language MCP tool patterns
  let registrationPatterns: RegExp[] = [];
  let definitionPatterns: RegExp[] = [];
  let handlerPatterns: RegExp[] = [];

  switch (language) {
    case 'python':
      registrationPatterns = [
        // server.set_request_handler("tools/list", handler)
        /server\.set_request_handler\s*\(\s*['"`]tools\/(list|call)['"`]/g,
        // @server.tool() decorator
        /@server\.tool\s*\(\s*['"`]?([^'"`\)]+)['"`]?\s*\)/g,
        // server.add_tool("name", handler)
        /server\.add_tool\s*\(\s*['"`]([^'"`]+)['"`]/g,
      ];
      definitionPatterns = [
        // tool_name = Tool(name="tool_name")
        /(\w+)\s*=\s*Tool\s*\([^)]*name\s*=\s*['"`]([^'"`]+)['"`]/g,
        // "name": "tool_name" in tool definitions
        /"name"\s*:\s*['"`]([^'"`]+)['"`][^}]*(?:"description"|"input_schema")/g,
      ];
      handlerPatterns = [
        // if tool_name == "tool":
        /if\s+tool_name\s*==\s*['"`]([^'"`]+)['"`]/g,
        // case "tool_name":
        /case\s+['"`]([^'"`]+)['"`]\s*:/g,
      ];
      break;

    case 'go':
      registrationPatterns = [
        // server.SetRequestHandler("tools/list", handler)
        /server\.SetRequestHandler\s*\(\s*['"`]tools\/(list|call)['"`]/g,
        // server.AddTool("name", handler)
        /server\.AddTool\s*\(\s*['"`]([^'"`]+)['"`]/g,
      ];
      definitionPatterns = [
        // Name: "tool_name"
        /Name:\s*['"`]([^'"`]+)['"`][^}]*(?:Description|InputSchema)/g,
        // "name": "tool_name"
        /"name":\s*['"`]([^'"`]+)['"`][^}]*(?:"description"|"input_schema")/g,
      ];
      handlerPatterns = [
        // case "tool_name":
        /case\s+['"`]([^'"`]+)['"`]\s*:/g,
      ];
      break;

    case 'php':
      registrationPatterns = [
        // $server->setRequestHandler("tools/list", $handler)
        /\$server->setRequestHandler\s*\(\s*['"`]tools\/(list|call)['"`]/g,
        // $server->addTool("name", $handler)
        /\$server->addTool\s*\(\s*['"`]([^'"`]+)['"`]/g,
      ];
      definitionPatterns = [
        // 'name' => 'tool_name'
        /'name'\s*=>\s*['"`]([^'"`]+)['"`][^}]*(?:'description'|'input_schema')/g,
        // "name" => "tool_name"
        /"name"\s*=>\s*['"`]([^'"`]+)['"`][^}]*(?:"description"|"input_schema")/g,
      ];
      handlerPatterns = [
        // case 'tool_name':
        /case\s+['"`]([^'"`]+)['"`]\s*:/g,
      ];
      break;

    case 'ruby':
      registrationPatterns = [
        // server.set_request_handler("tools/list", handler)
        /server\.set_request_handler\s*\(\s*['"`]tools\/(list|call)['"`]/g,
        // server.add_tool("name", handler)
        /server\.add_tool\s*\(\s*['"`]([^'"`]+)['"`]/g,
      ];
      definitionPatterns = [
        // name: "tool_name"
        /name:\s*['"`]([^'"`]+)['"`][^}]*(?:description|input_schema)/g,
        // "name" => "tool_name"
        /"name"\s*=>\s*['"`]([^'"`]+)['"`][^}]*(?:"description"|"input_schema")/g,
      ];
      handlerPatterns = [
        // when "tool_name"
        /when\s+['"`]([^'"`]+)['"`]/g,
        // case "tool_name"
        /case\s+['"`]([^'"`]+)['"`]/g,
      ];
      break;

    case 'typescript':
    case 'javascript':
    default:
      registrationPatterns = [
        // server.setRequestHandler("tools/list" | "tools/call")
        /server\.setRequestHandler\s*\(\s*['"`]tools\/(list|call)['"`]/g,
        // server.addTool( | registerTool(
        /(?:server\.addTool|registerTool)\s*\(\s*['"`]([^'"`]+)['"`]/g,
      ];
      definitionPatterns = [
        // export const toolName = { name: 'tool_name', ... }
        /export\s+const\s+(\w+Tool)\s*=\s*\{[^}]*name:\s*['"`]([^'"`]+)['"`]/g,
        // const tools = [{ name: 'tool_name' }]
        /name:\s*['"`]([^'"`]+)['"`][^}]*(?:description|inputSchema)/g,
      ];
      handlerPatterns = [
        // case 'tool_name': in tools/call handler
        /case\s+['"`]([^'"`]+)['"`]\s*:/g,
      ];
      break;
  }

  let hasServerRegistration = false;
  let hasToolsCallHandler = false;

  // First pass: check if this file has server-side MCP patterns
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/server\.setRequestHandler\s*\(\s*['"`]tools\/(list|call)['"`]/.test(line)) {
      hasServerRegistration = true;
      hasToolsCallHandler = line.includes('tools/call');
    }

    if (/(?:server\.addTool|registerTool)\s*\(/.test(line)) {
      hasServerRegistration = true;
    }
  }

  // Only proceed if we have server-side MCP patterns
  if (!hasServerRegistration) {
    return tools;
  }

  // Second pass: extract tool names
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Registration patterns
    for (const pattern of registrationPatterns) {
      const matches = Array.from(line.matchAll(pattern));
      for (const match of matches) {
        const name = match[1];
        if (name && name !== 'list' && name !== 'call') {
          tools.push({
            name,
            file: filePath,
            line: i + 1,
            description: extractDescriptionFromLines(lines, i),
          });
        }
      }
    }

    // Definition patterns (only in server files)
    for (const pattern of definitionPatterns) {
      const matches = Array.from(line.matchAll(pattern));
      for (const match of matches) {
        const name = match[1] || match[2];
        if (name && !name.endsWith('Tool')) {
          // Use actual tool name, not variable name
          tools.push({
            name,
            file: filePath,
            line: i + 1,
            description: extractDescriptionFromLines(lines, i),
          });
        } else if (match[2]) {
          // If we matched the tool name from object definition
          tools.push({
            name: match[2],
            file: filePath,
            line: i + 1,
            description: extractDescriptionFromLines(lines, i),
          });
        }
      }
    }

    // Handler patterns (only if we confirmed tools/call handler exists)
    if (hasToolsCallHandler) {
      for (const pattern of handlerPatterns) {
        const matches = Array.from(line.matchAll(pattern));
        for (const match of matches) {
          const name = match[1];
          // Filter out obvious non-tool cases
          if (name && !isGenericCaseValue(name)) {
            tools.push({
              name,
              file: filePath,
              line: i + 1,
              description: extractDescriptionFromLines(lines, i),
            });
          }
        }
      }
    }
  }

  return tools;
}

/**
 * Verifier #2: Server-only MCP tools validation - Multi-language support
 */
function isValidMcpToolFile(filePath: string): boolean {
  // Exclude UI files (primarily JavaScript/TypeScript concern)
  if (filePath.endsWith('.tsx')) return false;
  if (filePath.includes('/components/') || filePath.includes('\\components\\')) return false;
  if (filePath.includes('/viewer/') || filePath.includes('\\viewer\\')) return false;
  if (filePath.includes('/modals/') || filePath.includes('\\modals\\')) return false;
  if (filePath.includes('/__tests__/') || filePath.includes('\\__tests\\')) return false;
  if (filePath.includes('.test.') || filePath.includes('.spec.')) return false;

  // Accept server-side extensions from multiple languages
  const serverExtensions = ['.ts', '.js', '.py', '.php', '.go', '.rb'];
  const hasServerExtension = serverExtensions.some(ext => filePath.endsWith(ext));

  if (!hasServerExtension) return false;

  // Focus on server-side directories across languages
  const serverPaths = [
    '/mcpServer/',
    '\\mcpServer\\', // MCP specific
    '/server/',
    '\\server\\', // Generic server
    '/api/',
    '\\api\\', // API endpoints
    '/tools/',
    '\\tools\\', // Tool definitions
    '/handlers/',
    '\\handlers\\', // Request handlers
    '/services/',
    '\\services\\', // Service layer
    '/lib/',
    '\\lib\\', // Library code
    '/src/',
    '\\src\\', // Source code
    'server.py',
    'server.go', // Server entry points
    'main.py',
    'main.go', // Main files
    'app.py',
    'app.rb',
    'app.php', // Application files
  ];

  return serverPaths.some(serverPath => filePath.includes(serverPath));
}

function isGenericCaseValue(value: string): boolean {
  // Filter out generic switch case values that aren't tool names
  const genericValues = ['default', 'error', 'success', 'loading', 'pending', 'complete'];
  return (
    genericValues.includes(value.toLowerCase()) ||
    /^(low|medium|high|very.high)$/i.test(value) ||
    value.length < 3
  );
}

/**
 * Verifier #4: Multi-language Public API Surface Scoping (MOVED to utils/publicApi.ts)
 * Only include exports from programmatic surfaces likely to be consumed
 */
// This function moved to utils/publicApi.ts as isPublicSurface()
function isPublicApiFile_LEGACY(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');

  // Exclude test files across all languages
  if (normalized.includes('/__tests__/')) return false;
  if (normalized.includes('/tests/')) return false;
  if (normalized.includes('.test.') || normalized.includes('.spec.')) return false;
  if (normalized.includes('_test.') || normalized.includes('_spec.')) return false;
  if (normalized.endsWith('_test.py') || normalized.endsWith('_test.go')) return false;

  // Exclude UI files (primarily JS/TS concern)
  if (normalized.endsWith('.tsx')) return false;
  if (normalized.includes('/components/')) return false;
  if (normalized.includes('/templates/') && normalized.endsWith('.html')) return false;

  // Exclude UI-focused directories
  if (normalized.includes('/pages/') && !normalized.includes('/pages/api/')) return false;
  if (normalized.includes('/app/') && !normalized.match(/\/app\/.*\/route\.(ts|js)$/)) return false;
  if (
    normalized.includes('/views/') &&
    (normalized.endsWith('.html') || normalized.endsWith('.erb'))
  )
    return false;

  // Multi-language programmatic API surfaces
  const includePatterns = [
    // Generic server directories
    /\/(api|server|mcpServer|worker|lib|core|utils|services|handlers|middleware)\//,

    // Language-specific patterns
    /\/src\/(?!components|pages\/(?!api)|templates)/, // src/ but not UI folders
    /\/pkg\//, // Go packages
    /\/internal\//, // Go internal packages
    /\/cmd\//, // Go command packages
    /\/app\/(models|controllers|services)\//, // MVC frameworks
    /\/config\//, // Configuration
    /\/database\//, // Database

    // Python specific
    /\/__init__\.py$/, // Python package files
    /\/models\.py$|\/views\.py$|\/serializers\.py$/, // Django
    /\/app\.py$|\/main\.py$|\/server\.py$/, // Python entry points

    // PHP specific
    /\/app\/(Http|Console|Providers)\//, // Laravel
    /\/src\/(Controller|Service|Repository)\//, // PHP MVC
    /\/public\/(api|index)\.php$/, // PHP entry points

    // Go specific
    /\/main\.go$|\/server\.go$|\/handler\.go$/, // Go entry points

    // Ruby specific
    /\/app\/(controllers|models|services)\//, // Rails
    /\/config\/routes\.rb$|\/app\.rb$/, // Ruby entry points
  ];

  // Check if file is in an included programmatic directory
  if (includePatterns.some(pattern => pattern.test(normalized))) {
    return true;
  }

  // Include root-level files for all supported languages
  const depth = normalized.split('/').length;
  if (depth <= 2 && normalized.match(/\.(ts|js|py|php|go|rb)$/)) {
    return true;
  }

  return false;
}

/**
 * Verifier #7: De-duplicate exports
 * Key: (file, name, kind, line) with tolerance for overloads
 */
function deduplicateExports(exports: ExportItem[]): ExportItem[] {
  const dedupedMap = new Map<string, ExportItem[]>();

  // Group exports by file and name
  for (const exp of exports) {
    const key = `${exp.file}:${exp.name}:${exp.kind}`;
    if (!dedupedMap.has(key)) {
      dedupedMap.set(key, []);
    }
    dedupedMap.get(key)!.push(exp);
  }

  const result: ExportItem[] = [];

  for (const [key, duplicates] of dedupedMap) {
    if (duplicates.length === 1) {
      result.push(duplicates[0]);
    } else {
      // Multiple definitions - check if they're legitimate overloads or duplicates
      const uniqueLines = new Set(duplicates.map(d => d.line));

      if (uniqueLines.size === 1) {
        // Same line - true duplicate
        result.push(duplicates[0]);
      } else if (duplicates.every(d => d.kind === 'function') && uniqueLines.size <= 5) {
        // Function overloads - collapse with line range
        const sortedDupes = duplicates.sort((a, b) => a.line - b.line);
        const firstDupe = sortedDupes[0];
        const lineRange =
          uniqueLines.size > 1
            ? `${Math.min(...uniqueLines)}-${Math.max(...uniqueLines)}`
            : firstDupe.line.toString();

        result.push({
          ...firstDupe,
          line: firstDupe.line, // Keep first occurrence line
          jsdoc: firstDupe.jsdoc || `${duplicates.length} definitions at lines ${lineRange}`,
        });
      } else {
        // Other duplicates - keep the one with best JSDoc or first occurrence
        const bestDupe = duplicates.find(d => d.jsdoc) || duplicates[0];
        result.push(bestDupe);
      }
    }
  }

  return result;
}

function extractEnvKeysFromContent(content: string, filePath: string, language: string): EnvItem[] {
  const envKeys: EnvItem[] = [];
  const lines = content.split('\n');

  // Multi-language environment variable patterns
  const envPatterns: RegExp[] = [];

  switch (language) {
    case 'python':
      envPatterns.push(
        /os\.environ(?:\.get)?\s*\[\s*['"`]([^'"`]+)['"`]\s*\]/g,
        /getenv\s*\(\s*['"`]([^'"`]+)['"`]/g
      );
      break;

    case 'php':
      envPatterns.push(
        /\$_ENV\s*\[\s*['"`]([^'"`]+)['"`]\s*\]/g,
        /getenv\s*\(\s*['"`]([^'"`]+)['"`]/g,
        /env\s*\(\s*['"`]([^'"`]+)['"`]/g // Laravel helper
      );
      break;

    case 'go':
      envPatterns.push(
        /os\.Getenv\s*\(\s*['"`]([^'"`]+)['"`]/g,
        /os\.LookupEnv\s*\(\s*['"`]([^'"`]+)['"`]/g
      );
      break;

    case 'ruby':
      envPatterns.push(
        /ENV\s*\[\s*['"`]([^'"`]+)['"`]\s*\]/g,
        /ENV\.fetch\s*\(\s*['"`]([^'"`]+)['"`]/g
      );
      break;

    case 'typescript':
    case 'javascript':
    default:
      envPatterns.push(/process\.env\.(\w+)/g, /process\.env\s*\[\s*['"`]([^'"`]+)['"`]\s*\]/g);
      break;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    for (const envPattern of envPatterns) {
      const matches = Array.from(line.matchAll(envPattern));
      for (const match of matches) {
        const key = match[1];
        const usage = determineEnvUsage(line);

        envKeys.push({
          key,
          file: filePath,
          line: i + 1,
          usage,
        });
      }
    }
  }

  return envKeys;
}

function detectEngineFromContent(content: string): DbInfo['engine'] {
  const enginePatterns = {
    sqlite: /(?:better-)?sqlite3|database\.db|\.sqlite/i,
    postgresql: /pg|postgres|postgresql|libpq/i,
    mysql: /mysql|mariadb/i,
    mongodb: /mongodb|mongoose|mongo/i,
    redis: /redis|ioredis/i,
  };

  for (const [engine, pattern] of Object.entries(enginePatterns)) {
    if (pattern.test(content)) {
      return engine as DbInfo['engine'];
    }
  }

  return 'unknown';
}

// Database initializer extraction moved to utils/dbEvidence.ts
// This function is now handled by dbInitializersForFile()
function extractDbInitializers_LEGACY(
  content: string,
  filePath: string
): Array<{ file: string; symbol: string; line: number }> {
  const initializers: Array<{ file: string; symbol: string; line: number }> = [];
  const lines = content.split('\n');

  // Fix for critique item #3: Evidence-gated DB initializers
  // Only include if file has actual DB evidence
  // Evidence checking is now done by dbInitializersForFile() in utils
  const dbEvidence = collectDbEvidence(content);
  if (dbEvidence.length === 0) {
    return initializers;
  }

  const initPatterns = [
    /(?:async\s+)?function\s+(\w*(?:init|connect|setup|bootstrap)\w*)/gi,
    /(?:const|let|var)\s+(\w*(?:init|connect|setup|bootstrap)\w*)\s*=/gi,
    /(\w+)\s*:\s*(?:async\s+)?function.*(?:init|connect|setup|bootstrap)/gi,
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    for (const pattern of initPatterns) {
      const matches = Array.from(line.matchAll(pattern));
      for (const match of matches) {
        const symbol = match[1];
        if (symbol && symbol.length > 2) {
          initializers.push({
            file: filePath,
            symbol,
            line: i + 1,
          });
        }
      }
    }
  }

  return initializers;
}

function extractDbConnections(
  content: string,
  filePath: string
): Array<{ file: string; line: number; pattern: string }> {
  const connections: Array<{ file: string; line: number; pattern: string }> = [];
  const lines = content.split('\n');

  const connectionPatterns = [
    /new\s+(?:Database|Client|Pool|Connection)\s*\(/gi,
    /\.connect\s*\(/gi,
    /createConnection\s*\(/gi,
    /openDatabase\s*\(/gi,
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    for (const pattern of connectionPatterns) {
      if (pattern.test(line)) {
        connections.push({
          file: filePath,
          line: i + 1,
          pattern: pattern.source,
        });
        break; // Only one pattern per line
      }
    }
  }

  return connections;
}

// Utility functions

function extractJSDocFromLines(lines: string[], currentLine: number): string | undefined {
  // Look backwards for JSDoc comments
  const jsdocLines: string[] = [];
  let i = currentLine - 1;

  while (
    i >= 0 &&
    (lines[i].trim().startsWith('*') ||
      lines[i].trim().startsWith('/**') ||
      lines[i].trim().startsWith('//'))
  ) {
    jsdocLines.unshift(lines[i].trim());
    if (lines[i].trim().startsWith('/**')) break;
    i--;
  }

  if (jsdocLines.length > 0) {
    return jsdocLines
      .map(line => line.replace(/^\/?\*+\/?/, '').trim())
      .filter(line => line.length > 0)
      .join(' ')
      .substring(0, 200); // Limit length
  }

  return undefined;
}

function extractDescriptionFromLines(lines: string[], currentLine: number): string | undefined {
  // Look for description in nearby comments or same line
  const line = lines[currentLine];
  const descMatch = line.match(/description:\s*['"`]([^'"`]+)['"`]/);
  if (descMatch) {
    return descMatch[1];
  }

  return extractJSDocFromLines(lines, currentLine);
}

function determineEnvUsage(line: string): EnvItem['usage'] {
  if (line.includes('||') || line.includes('??')) return 'default';
  if (line.includes('config') || line.includes('Config')) return 'config';
  return 'read';
}

function resolveImportPath(importPath: string, currentFile: string): string | null {
  try {
    const currentDir = path.dirname(currentFile);
    const resolved = path.resolve(currentDir, importPath);
    const normalized = resolved.replace(/\\/g, '/');

    // Try with common extensions
    const extensions = ['', '.ts', '.js', '.tsx', '.jsx', '/index.ts', '/index.js'];
    for (const ext of extensions) {
      const withExt = normalized + ext;
      if (withExt !== currentFile) {
        return withExt;
      }
    }

    return normalized;
  } catch {
    return null;
  }
}

/**
 * Fix for critique item #1: Proper Next.js App Router path derivation
 * Converts file path to URL path with proper segment handling
 */
// nextAppRouteToPath function moved to utils/pathUtils.ts

/**
 * Fix for critique items #1 and #5: Deduplicate routes and normalize paths
 * Key: (method, path, file) with path normalization and sorting
 */
function deduplicateRoutes(routes: RouteItem[]): RouteItem[] {
  const dedupedMap = new Map<string, RouteItem>();

  for (const route of routes) {
    // Paths should already be POSIX from toPosix() calls above
    const key = `${route.method}:${route.path}:${route.file}`;

    if (!dedupedMap.has(key)) {
      dedupedMap.set(key, route);
    }
  }

  // Sort by path, then method, then line for determinism
  return Array.from(dedupedMap.values()).sort((a, b) => {
    if (a.path !== b.path) return a.path.localeCompare(b.path);
    if (a.method !== b.method) return a.method.localeCompare(b.method);
    return a.line - b.line;
  });
}

/**
 * Fix for critique item #3: Multi-language database evidence detection
 */
// Database evidence detection moved to utils/dbEvidence.ts
// This function is now handled by collectDbEvidence() and detectDatabaseEngine()
function checkDbEvidence_LEGACY(content: string): boolean {
  const dbEvidencePatterns = [
    // JavaScript/TypeScript - Node.js
    /from\s+['"](?:pg|postgres|mysql2?|sqlite3?|mongodb?|(?:io)?redis)['"]|import.*(?:pg|postgres|mysql|sqlite|mongo|redis)/i,
    /@supabase\/|kysely|drizzle-orm|prisma/i,
    /process\.env\.(?:DATABASE_URL|POSTGRES_URL|MYSQL_URL|MONGODB_URI|REDIS_URL)/,
    /sql`|pool\.query|db\.query|new\s+(?:Pool|Client|Database|Connection)\s*\(/i,

    // Python - Django/Flask/SQLAlchemy
    /from\s+django\.db|import\s+django|from\s+sqlalchemy|import\s+sqlalchemy/i,
    /from\s+flask_sqlalchemy|import\s+pymongo|import\s+psycopg2|import\s+sqlite3/i,
    /models\.Model|db\.Model|Session\(\)|create_engine\(|MongoClient\(/i,
    /os\.environ\.get\s*\(\s*['"](?:DATABASE_URL|DB_|POSTGRES_|MYSQL_|MONGO)/i,

    // PHP - Laravel/Eloquent
    /use\s+Illuminate\\Database|use\s+App\\Models|Eloquent::|DB::/i,
    /\$pdo|mysqli|PDO::|new\s+PDO\(|\$_ENV\[['"]DB_/i,
    /Schema::|Migration|Artisan|config\(['"]database/i,

    // Go - GORM/database/sql
    /import\s+['"]gorm\.io|import\s+['"]database\/sql|import\s+['"]github\.com\/lib\/pq/i,
    /gorm\.Open\(|sql\.Open\(|db\.Query\(|db\.Exec\(/i,
    /os\.Getenv\(['"](?:DATABASE_URL|DB_|POSTGRES_|MYSQL_)/i,

    // Ruby - Rails/ActiveRecord
    /ActiveRecord::|class.*<\s*ApplicationRecord|require\s+['"]pg['"]|require\s+['"]mysql2/i,
    /Rails\.application\.config|ActiveRecord::Base|connection\.execute/i,
    /ENV\[['"](?:DATABASE_URL|DB_|POSTGRES_|MYSQL_)/i,

    // Generic SQL patterns (cross-language)
    /SELECT\s+.*FROM\s+|INSERT\s+INTO\s+|UPDATE\s+.*SET\s+|DELETE\s+FROM\s+/i,
    /CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE|CREATE\s+INDEX/i,
  ];

  return dbEvidencePatterns.some(pattern => pattern.test(content));
}

/**
 * Fix for critique item #3: Filter out UI-related symbols
 */
// UI symbol detection moved to utils/dbEvidence.ts
function isUISymbol_LEGACY(symbol: string): boolean {
  const uiPatterns = [
    /^get.*initials?$/i, // getInitials
    /initialized$/i, // mermaidInitialized, etc.
    /^(button|modal|dialog|form|input|card|image).*init/i,
    /component.*init/i,
    /ui.*init/i,
  ];

  return uiPatterns.some(pattern => pattern.test(symbol));
}

// Multi-language file type detection
function isPythonFile(filePath: string): boolean {
  return filePath.endsWith('.py');
}

function isPHPFile(filePath: string): boolean {
  return filePath.endsWith('.php');
}

function isGoFile(filePath: string): boolean {
  return filePath.endsWith('.go');
}

function isRubyFile(filePath: string): boolean {
  return filePath.endsWith('.rb');
}

// Python framework detection
function usesFlask(content: string): boolean {
  return /from\s+flask\s+import|import\s+flask|@app\.route|\.route\s*\(/.test(content);
}

function usesDjango(content: string): boolean {
  return /from\s+django|import\s+django|path\s*\(|re_path\s*\(|url\s*\(/.test(content);
}

function usesFastAPI(content: string): boolean {
  return /from\s+fastapi|import\s+fastapi|@app\.(get|post|put|delete|patch)/.test(content);
}

// PHP framework detection
function usesLaravel(content: string): boolean {
  return /Route::|Illuminate\\|use\s+App\\|->middleware\(|->name\(/.test(content);
}

function usesSlim(content: string): boolean {
  return /Slim\\|->get\(|->post\(|->put\(|->delete\(|->patch\(/.test(content);
}

// Go framework detection
function usesGin(content: string): boolean {
  return /gin\.|\.GET\(|\.POST\(|\.PUT\(|\.DELETE\(|\.PATCH\(|github\.com\/gin-gonic/.test(content);
}

function usesEcho(content: string): boolean {
  return /echo\.|\.GET\(|\.POST\(|\.PUT\(|\.DELETE\(|\.PATCH\(|github\.com\/labstack\/echo/.test(
    content
  );
}

function usesGorilla(content: string): boolean {
  return /mux\.|\.HandleFunc\(|\.PathPrefix\(|github\.com\/gorilla\/mux/.test(content);
}

// Ruby framework detection
function usesRails(content: string): boolean {
  return /Rails\.|resources\s+:|member\s+do|collection\s+do|get\s+['"]|post\s+['"]/.test(content);
}

function usesSinatra(content: string): boolean {
  return /require\s+['"]sinatra|get\s+['"]\/|post\s+['"]\/|put\s+['"]\/|delete\s+['"]\//.test(
    content
  );
}

// Multi-language route extractors
function extractPythonRoutes(content: string, filePath: string, lines: string[]): RouteItem[] {
  const routes: RouteItem[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Flask routes: @app.route('/path', methods=['GET', 'POST'])
    const flaskRoute = line.match(
      /@(?:\w+\.)?route\s*\(\s*['"`]([^'"`]+)['"`](?:.*methods\s*=\s*\[([^\]]+)\])?/
    );
    if (flaskRoute) {
      const path = flaskRoute[1];
      const methods = flaskRoute[2]
        ? flaskRoute[2].split(',').map(m => m.trim().replace(/['"`]/g, '').toLowerCase())
        : ['get'];

      methods.forEach(method => {
        routes.push({
          method,
          path,
          file: filePath,
          line: i + 1,
          handler: 'flask_route',
        });
      });
    }

    // FastAPI routes: @app.get('/path'), @app.post('/path')
    const fastApiRoute = line.match(
      /@(?:\w+\.)?(?<method>get|post|put|delete|patch)\s*\(\s*['"`](?<path>[^'"`]+)['"`]/
    );
    if (fastApiRoute) {
      routes.push({
        method: fastApiRoute.groups!.method,
        path: fastApiRoute.groups!.path,
        file: filePath,
        line: i + 1,
        handler: 'fastapi_route',
      });
    }

    // Django URLs: path('admin/', admin.site.urls)
    const djangoUrl = line.match(/(?:path|re_path|url)\s*\(\s*['"`]([^'"`]+)['"`]/);
    if (djangoUrl) {
      routes.push({
        method: 'get', // Django URLs don't specify method at URL level
        path: '/' + djangoUrl[1].replace(/^\^?\/+|\/?\$$/g, ''),
        file: filePath,
        line: i + 1,
        handler: 'django_url',
      });
    }
  }

  return routes;
}

function extractPHPRoutes(content: string, filePath: string, lines: string[]): RouteItem[] {
  const routes: RouteItem[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Laravel routes: Route::get('/path', 'Controller@method')
    const laravelRoute = line.match(
      /Route::(?<method>get|post|put|delete|patch|any)\s*\(\s*['"`](?<path>[^'"`]+)['"`]/
    );
    if (laravelRoute) {
      routes.push({
        method: laravelRoute.groups!.method,
        path: laravelRoute.groups!.path,
        file: filePath,
        line: i + 1,
        handler: 'laravel_route',
      });
    }

    // Slim routes: $app->get('/path', function() {})
    const slimRoute = line.match(
      /\$\w+->(?<method>get|post|put|delete|patch)\s*\(\s*['"`](?<path>[^'"`]+)['"`]/
    );
    if (slimRoute) {
      routes.push({
        method: slimRoute.groups!.method,
        path: slimRoute.groups!.path,
        file: filePath,
        line: i + 1,
        handler: 'slim_route',
      });
    }
  }

  return routes;
}

function extractGoRoutes(content: string, filePath: string, lines: string[]): RouteItem[] {
  const routes: RouteItem[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Gin routes: router.GET("/path", handler)
    const ginRoute = line.match(
      /\w+\.(?<method>GET|POST|PUT|DELETE|PATCH)\s*\(\s*"(?<path>[^"]+)"/
    );
    if (ginRoute) {
      routes.push({
        method: ginRoute.groups!.method.toLowerCase(),
        path: ginRoute.groups!.path,
        file: filePath,
        line: i + 1,
        handler: 'gin_route',
      });
    }

    // Echo routes: e.GET("/path", handler)
    const echoRoute = line.match(
      /\w+\.(?<method>GET|POST|PUT|DELETE|PATCH)\s*\(\s*"(?<path>[^"]+)"/
    );
    if (echoRoute) {
      routes.push({
        method: echoRoute.groups!.method.toLowerCase(),
        path: echoRoute.groups!.path,
        file: filePath,
        line: i + 1,
        handler: 'echo_route',
      });
    }

    // Gorilla Mux: router.HandleFunc("/path", handler).Methods("GET")
    const gorillaRoute = line.match(
      /\w+\.HandleFunc\s*\(\s*"(?<path>[^"]+)".*\.Methods\s*\(\s*"(?<method>[^"]+)"/
    );
    if (gorillaRoute) {
      routes.push({
        method: gorillaRoute.groups!.method.toLowerCase(),
        path: gorillaRoute.groups!.path,
        file: filePath,
        line: i + 1,
        handler: 'gorilla_route',
      });
    }
  }

  return routes;
}

function extractRubyRoutes(content: string, filePath: string, lines: string[]): RouteItem[] {
  const routes: RouteItem[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Rails routes: get '/path', to: 'controller#action'
    const railsRoute = line.match(
      /(?<method>get|post|put|delete|patch)\s+['"`](?<path>[^'"`]+)['"`]/
    );
    if (railsRoute) {
      routes.push({
        method: railsRoute.groups!.method,
        path: railsRoute.groups!.path,
        file: filePath,
        line: i + 1,
        handler: 'rails_route',
      });
    }

    // Rails resources: resources :users
    const railsResource = line.match(/resources\s+:(\w+)/);
    if (railsResource) {
      const resource = railsResource[1];
      // Generate RESTful routes
      ['get', 'post', 'put', 'delete'].forEach(method => {
        routes.push({
          method,
          path: `/${resource}`,
          file: filePath,
          line: i + 1,
          handler: 'rails_resource',
        });
      });
    }

    // Sinatra routes: get '/path' do
    const sinatraRoute = line.match(
      /(?<method>get|post|put|delete|patch)\s+['"`](?<path>[^'"`]+)['"`]/
    );
    if (sinatraRoute) {
      routes.push({
        method: sinatraRoute.groups!.method,
        path: sinatraRoute.groups!.path,
        file: filePath,
        line: i + 1,
        handler: 'sinatra_route',
      });
    }
  }

  return routes;
}
