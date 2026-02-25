/**
 * @fileOverview: Path utilities for tool operations
 * @module: PathUtils
 * @keyFunctions:
 *   - validateAndResolvePath(): Validate and resolve project paths safely
 *   - isValidPath(): Check if path is valid and secure
 * @dependencies:
 *   - path: Node.js path operations
 *   - fs: File system access
 * @context: Provides secure path validation and resolution for tools
 */

import * as path from 'path';
import * as fs from 'fs';

/**
 * Validate and resolve a path safely
 */
export function validateAndResolvePath(inputPath: string, basePath?: string): string {
  if (!inputPath || typeof inputPath !== 'string') {
    throw new Error('Invalid path provided');
  }

  // Handle relative vs absolute paths
  let resolvedPath: string;
  if (path.isAbsolute(inputPath)) {
    resolvedPath = path.resolve(inputPath);
  } else {
    const base = basePath || process.cwd();
    resolvedPath = path.resolve(base, inputPath);
  }

  // Basic security check - ensure path doesn't try to escape reasonable bounds
  if (resolvedPath.includes('..')) {
    const normalized = path.normalize(resolvedPath);
    if (normalized !== resolvedPath) {
      throw new Error('Path traversal detected');
    }
  }

  // Check if path exists
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Path does not exist: ${resolvedPath}`);
  }

  // Return the resolved path with original case for file operations
  return resolvedPath;
}

/**
 * Check if a path is valid and secure
 */
export function isValidPath(inputPath: string): boolean {
  try {
    validateAndResolvePath(inputPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get relative path safely
 */
export function getRelativePath(from: string, to: string): string {
  return path.relative(from, to);
}

/**
 * Resolve workspace path with environment variable support
 */
export function resolveWorkspacePath(inputPath?: string): string {
  if (inputPath) {
    return validateAndResolvePath(inputPath);
  }

  // Check for workspace environment variables
  const workspaceFolder = process.env.WORKSPACE_FOLDER;
  if (workspaceFolder) {
    return validateAndResolvePath(workspaceFolder);
  }

  // Fallback: Try to detect workspace from current directory structure
  // This is a safety net for when WORKSPACE_FOLDER is not set
  const detectedWorkspace = detectWorkspaceDirectory();
  if (detectedWorkspace && detectedWorkspace !== process.cwd()) {
    const { logger } = require('../../utils/logger');
    logger.info('🔍 Auto-detected workspace directory (fallback):', { detectedWorkspace });
    return detectedWorkspace;
  }

  // Default to current working directory
  return process.cwd();
}

/**
 * Detect workspace directory from current directory with smart project detection,
 * falling back to environment variable if no project structure is found.
 */
export function detectWorkspaceDirectory(): string {
  const cwd = process.cwd();

  // First, check current working directory
  if (hasProjectStructure(cwd)) {
    return cwd;
  }

  // Walk up the directory tree to find a project root
  let currentDir = cwd;
  const maxLevelsUp = 5; // Prevent infinite recursion

  for (let i = 0; i < maxLevelsUp; i++) {
    if (hasProjectStructure(currentDir)) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      // Reached filesystem root
      break;
    }
    currentDir = parentDir;
  }

  // If no project root is found by traversing up, fallback to workspace env var
  const workspaceFolder = process.env.WORKSPACE_FOLDER;
  if (workspaceFolder && fs.existsSync(workspaceFolder)) {
    const { logger } = require('../../utils/logger');
    logger.info('Using configured workspace folder as fallback', { workspace: workspaceFolder });
    return workspaceFolder;
  }

  // If we still haven't found a project, check if current directory looks suspicious
  const cwdFileCount = fs.existsSync(cwd) ? fs.readdirSync(cwd).length : 0;
  if (cwdFileCount > 1000) {
    const { logger } = require('../../utils/logger');
    logger.warn('Current working directory appears to be a system directory with many files', {
      cwd,
      fileCount: cwdFileCount,
    });

    // Try some common development directories as fallbacks
    const commonDevPaths = [
      path.join(process.env.HOME || process.env.USERPROFILE || '', 'dev'),
      path.join(process.env.HOME || process.env.USERPROFILE || '', 'projects'),
      path.join(process.env.HOME || process.env.USERPROFILE || '', 'Documents', 'dev'),
    ].filter(p => fs.existsSync(p));

    if (commonDevPaths.length > 0) {
      logger.info('Using common development directory as fallback', { path: commonDevPaths[0] });
      return commonDevPaths[0];
    }
  }

  return cwd;
}

/**
 * Check if directory has project structure (basic check)
 */
export function hasProjectStructure(dirPath: string): boolean {
  try {
    const stats = fs.statSync(dirPath);
    if (!stats.isDirectory()) return false;

    const files = fs.readdirSync(dirPath);

    // Look for common project indicators
    const projectIndicators = [
      'package.json',
      'tsconfig.json',
      'Cargo.toml',
      'go.mod',
      'requirements.txt',
      'pom.xml',
      'build.gradle',
      '.git',
    ];

    return projectIndicators.some(indicator => files.includes(indicator));
  } catch {
    return false;
  }
}

/**
 * Log path configuration for debugging
 */
export function logPathConfiguration(basePath?: string): void {
  const workspaceFolder = process.env.WORKSPACE_FOLDER;
  const currentDir = process.cwd();
  const resolvedBase = basePath || currentDir;

  // Use logger instead of console.log to avoid breaking MCP JSON protocol
  const { logger } = require('../../utils/logger');

  logger.info('Path Configuration:', {
    WORKSPACE_FOLDER: workspaceFolder || 'not set',
    currentDirectory: currentDir,
    resolvedBase: resolvedBase,
    hasProjectStructure: hasProjectStructure(resolvedBase),
  });

  // Only log environment variables if WORKSPACE_FOLDER is not set (to avoid spam when working)
  if (!workspaceFolder) {
    // Debug: Log all environment variables containing "WORKSPACE" for troubleshooting
    const workspaceEnvVars = Object.keys(process.env)
      .filter(key => key.includes('WORKSPACE'))
      .reduce((obj, key) => {
        obj[key] = process.env[key];
        return obj;
      }, {} as any);
    logger.info('🔧 Environment variables containing WORKSPACE:', workspaceEnvVars);
  }
}
