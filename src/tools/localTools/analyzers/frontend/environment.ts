/**
 * @fileOverview: Environment variables analyzer for React applications
 * @module: EnvironmentAnalyzer
 * @keyFunctions:
 *   - analyzeEnvironment(): Analyze environment variable usage and security
 *   - detectClientLeaks(): Identify server-only env vars used in client code
 *   - detectNextPublicVars(): Catalog properly exposed environment variables
 * @context: Detects environment variable security issues and proper usage patterns
 */

import { readFile } from 'fs/promises';
import type { FileInfo } from '../../../../core/compactor/fileDiscovery';
import { logger } from '../../../../utils/logger';
import { buildModuleGraph } from './graph';
import type { ComponentInfo } from './components';
import { toPosixPath } from './router';

export interface EnvironmentLeak {
  key: string;
  file: string;
  line: number;
  context: string;
  severity: 'high' | 'medium' | 'low';
}

export interface LeakIssue {
  file: string;
  line: number;
  codeFrame: string;
  symbol: string;
  category: 'ENV_CLIENT' | 'DOM_IN_RSC' | 'SERVER_IMPORT_IN_CLIENT' | 'UNSAFE_URLS';
  why: string;
  severity: 'high' | 'medium' | 'low';
  fixHint?: string;
  replacement?: string;
}

export interface EnvironmentAnalysis {
  nextPublicVars: string[];
  clientLeaks: EnvironmentLeak[];
  serverOnlyVars: string[];
  unusedVars: string[];
  leaks: LeakIssue[];
}

/**
 * Detect environment variable usage patterns
 */
export async function detectEnvironmentUsage(
  files: FileInfo[],
  components: ComponentInfo[]
): Promise<{
  nextPublicVars: string[];
  clientLeaks: EnvironmentLeak[];
  allEnvVars: Set<string>;
}> {
  const nextPublicVars: string[] = [];
  const clientLeaks: EnvironmentLeak[] = [];
  const allEnvVars = new Set<string>();

  for (const file of files) {
    if (
      !file.relPath.endsWith('.tsx') &&
      !file.relPath.endsWith('.jsx') &&
      !file.relPath.endsWith('.ts') &&
      !file.relPath.endsWith('.js')
    )
      continue;

    try {
      const content = await readFile(file.absPath, 'utf-8');
      const lines = content.split('\n');
      lines.forEach((line, index) => {
        const envRegex = /process\.env\.([A-Z0-9_]+)/g;
        let match: RegExpExecArray | null;
        while ((match = envRegex.exec(line)) !== null) {
          const envKey = match[1];
          allEnvVars.add(envKey);
          const isRouteHandler = file.relPath.includes('/route.');
          const isClientComponent = components.some(
            comp => comp.file === file.relPath && comp.kind === 'client'
          );
          const hasUseClient = content.includes("'use client'") || content.includes('"use client"');
          const isClientCode = !isRouteHandler && (isClientComponent || hasUseClient);

          if (isClientCode) {
            if (envKey.startsWith('NEXT_PUBLIC_')) {
              if (!nextPublicVars.includes(envKey)) {
                nextPublicVars.push(envKey);
              }
            } else {
              clientLeaks.push({
                key: envKey,
                file: toPosixPath(file.relPath),
                line: index + 1,
                context: line.trim().substring(0, 80) + (line.length > 80 ? '...' : ''),
                severity: 'high',
              });
            }
          }
        }

        const destructuredRegex = /const\s*{\s*([^}]*)\s*}\s*=\s*process\.env/g;
        let destructuredMatch: RegExpExecArray | null;
        while ((destructuredMatch = destructuredRegex.exec(line)) !== null) {
          const vars = destructuredMatch[1]
            .split(',')
            .map(raw => raw.trim().split(':')[0].trim())
            .filter(varName => varName && varName !== '...');
          vars.forEach(varName => allEnvVars.add(varName));
        }
      });
    } catch (error) {
      logger.debug('Failed to analyze environment usage for file', {
        file: toPosixPath(file.relPath),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { nextPublicVars, clientLeaks, allEnvVars };
}

/**
 * Analyze environment variable configuration files
 */
async function analyzeEnvironmentConfig(files: FileInfo[]): Promise<{
  definedVars: Set<string>;
  configFiles: string[];
}> {
  const definedVars = new Set<string>();
  const configFiles: string[] = [];

  for (const file of files) {
    const fileName = file.relPath.split('/').pop() || '';

    // Check for .env files
    if (fileName.startsWith('.env')) {
      configFiles.push(toPosixPath(file.relPath));
      try {
        const content = await readFile(file.absPath, 'utf-8');
        const lines = content.split('\n');
        lines.forEach(line => {
          const envMatch = line.match(/^([A-Z0-9_]+)=/);
          if (envMatch) {
            definedVars.add(envMatch[1]);
          }
        });
      } catch (error) {
        logger.debug('Failed to parse environment file', {
          file: toPosixPath(file.relPath),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Check for next.config.js/ts files for env configuration
    if (fileName === 'next.config.js' || fileName === 'next.config.ts') {
      configFiles.push(toPosixPath(file.relPath));
      try {
        const content = await readFile(file.absPath, 'utf-8');
        const envRegex = /env:\s*{([^}]*)}/g;
        let match: RegExpExecArray | null;
        while ((match = envRegex.exec(content)) !== null) {
          const envBlock = match[1];
          const varMatches = envBlock.match(/([A-Z0-9_]+):/g);
          if (varMatches) {
            varMatches.forEach(varMatch => {
              const varName = varMatch.replace(':', '');
              definedVars.add(varName);
            });
          }
        }
      } catch (error) {
        logger.debug('Failed to parse Next.js config file for env vars', {
          file: toPosixPath(file.relPath),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return { definedVars, configFiles };
}

/**
 * Find unused environment variables
 */
function findUnusedVariables(definedVars: Set<string>, usedVars: Set<string>): string[] {
  const unused: string[] = [];
  definedVars.forEach(varName => {
    if (!usedVars.has(varName)) {
      unused.push(varName);
    }
  });
  return unused.sort();
}

/**
 * Categorize environment variables
 */
function categorizeEnvironmentVariables(allVars: Set<string>): {
  nextPublicVars: string[];
  serverOnlyVars: string[];
} {
  const nextPublicVars: string[] = [];
  const serverOnlyVars: string[] = [];

  allVars.forEach(varName => {
    if (varName.startsWith('NEXT_PUBLIC_')) {
      nextPublicVars.push(varName);
    } else {
      serverOnlyVars.push(varName);
    }
  });

  return {
    nextPublicVars: nextPublicVars.sort(),
    serverOnlyVars: serverOnlyVars.sort(),
  };
}

/**
 * Generate specific ENV leak messages and replacements
 */
function generateEnvLeakDetails(envKey: string): {
  why: string;
  fixHint: string;
  replacement: string;
} {
  const nextPublicVar = `NEXT_PUBLIC_${envKey}`;
  const replacement = `process.env.${nextPublicVar}`;

  // Specific messages for common environment variables
  switch (envKey) {
    case 'NODE_ENV':
      return {
        why: `process.env.NODE_ENV accessed in client component - exposes server environment to client`,
        fixHint: `Create a build-time constant or use a feature flag from server`,
        replacement: `process.env.NEXT_PUBLIC_BUILD_ENV || 'production'`,
      };

    case 'DATABASE_URL':
    case 'DB_CONNECTION_STRING':
      return {
        why: `Database connection string '${envKey}' accessed in client - never expose to browser`,
        fixHint: `Move database operations to API routes and fetch data from server`,
        replacement: `// Fetch from API route instead`,
      };

    case 'SECRET_KEY':
    case 'API_SECRET':
    case 'JWT_SECRET':
      return {
        why: `Secret key '${envKey}' accessed in client - critical security vulnerability`,
        fixHint: `Secrets must never be exposed to client code`,
        replacement: `// Use API route for secure operations`,
      };

    case 'PORT':
      return {
        why: `Server port '${envKey}' accessed in client - not available in browser`,
        fixHint: `Use relative URLs or environment-specific base URLs`,
        replacement: `process.env.${nextPublicVar} || ''`,
      };

    case 'API_URL':
    case 'BASE_URL':
      return {
        why: `API base URL '${envKey}' accessed in client - should be public or use relative paths`,
        fixHint: `Make URL configurable or use relative paths`,
        replacement: `process.env.${nextPublicVar} || '/api'`,
      };

    default:
      return {
        why: `Server-only environment variable '${envKey}' accessed in client component`,
        fixHint: `Prefix with NEXT_PUBLIC_ to expose to client or move logic to server`,
        replacement,
      };
  }
}

/**
 * Comprehensive leak classifier with first-principles detection
 */
export async function detectAllLeaks(
  files: FileInfo[],
  components: ComponentInfo[]
): Promise<LeakIssue[]> {
  const leaks: LeakIssue[] = [];

  // Define server-only modules that should never be imported in client code
  const serverOnlyModules = new Set([
    'fs',
    'path',
    'os',
    'child_process',
    'crypto',
    'http',
    'https',
    'pg',
    'mysql',
    'sqlite3',
    'mongoose',
    'redis',
    'aws-sdk',
    '@aws-sdk/*',
    'stripe',
    'twilio',
    'nodemailer',
    'bcrypt',
    'jsonwebtoken',
    'sharp',
    'canvas',
  ]);

  // Build module graph (imports and reverse) with alias/re-export support
  const { imports: importsGraph, reverse: reverseGraph } = await buildModuleGraph(
    files,
    process.cwd()
  );

  // Seed client files: explicit "use client" or classified client components
  const seedClientFiles = new Set<string>();
  for (const file of files) {
    try {
      const content = await readFile(file.absPath, 'utf-8');
      const rel = toPosixPath(file.relPath);
      if (content.includes("'use client'") || content.includes('"use client"'))
        seedClientFiles.add(rel);
    } catch (error) {
      logger.debug('Failed to inspect file for client seed classification', {
        file: toPosixPath(file.relPath),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  components
    .filter(c => c.kind === 'client')
    .forEach(c => seedClientFiles.add(toPosixPath(c.file)));

  // Propagate: a module is client if any importer is client
  const clientSet = new Set<string>(seedClientFiles);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [mod, importers] of reverseGraph) {
      if (!clientSet.has(mod) && Array.from(importers).some(i => clientSet.has(i))) {
        clientSet.add(mod);
        changed = true;
      }
    }
  }

  // Compute reachability from app entrypoints (app/**/page|layout)
  const entrypoints: string[] = [];
  for (const file of files) {
    const rel = toPosixPath(file.relPath);
    if (/\/(app|web\/app)\/.+\/(page|layout)\.(tsx|ts|jsx|js)$/.test(rel)) {
      entrypoints.push(rel);
    }
  }
  const reachable = new Set<string>();
  const queue = [...entrypoints];
  while (queue.length) {
    const current = queue.shift();
    if (!current) {
      continue;
    }
    if (reachable.has(current)) continue;
    reachable.add(current);
    const next = importsGraph.get(current);
    if (!next) {
      continue;
    }
    for (const candidate of next) {
      if (!reachable.has(candidate)) {
        queue.push(candidate);
      }
    }
  }

  for (const file of files) {
    if (
      !file.relPath.endsWith('.tsx') &&
      !file.relPath.endsWith('.jsx') &&
      !file.relPath.endsWith('.ts') &&
      !file.relPath.endsWith('.js')
    )
      continue;

    try {
      const content = await readFile(file.absPath, 'utf-8');
      const lines = content.split('\n');

      // Determine if this is client or server code
      const normalizedRel = toPosixPath(file.relPath);
      // Skip unreachable files to avoid false positives on unused utilities/hooks
      if (!reachable.has(normalizedRel)) {
        continue;
      }
      const isRouteHandler = normalizedRel.includes('/route.');
      const isClientCode = !isRouteHandler && clientSet.has(normalizedRel);

      lines.forEach((line, index) => {
        // 1. ENV_CLIENT: process.env.* in client modules (excluding NEXT_PUBLIC_*)
        const envRegex = /process\.env\.([A-Z0-9_]+)/g;
        let match;
        while ((match = envRegex.exec(line)) !== null) {
          const envKey = match[1];
          if (isClientCode && !envKey.startsWith('NEXT_PUBLIC_')) {
            const details = generateEnvLeakDetails(envKey);
            leaks.push({
              file: toPosixPath(file.relPath),
              line: index + 1,
              codeFrame: line.trim().substring(0, 80) + (line.length > 80 ? '...' : ''),
              symbol: `process.env.${envKey}`,
              category: 'ENV_CLIENT',
              why: details.why,
              severity: 'high',
              fixHint: details.fixHint,
              replacement: details.replacement,
            });
          }
        }

        // 2. DOM_IN_RSC: DOM APIs in server components
        if (!isClientCode) {
          // More specific DOM API detection to avoid false positives
          // Only flag when these are used as actual API calls, not in strings, comments, or type definitions
          const domPatterns = [
            // Direct property access: window., document., etc.
            /\b(window|document|navigator|localStorage|sessionStorage|indexedDB|caches)\./g,
            // Function calls: window(), document(), etc.
            /\b(window|document|navigator|localStorage|sessionStorage|indexedDB|caches)\s*\(/g,
            // Assignment or comparison: = window, === document, etc.
            /(?:=|\?|\[|\(|\s|:)\s*(window|document|navigator|localStorage|sessionStorage|indexedDB|caches)\s*(?:\)|\]|;|,|}|\||&|$)/g,
            /navigator\.storage\b/g,
          ];

          for (const pattern of domPatterns) {
            let match;
            while ((match = pattern.exec(line)) !== null) {
              const domApi = match[1] || match[2];
              // Additional context checks to avoid false positives
              const lineContext = line.trim();

              // Skip if it's in a comment
              if (
                lineContext.startsWith('//') ||
                lineContext.startsWith('*') ||
                lineContext.includes('/*')
              ) {
                continue;
              }

              // Skip if it's in a string literal (more comprehensive check)
              const inSingleQuotes = lineContext.includes(`'${domApi}'`);
              const inDoubleQuotes = lineContext.includes(`"${domApi}"`);
              const inBackticks =
                lineContext.includes('`' + domApi + '`') ||
                lineContext.includes('${' + domApi + '}');
              const inStringLiteral = inSingleQuotes || inDoubleQuotes || inBackticks;

              if (inStringLiteral) {
                continue;
              }

              // Skip if it's in a type definition (contains : or type/interface keywords nearby)
              if (
                lineContext.includes(':') &&
                (lineContext.includes('type') ||
                  lineContext.includes('interface') ||
                  lineContext.includes('enum'))
              ) {
                continue;
              }

              // Skip if it's part of a variable name or property that contains the word but isn't the DOM API
              if (
                /\w+(window|document|navigator|localStorage|sessionStorage)\w+/.test(lineContext)
              ) {
                continue;
              }

              // Skip if it's used in .includes() or similar string methods
              if (
                lineContext.includes('.includes(') ||
                lineContext.includes('.contains(') ||
                lineContext.includes('.indexOf(')
              ) {
                continue;
              }

              leaks.push({
                file: toPosixPath(file.relPath),
                line: index + 1,
                codeFrame: line.trim().substring(0, 80) + (line.length > 80 ? '...' : ''),
                symbol: domApi,
                category: 'DOM_IN_RSC',
                why: `DOM API '${domApi}' used in server component - not available during SSR`,
                severity: 'high',
                fixHint: `Wrap with: if (typeof window !== 'undefined') { ... }`,
              });
            }
          }
        }

        // 3. SERVER_IMPORT_IN_CLIENT: server-only modules imported in client code
        if (isClientCode) {
          // Check import statements
          const importRegex = /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g;
          while ((match = importRegex.exec(line)) !== null) {
            const importPath = match[1];
            const moduleName = importPath.split('/')[0]; // Get the main module name

            if (serverOnlyModules.has(moduleName) || serverOnlyModules.has(importPath)) {
              leaks.push({
                file: toPosixPath(file.relPath),
                line: index + 1,
                codeFrame: line.trim().substring(0, 80) + (line.length > 80 ? '...' : ''),
                symbol: importPath,
                category: 'SERVER_IMPORT_IN_CLIENT',
                why: `Server-only module '${importPath}' imported in client code`,
                severity: 'high',
                fixHint: `Move this import to a server component or API route`,
              });
            }
          }

          // Check require statements
          const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
          while ((match = requireRegex.exec(line)) !== null) {
            const requirePath = match[1];
            const moduleName = requirePath.split('/')[0];

            if (serverOnlyModules.has(moduleName) || serverOnlyModules.has(requirePath)) {
              leaks.push({
                file: toPosixPath(file.relPath),
                line: index + 1,
                codeFrame: line.trim().substring(0, 80) + (line.length > 80 ? '...' : ''),
                symbol: requirePath,
                category: 'SERVER_IMPORT_IN_CLIENT',
                why: `Server-only module '${requirePath}' required in client code`,
                severity: 'high',
                fixHint: `Move this require to a server component or API route`,
              });
            }
          }
        }

        // 4. UNSAFE_URLS: absolute localhost URLs in client code
        if (isClientCode) {
          const urlRegex = /(https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?[^\s"'`]*)['"`]?/g;
          while ((match = urlRegex.exec(line)) !== null) {
            const url = match[1];
            leaks.push({
              file: toPosixPath(file.relPath),
              line: index + 1,
              codeFrame: line.trim().substring(0, 80) + (line.length > 80 ? '...' : ''),
              symbol: url,
              category: 'UNSAFE_URLS',
              why: `Hardcoded localhost URL '${url}' in client code - won't work in production`,
              severity: 'medium',
              fixHint: `Use relative path '/api/...' or environment variable`,
            });
          }
        }
      });
    } catch (error) {
      logger.debug('Failed to analyze environment leak patterns for file', {
        file: toPosixPath(file.relPath),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return leaks;
}

/**
 * Analyze environment variable usage and security
 */
export async function analyzeEnvironment(
  files: FileInfo[],
  components: ComponentInfo[]
): Promise<EnvironmentAnalysis> {
  logger.info(`🌍 Analyzing environment variables in ${files.length} files`);

  // Analyze environment usage in code
  const usageAnalysis = await detectEnvironmentUsage(files, components);

  // Analyze environment configuration
  const configAnalysis = await analyzeEnvironmentConfig(files);

  // Categorize variables
  const categorizedVars = categorizeEnvironmentVariables(usageAnalysis.allEnvVars);

  // Find unused variables
  const allUsedVars = new Set([...usageAnalysis.allEnvVars]);
  const unusedVars = findUnusedVariables(configAnalysis.definedVars, allUsedVars);

  // Run comprehensive leak detection
  const leaks = await detectAllLeaks(files, components);

  const analysis: EnvironmentAnalysis = {
    nextPublicVars: categorizedVars.nextPublicVars,
    clientLeaks: usageAnalysis.clientLeaks,
    serverOnlyVars: categorizedVars.serverOnlyVars,
    unusedVars,
    leaks,
  };

  logger.info(
    `🌍 Environment analysis complete: ${usageAnalysis.nextPublicVars.length} public vars, ${usageAnalysis.clientLeaks.length} leaks, ${unusedVars.length} unused vars`
  );
  return analysis;
}
