/**
 * @fileOverview: Workspace folder validation utilities
 * @module: WorkspaceValidator
 * @keyFunctions:
 *   - validateWorkspaceFolder(): Validate a potential workspace directory
 *   - countFilesInDirectory(): Count files recursively with limits
 *   - isRootDrive(): Check if path is root drive
 * @context: Provides safe workspace validation to prevent performance issues
 */

import { promises as fs, existsSync } from 'fs';
import { join, parse, resolve } from 'path';
import { logger } from '../../utils/logger';

export interface WorkspaceValidationResult {
  isValid: boolean;
  path?: string;
  fileCount?: number;
  error?: string;
  warnings?: string[];
}

export interface WorkspaceValidationOptions {
  maxFiles?: number;
  excludePatterns?: string[];
  allowHiddenFolders?: boolean;
}

/**
 * Validate a workspace folder for safety and performance
 */
export async function validateWorkspaceFolder(
  folderPath: string,
  options: WorkspaceValidationOptions = {}
): Promise<WorkspaceValidationResult> {
  const { maxFiles = 5000, excludePatterns = [], allowHiddenFolders = false } = options;

  logger.info('🔍 Validating workspace folder', {
    path: folderPath,
    maxFiles,
    excludePatterns,
    allowHiddenFolders,
  });

  try {
    // Resolve to absolute path
    const resolvedPath = resolve(folderPath);

    // Check if path exists
    if (!existsSync(resolvedPath)) {
      return {
        isValid: false,
        error: `Path does not exist: ${resolvedPath}`,
      };
    }

    // Check if it's a directory
    const stats = await fs.stat(resolvedPath);
    if (!stats.isDirectory()) {
      return {
        isValid: false,
        error: `Path is not a directory: ${resolvedPath}`,
      };
    }

    // Check if it's a root drive
    if (isRootDrive(resolvedPath)) {
      return {
        isValid: false,
        error: `Cannot use root drive as workspace: ${resolvedPath}. This would scan the entire system and cause performance issues.`,
      };
    }

    // Check for common problematic directories
    const problematicDirs = ['node_modules', 'dist', 'build', '.git', 'target', 'bin', 'obj'];
    const pathLower = resolvedPath.toLowerCase();
    const isProblematic = problematicDirs.some(
      dir =>
        pathLower.includes(`${dir}\\`) || pathLower.includes(`${dir}/`) || pathLower.endsWith(dir)
    );

    const warnings: string[] = [];
    if (isProblematic) {
      warnings.push(
        'Workspace appears to be inside a build/dependency directory. Consider using parent directory.'
      );
    }

    // Count files with limit
    logger.debug('📊 Counting files in workspace directory');
    const fileCount = await countFilesInDirectory(resolvedPath, {
      maxCount: maxFiles + 500, // Count a bit over limit for accurate reporting
      excludePatterns: [
        // Dependencies and packages
        'node_modules/**',
        'vendor/**',
        'packages/**/*.tgz',
        'bower_components/**',
        '.pnpm-store/**',
        '.yarn/**',
        '.pnp.js',

        // Build outputs and artifacts
        'dist/**',
        'build/**',
        'out/**',
        'target/**',
        'bin/**',
        'obj/**',
        '*.exe',
        '*.dll',
        '*.so',
        '*.dylib',
        '*.a',
        '*.lib',
        '*.o',
        '*.class',
        '*.jar',
        '*.war',

        // Version control and git
        '.git/**',
        '.svn/**',
        '.hg/**',
        '.bzr/**',

        // IDE and editor files
        '.vscode/**',
        '.idea/**',
        '*.swp',
        '*.swo',
        '*~',
        '.DS_Store',
        'Thumbs.db',

        // Temporary and cache files
        'tmp/**',
        'temp/**',
        'cache/**',
        '*.tmp',
        '*.temp',
        '*.cache',
        '*.log',
        '*.pid',

        // Framework-specific
        '.next/**',
        '.nuxt/**',
        '.angular/**',
        '.svelte-kit/**',
        'coverage/**',
        '.nyc_output/**',
        'jest-cache/**',
        '.pytest_cache/**',
        '__pycache__/**',
        '*.pyc',
        '*.pyo',

        // Media and binary files (we don't analyze these)
        '*.jpg',
        '*.jpeg',
        '*.png',
        '*.gif',
        '*.svg',
        '*.ico',
        '*.webp',
        '*.mp4',
        '*.avi',
        '*.mov',
        '*.mp3',
        '*.wav',
        '*.pdf',
        '*.zip',
        '*.tar',
        '*.gz',
        '*.rar',
        '*.7z',

        // Database files
        '*.db',
        '*.sqlite',
        '*.sqlite3',

        // Maps and generated files
        '*.map',
        '*.min.js',
        '*.min.css',

        // Documentation builds
        'docs/build/**',
        'site/**',
        '_site/**',
        'public/**/*.html',

        // Custom excludes
        ...excludePatterns,
      ],
      allowHiddenFolders,
    });

    // Check file count limit
    if (fileCount.total > maxFiles) {
      return {
        isValid: false,
        path: resolvedPath,
        fileCount: fileCount.total,
        error:
          `Workspace contains too many files (${fileCount.total} > ${maxFiles}). This could cause performance issues. Consider:\n` +
          `- Using a more specific subdirectory\n` +
          `- Adding more exclude patterns\n` +
          `- Files by type: ${JSON.stringify(fileCount.byType, null, 2)}`,
      };
    }

    logger.info('✅ Workspace validation passed', {
      path: resolvedPath,
      fileCount: fileCount.total,
      warnings: warnings.length,
    });

    return {
      isValid: true,
      path: resolvedPath,
      fileCount: fileCount.total,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  } catch (error) {
    logger.error('❌ Workspace validation failed', {
      path: folderPath,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      isValid: false,
      error: `Failed to validate workspace: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Check if a path is a root drive (C:\, /, etc.)
 */
export function isRootDrive(path: string): boolean {
  const resolved = resolve(path);
  const parsed = parse(resolved);

  // Windows: Check if it's just the root (C:\, D:\, etc.)
  if (process.platform === 'win32') {
    return resolved === parsed.root || resolved === parsed.root.replace('\\', '');
  }

  // Unix: Check if it's just the root (/)
  return resolved === '/' || resolved === parsed.root;
}

/**
 * Count files in directory with performance limits
 */
export async function countFilesInDirectory(
  dirPath: string,
  options: {
    maxCount?: number;
    excludePatterns?: string[];
    allowHiddenFolders?: boolean;
  } = {}
): Promise<{ total: number; byType: Record<string, number> }> {
  const { maxCount = 5000, excludePatterns = [], allowHiddenFolders = false } = options;

  const result = { total: 0, byType: {} as Record<string, number> };
  const stack: string[] = [dirPath];

  // Convert glob patterns to regex
  const excludeRegexes = excludePatterns.map(
    pattern =>
      new RegExp(pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/\\\\]*').replace(/\?/g, '.'))
  );

  while (stack.length > 0 && result.total < maxCount) {
    const currentDir = stack.pop()!;

    try {
      const entries = await fs.readdir(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        if (result.total >= maxCount) break;

        const fullPath = join(currentDir, entry.name);
        const relativePath = fullPath.replace(dirPath, '').replace(/^[\\/]/, '');

        // Skip hidden folders unless allowed
        if (!allowHiddenFolders && entry.name.startsWith('.')) {
          continue;
        }

        // Check exclusion patterns
        const shouldExclude = excludeRegexes.some(regex => regex.test(relativePath));
        if (shouldExclude) {
          continue;
        }

        if (entry.isDirectory()) {
          stack.push(fullPath);
        } else if (entry.isFile()) {
          result.total++;

          // Track by extension
          const ext = parse(entry.name).ext.toLowerCase() || 'no-extension';
          result.byType[ext] = (result.byType[ext] || 0) + 1;
        }
      }
    } catch (error) {
      // Skip directories we can't read (permissions, etc.)
      logger.debug('Skipping directory due to access error', {
        dir: currentDir,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}

/**
 * Get current workspace folder from environment
 */
export function getCurrentWorkspaceFolder(): string | undefined {
  return process.env.WORKSPACE_FOLDER || process.env.AMBIANCE_BASE_DIR;
}

/**
 * Set workspace folder in environment (for current process only)
 */
export function setWorkspaceFolder(path: string): void {
  process.env.WORKSPACE_FOLDER = path;
  logger.info('🏠 Workspace folder set', { workspacePath: path });
}
