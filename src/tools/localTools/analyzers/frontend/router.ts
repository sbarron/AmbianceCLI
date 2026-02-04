/**
 * @fileOverview: Router analyzer for Next.js App Router path mapping and route detection
 * @module: RouterAnalyzer
 * @keyFunctions:
 *   - analyzeRoutes(): Analyze Next.js app router structure and extract route information
 *   - nextRoutePath(): Convert file system paths to route paths
 * @context: Detects routes, pages, layouts, and route handlers in Next.js projects
 */

import { readFile } from 'fs/promises';
import * as path from 'path';
import type { FileInfo } from '../../../../core/compactor/fileDiscovery';
import { logger } from '../../../../utils/logger';

export interface RouteInfo {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
  path: string;
  files: {
    page?: string;
    layout?: string;
    route?: string;
    loading?: string;
    error?: string;
    notFound?: string;
  };
  serverComponents: string[];
  clientComponents: string[];
  routeGroup?: string;
  parallelRoutes?: string[];
}

export interface BoundaryInfo {
  file: string;
  kind: 'client' | 'server';
  parents: string[];
  children: string[];
}

/**
 * Convert Next.js app directory structure to route path
 * Handles dynamic routes, catch-all routes, route groups, and parallel routes
 */
export function nextRoutePath(filePath: string, appDir: string = 'app'): string {
  // Remove app directory prefix and file extension
  const routePath = filePath
    // Remove common app prefixes regardless of provided appDir (handles web/app and app on Windows too)
    .replace(/^web\/app\/?/, '')
    .replace(/^app\/?/, '')
    .replace(new RegExp(`^${appDir}/?`), '') // Remove configured prefix if still present
    .replace(/(page|layout|route|loading|error|not-found)\.(tsx|ts|jsx|js)$/, '') // Remove special files (without requiring leading slash)
    .replace(/^\//, ''); // Remove leading slash

  // Handle empty route (root)
  if (!routePath || routePath === '/') return '/';

  // Split into segments
  const segments = routePath.split('/').filter(Boolean);

  // Convert dynamic segments and handle special cases
  const convertedSegments = segments
    .map(segment => {
      // Skip route groups (wrapped in parentheses)
      if (segment.startsWith('(') && segment.endsWith(')')) {
        return null; // Will be filtered out
      }

      // Skip parallel routes (@slot)
      if (segment.startsWith('@')) {
        return null; // Will be filtered out
      }

      // Dynamic route: [id] -> :id
      if (segment.startsWith('[') && segment.endsWith(']')) {
        const param = segment.slice(1, -1);
        // Catch-all route: [...slug] -> *slug
        if (param.startsWith('...')) {
          return `*${param.slice(3)}`;
        }
        // Optional catch-all: [[...slug]] -> *slug?
        if (param.startsWith('[') && param.endsWith(']') && param.includes('...')) {
          const innerParam = param.slice(1, -1);
          return `*${innerParam.slice(3)}?`;
        }
        return `:${param}`;
      }

      return segment;
    })
    .filter(Boolean); // Remove null segments (route groups and parallel routes)

  // Join segments back
  const finalPath = '/' + convertedSegments.join('/');
  return finalPath === '//' ? '/' : finalPath; // Handle double slash
}

/**
 * Extract route group from file path
 */
export function extractRouteGroup(filePath: string, appDir: string = 'app'): string | undefined {
  const routePath = filePath.replace(new RegExp(`^${appDir}/?`), '');
  const segments = routePath.split('/').filter(Boolean);

  for (const segment of segments) {
    if (segment.startsWith('(') && segment.endsWith(')')) {
      return segment.slice(1, -1); // Return group name without parentheses
    }
  }

  return undefined;
}

/**
 * Extract parallel routes from a directory structure
 */
export function extractParallelRoutes(
  files: FileInfo[],
  appDir: string = 'app'
): Map<string, string[]> {
  const parallelRoutes = new Map<string, string[]>();

  for (const file of files) {
    const relPath = file.relPath;
    const normalizedRelPath = relPath.replace(/\\/g, '/');
    const normalizedAppDir = appDir.replace(/\\/g, '/');

    // Handle case where appDir might be 'web/app' but files are in 'app/'
    const isInAppDir =
      normalizedRelPath.startsWith(normalizedAppDir) ||
      normalizedRelPath.startsWith(normalizedAppDir.replace(/^web\//, '')) ||
      (normalizedAppDir === 'web/app' && normalizedRelPath.startsWith('app/'));

    if (!isInAppDir) continue;

    // Extract route path - handle both web/app and app/ cases
    let routePath;
    if (normalizedRelPath.startsWith(normalizedAppDir)) {
      routePath = relPath.replace(new RegExp(`^${appDir}/?`), '');
    } else if (normalizedAppDir === 'web/app' && normalizedRelPath.startsWith('app/')) {
      routePath = relPath.replace(/^app\/?/, '');
    }

    if (!routePath) continue;
    const segments = routePath.split('/').filter(Boolean);

    // Find parallel routes (@slot)
    const parallelIndex = segments.findIndex(seg => seg.startsWith('@'));
    if (parallelIndex !== -1) {
      const basePath = segments.slice(0, parallelIndex).join('/');
      const slotName = segments[parallelIndex].slice(1); // Remove @ prefix

      if (!parallelRoutes.has(basePath)) {
        parallelRoutes.set(basePath, []);
      }
      parallelRoutes.get(basePath)!.push(slotName);
    }
  }

  return parallelRoutes;
}

/**
 * Determine if a file is a client component based on "use client" directive
 */
export async function isClientComponent(filePath: string, files: FileInfo[]): Promise<boolean> {
  try {
    const content = await readFile(filePath, 'utf-8');

    // Direct "use client" directive
    if (content.includes("'use client'") || content.includes('"use client"')) {
      return true;
    }

    // Check transitive imports for "use client" (simplified version)
    // In a full implementation, this would build a proper dependency graph
    const importRegex = /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g;
    let match;
    while ((match = importRegex.exec(content)) !== null) {
      const importPath = match[1];
      // Resolve relative imports
      if (importPath.startsWith('./') || importPath.startsWith('../')) {
        const resolvedPath = path.resolve(path.dirname(filePath), importPath);
        const resolvedFile = files.find(
          f =>
            f.absPath === resolvedPath + '.tsx' ||
            f.absPath === resolvedPath + '.ts' ||
            f.absPath === resolvedPath + '.jsx' ||
            f.absPath === resolvedPath + '.js'
        );
        if (resolvedFile) {
          // Recursive check (simplified - in practice you'd want to memoize)
          const isImportedClient = await isClientComponent(resolvedFile.absPath, files);
          if (isImportedClient) {
            return true;
          }
        }
      }
    }

    return false;
  } catch (error) {
    logger.warn(`Failed to check client boundary for ${filePath}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Analyze RSC/Client boundaries in the app
 */
export async function analyzeBoundaries(
  files: FileInfo[],
  appDir: string = 'app'
): Promise<BoundaryInfo[]> {
  const boundaries: BoundaryInfo[] = [];
  const componentFiles = files.filter(file => {
    const normalizedRelPath = file.relPath.replace(/\\/g, '/');
    const normalizedAppDir = appDir.replace(/\\/g, '/');

    // Handle case where appDir might be 'web/app' but files are in 'app/'
    const isInAppDir =
      normalizedRelPath.startsWith(normalizedAppDir) ||
      normalizedRelPath.startsWith(normalizedAppDir.replace(/^web\//, '')) ||
      (normalizedAppDir === 'web/app' && normalizedRelPath.startsWith('app/'));

    return (
      isInAppDir &&
      (file.relPath.endsWith('.tsx') || file.relPath.endsWith('.jsx')) &&
      !file.relPath.includes('/route.')
    ); // Route handlers are always server-side
  });

  logger.info(`🔍 Analyzing ${componentFiles.length} component files for RSC boundaries`);

  for (const file of componentFiles) {
    const isClient = await isClientComponent(file.absPath, files);
    const boundaryKind = isClient ? 'client' : 'server';

    // Build parent/child relationships (simplified)
    const parents: string[] = [];
    const children: string[] = [];

    boundaries.push({
      file: file.relPath,
      kind: boundaryKind,
      parents,
      children,
    });
  }

  logger.info(
    `🔍 Found ${boundaries.filter(b => b.kind === 'client').length} client components, ${boundaries.filter(b => b.kind === 'server').length} server components`
  );
  return boundaries;
}

/**
 * Extract HTTP methods from route.ts files
 */
export async function extractRouteMethods(filePath: string): Promise<string[]> {
  try {
    const content = await readFile(filePath, 'utf-8');
    const methods: string[] = [];

    // Match export declarations for HTTP methods
    const methodPattern =
      /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)/g;
    let match;
    while ((match = methodPattern.exec(content)) !== null) {
      methods.push(match[1]);
    }

    // Also check for const/arrow function exports
    const constMethodPattern = /export\s+const\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*=/g;
    while ((match = constMethodPattern.exec(content)) !== null) {
      methods.push(match[1]);
    }

    return methods;
  } catch (error) {
    logger.warn(`Failed to extract methods from ${filePath}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Analyze Next.js app router structure
 */
export async function analyzeRoutes(
  files: FileInfo[],
  appDir: string = 'app'
): Promise<RouteInfo[]> {
  const routes: Map<string, RouteInfo> = new Map();

  // First pass: extract parallel routes
  const parallelRoutesMap = extractParallelRoutes(files, appDir);

  // Group files by their route path
  logger.info(`🔍 Analyzing routes for ${files.length} files in appDir: ${appDir}`);

  for (const file of files) {
    const relPath = file.relPath;

    // Only process files in the app directory
    // Handle case where appDir might be 'web/app' but files are in 'app/'
    const normalizedRelPath = relPath.replace(/\\/g, '/');
    const normalizedAppDir = appDir.replace(/\\/g, '/');

    const isInAppDir =
      normalizedRelPath.startsWith(normalizedAppDir) ||
      normalizedRelPath.startsWith(normalizedAppDir.replace(/^web\//, '')) ||
      (normalizedAppDir === 'web/app' && normalizedRelPath.startsWith('app/'));

    if (!isInAppDir) {
      logger.debug(`Skipping file (not in app dir): ${relPath}`);
      continue;
    }

    logger.debug(`Processing file: ${relPath}`);

    // Extract route path - try both the specified appDir and the actual app directory
    // Always use POSIX-style paths for route calculations
    let routePath = nextRoutePath(normalizedRelPath, appDir);

    // If no route found and appDir is 'web/app', try with just 'app/'
    if (!routePath && appDir === 'web/app' && normalizedRelPath.startsWith('app/')) {
      routePath = nextRoutePath(normalizedRelPath, 'app');
    }

    if (!routePath) continue;

    // Extract route group - try both the specified appDir and the actual app directory
    let routeGroup = extractRouteGroup(normalizedRelPath, appDir);

    // If no route group found and appDir is 'web/app', try with just 'app/'
    if (!routeGroup && appDir === 'web/app' && normalizedRelPath.startsWith('app/')) {
      routeGroup = extractRouteGroup(normalizedRelPath, 'app');
    }

    // Initialize route if not exists
    if (!routes.has(routePath)) {
      routes.set(routePath, {
        path: routePath,
        files: {},
        serverComponents: [],
        clientComponents: [],
        routeGroup,
      });
    }

    const route = routes.get(routePath)!;

    // Classify file type and detect all special files
    if (normalizedRelPath.includes('/page.')) {
      route.files.page = toPosixPath(relPath);
      logger.debug(`📄 Found page: ${relPath} -> route: ${routePath}`);
    } else if (normalizedRelPath.includes('/layout.')) {
      route.files.layout = toPosixPath(relPath);
      logger.debug(`📐 Found layout: ${relPath}`);
    } else if (normalizedRelPath.includes('/route.')) {
      route.files.route = toPosixPath(relPath);
      logger.debug(`🔀 Found route handler: ${relPath}`);
      // Extract HTTP methods from route handlers
      const methods = await extractRouteMethods(file.absPath);
      if (methods.length > 0) {
        // Create separate route entries for each method
        methods.forEach(method => {
          const methodRoute: RouteInfo = {
            method: method as RouteInfo['method'],
            path: routePath,
            files: { route: relPath },
            serverComponents: [],
            clientComponents: [],
            routeGroup,
          };
          routes.set(`${method}:${routePath}`, methodRoute);
        });
        // Remove the generic route entry
        routes.delete(routePath);
      }
    } else if (normalizedRelPath.includes('/loading.')) {
      route.files.loading = toPosixPath(relPath);
    } else if (normalizedRelPath.includes('/error.')) {
      route.files.error = toPosixPath(relPath);
    } else if (normalizedRelPath.includes('/not-found.')) {
      route.files.notFound = toPosixPath(relPath);
    }
  }

  // Second pass: attach parallel routes to their parent routes
  for (const [basePath, slots] of parallelRoutesMap) {
    const routePath = basePath ? `/${basePath}` : '/';
    if (routes.has(routePath)) {
      routes.get(routePath)!.parallelRoutes = slots;
    }
  }

  // Convert map to array and sort
  const routeArray = Array.from(routes.values()).sort((a, b) => a.path.localeCompare(b.path));

  const pageRoutes = routeArray.filter(r => r.files.page);
  logger.info(
    `📍 Analyzed ${routeArray.length} routes (${pageRoutes.length} pages) from ${files.length} files`
  );
  if (pageRoutes.length > 0) {
    logger.info(
      `📄 Pages found:`,
      pageRoutes.map(r => `${r.path} -> ${r.files.page}`)
    );
  }

  return routeArray;
}

/**
 * Utility function to map file paths to POSIX format
 */
export function toPosixPath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}
