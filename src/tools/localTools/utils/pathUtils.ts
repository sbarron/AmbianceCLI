/**
 * @fileOverview: Path utilities for consistent POSIX path handling in JSON outputs
 * @module: PathUtils
 * @keyFunctions:
 *   - toPosix(): Convert Windows paths to POSIX format for JSON portability
 *   - nextAppRouteToPath(): Convert Next.js App Router file paths to URL paths
 *   - isServerishPath(): Check if path represents server-side code
 * @context: Ensures consistent path formatting across different platforms
 */

/**
 * Convert Windows backslashes to POSIX forward slashes for JSON portability
 */
export const toPosix = (p: string): string => p.replace(/\\/g, '/');

/**
 * Convert Next.js App Router file path to URL path with proper dynamic segment handling
 * Example: ".../app/api/subscription/api-keys/route.ts" -> "/api/subscription/api-keys"
 */
export function nextAppRouteToPath(absFile: string, appRoot?: string): string {
  // Normalize to POSIX format
  const normalized = toPosix(absFile);

  // Extract relative path from app directory
  let relativePath: string;

  if (appRoot) {
    const appRootPosix = toPosix(appRoot);
    const splitResult = normalized.split(appRootPosix + '/')[1];
    if (!splitResult) {
      return '/'; // fallback
    }
    relativePath = splitResult;
  } else {
    // Try to find app directory in path
    const appMatch = normalized.match(/\/app\/(.*)\/route\.(ts|js)$/);
    if (!appMatch) {
      return '/'; // fallback
    }
    relativePath = appMatch[1];
  }

  // Remove route file extension
  const pathWithoutRoute = relativePath.replace(/\/route\.(ts|js)x?$/i, '');

  // Split into segments and filter out segment groups like (auth)
  const segments = pathWithoutRoute
    .split('/')
    .filter(Boolean)
    .filter(seg => !/^\(.*\)$/.test(seg));

  // Convert dynamic segments: [id] -> :id, [...slug] -> *slug
  const processedSegments = segments.map(seg =>
    seg.replace(/^\[(\.\.\.)?(.+)\]$/, (_, splat, name) => (splat ? `*${name}` : `:${name}`))
  );

  // Join with / and ensure single leading /
  return '/' + processedSegments.join('/');
}

/**
 * Check if a POSIX path represents server-side code (not UI/client code)
 */
export function isServerishPath(posixPath: string): boolean {
  return /(\/|^)(api|server|mcpServer|worker|lib|core|utils|services|handlers|middleware)\//.test(
    posixPath
  );
}

/**
 * Check if a POSIX path represents a client-side/UI file that should be excluded from server analysis
 */
export function isClientPath(posixPath: string): boolean {
  const clientPatterns = [
    /\/components\//,
    /\/pages\/(?!api)/, // pages but not pages/api
    /\/app\/.*(?<!\/route)\.(tsx?)$/, // app directory files except route files
    /\/(web|client|frontend)\//,
    /\/(portal|viewer|modals)\//,
    /\/__tests__\//,
    /\.(test|spec)\./,
  ];

  return clientPatterns.some(pattern => pattern.test(posixPath));
}

/**
 * Normalize file paths for consistent comparison and JSON output
 */
export function normalizeFilePath(filePath: string): string {
  return toPosix(filePath);
}

/**
 * Extract relative path from absolute path based on project root
 */
export function getRelativePath(absPath: string, projectRoot: string): string {
  const absPathPosix = toPosix(absPath);
  const projectRootPosix = toPosix(projectRoot);

  if (absPathPosix.startsWith(projectRootPosix)) {
    const relative = absPathPosix.substring(projectRootPosix.length);
    return relative.startsWith('/') ? relative.substring(1) : relative;
  }

  return absPathPosix;
}
