/**
 * @fileOverview: Filesystem security guard providing secure path handling and validation
 * @module: FSGuard
 * @keyFunctions:
 *   - guardPath(): Safely resolve and validate file paths
 *   - readFile(): Secure file reading with path validation
 *   - listDirectory(): Safe directory listing with filtering
 *   - validatePath(): Check if path is within allowed bounds
 * @dependencies:
 *   - fs: File system operations and realpath resolution
 *   - path: Path manipulation and normalization
 *   - logger: Logging utilities for security events
 * @context: Security layer that prevents path traversal attacks and ensures all filesystem operations are within allowed directory bounds
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';

export interface FSGuardConfig {
  baseDir: string;
  allowAbsolutePaths?: boolean;
  maxPathLength?: number;
}

export interface GuardedPath {
  original: string;
  normalized: string;
  canonical: string;
  relative: string;
  isWithinBase: boolean;
}

/**
 * Filesystem guard that provides secure path handling and validation.
 * All filesystem operations should go through this guard.
 */
export class FSGuard {
  private baseDir: string;
  private canonicalBaseDir: string;
  private allowAbsolutePaths: boolean;
  private maxPathLength: number;

  constructor(config: FSGuardConfig) {
    this.baseDir = path.resolve(config.baseDir);
    // Normalize baseDir to realpath where possible; fall back to resolved path when mocked or unavailable
    try {
      const realBase = fs.realpathSync(this.baseDir);
      this.canonicalBaseDir = realBase || this.baseDir;
    } catch {
      this.canonicalBaseDir = this.baseDir;
    }
    this.allowAbsolutePaths = config.allowAbsolutePaths || false;
    this.maxPathLength = config.maxPathLength || 1000;

    logger.info(`FSGuard initialized with baseDir: ${this.canonicalBaseDir}`);
  }

  /**
   * Safely resolve and validate a path.
   */
  async guardPath(inputPath: string): Promise<GuardedPath> {
    if (!inputPath || typeof inputPath !== 'string') {
      throw new FSGuardError('PATH_INVALID', `Invalid path input: ${inputPath}`, {
        input: inputPath,
        suggestion: 'Provide a valid string path',
      });
    }

    if (inputPath.length > this.maxPathLength) {
      throw new FSGuardError(
        'PATH_TOO_LONG',
        `Path exceeds maximum length (${this.maxPathLength})`,
        {
          input: inputPath,
          length: inputPath.length,
          suggestion: 'Use shorter path names',
        }
      );
    }

    // Normalize path (convert separators, resolve '..' and '.')
    const normalized = path.normalize(inputPath);

    // Check for null bytes (security)
    if (normalized.includes('\0')) {
      throw new FSGuardError('PATH_NULL_BYTE', 'Path contains null bytes', {
        input: inputPath,
        suggestion: 'Remove null bytes from path',
      });
    }

    // Resolve to absolute path
    let absolutePath: string;
    if (path.isAbsolute(normalized)) {
      if (!this.allowAbsolutePaths) {
        throw new FSGuardError('ABSOLUTE_PATH_FORBIDDEN', 'Absolute paths are not allowed', {
          input: inputPath,
          suggestion: 'Use relative paths only',
        });
      }
      absolutePath = normalized;
    } else {
      absolutePath = path.resolve(this.baseDir, normalized);
    }

    // Get canonical path (resolve symlinks)
    let canonical: string;
    try {
      const rp = await fs.promises.realpath(absolutePath);
      canonical = typeof rp === 'string' && rp.length > 0 ? rp : absolutePath;
    } catch (error) {
      // If file doesn't exist, we still validate the directory structure
      const parentDir = path.dirname(absolutePath);
      try {
        const canonicalParentRaw = await fs.promises.realpath(parentDir);
        const canonicalParent =
          typeof canonicalParentRaw === 'string' && canonicalParentRaw.length > 0
            ? canonicalParentRaw
            : parentDir;
        canonical = path.join(canonicalParent, path.basename(absolutePath));
      } catch {
        throw new FSGuardError('PATH_INVALID', `Cannot resolve path: ${inputPath}`, {
          input: inputPath,
          resolved: absolutePath,
          suggestion: 'Ensure parent directory exists',
        });
      }
    }

    // Check if path is within base directory (cross-OS safe)
    // Use path.relative to avoid false positives with shared prefixes
    const relFromBase = path.relative(this.canonicalBaseDir, canonical);
    const isWithinBase =
      relFromBase === '' || (!relFromBase.startsWith('..') && !path.isAbsolute(relFromBase));

    if (!isWithinBase) {
      throw new FSGuardError('PATH_OUTSIDE_BASE', 'Path is outside the allowed base directory', {
        input: inputPath,
        canonical: canonical,
        baseDir: this.canonicalBaseDir,
        suggestion: 'Use paths within the project directory only',
      });
    }

    const relative = path.normalize(path.relative(this.canonicalBaseDir, canonical));

    return {
      original: inputPath,
      normalized,
      canonical,
      relative,
      isWithinBase,
    };
  }

  /**
   * Safe file read with path validation.
   */
  async readFile(filePath: string, encoding: BufferEncoding = 'utf8'): Promise<string> {
    const guardedPath = await this.guardPath(filePath);

    try {
      return await fs.promises.readFile(guardedPath.canonical, encoding);
    } catch (error) {
      throw new FSGuardError('FILE_READ_ERROR', `Cannot read file: ${filePath}`, {
        input: filePath,
        canonical: guardedPath.canonical,
        originalError: error instanceof Error ? error.message : String(error),
        suggestion: 'Ensure file exists and is readable',
      });
    }
  }

  /**
   * Safe file stat with path validation.
   */
  async stat(filePath: string): Promise<fs.Stats> {
    const guardedPath = await this.guardPath(filePath);

    try {
      return await fs.promises.stat(guardedPath.canonical);
    } catch (error) {
      throw new FSGuardError('FILE_STAT_ERROR', `Cannot stat file: ${filePath}`, {
        input: filePath,
        canonical: guardedPath.canonical,
        originalError: error instanceof Error ? error.message : String(error),
        suggestion: 'Ensure file exists',
      });
    }
  }

  /**
   * Safe directory listing with path validation.
   */
  async readdir(dirPath: string): Promise<fs.Dirent[]> {
    const guardedPath = await this.guardPath(dirPath);

    try {
      return await fs.promises.readdir(guardedPath.canonical, { withFileTypes: true });
    } catch (error) {
      throw new FSGuardError('DIR_READ_ERROR', `Cannot read directory: ${dirPath}`, {
        input: dirPath,
        canonical: guardedPath.canonical,
        originalError: error instanceof Error ? error.message : String(error),
        suggestion: 'Ensure directory exists and is readable',
      });
    }
  }

  /**
   * Check if path exists safely.
   */
  async exists(filePath: string): Promise<boolean> {
    try {
      const guardedPath = await this.guardPath(filePath);
      await fs.promises.access(guardedPath.canonical);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the base directory.
   */
  getBaseDir(): string {
    return this.canonicalBaseDir;
  }

  /**
   * Validate multiple paths at once.
   */
  async guardPaths(paths: string[]): Promise<GuardedPath[]> {
    const results: GuardedPath[] = [];
    const errors: FSGuardError[] = [];

    for (let i = 0; i < paths.length; i++) {
      try {
        const guardedPath = await this.guardPath(paths[i]);
        results.push(guardedPath);
      } catch (error) {
        if (error instanceof FSGuardError) {
          errors.push(error);
        } else {
          errors.push(
            new FSGuardError('PATH_VALIDATION_ERROR', `Error validating path ${i}: ${paths[i]}`, {
              input: paths[i],
              index: i,
              originalError: error instanceof Error ? error.message : String(error),
            })
          );
        }
      }
    }

    if (errors.length > 0) {
      throw new FSGuardError('MULTIPLE_PATH_ERRORS', `Failed to validate ${errors.length} paths`, {
        errors: errors.map(e => ({ code: e.code, message: e.message, context: e.context })),
        suggestion: 'Fix path validation errors before proceeding',
      });
    }

    return results;
  }
}

/**
 * Structured error class for filesystem guard operations.
 */
export class FSGuardError extends Error {
  public readonly code: string;
  public readonly context: Record<string, any>;

  constructor(code: string, message: string, context: Record<string, any> = {}) {
    super(message);
    this.name = 'FSGuardError';
    this.code = code;
    this.context = context;
  }

  /**
   * Get a structured error response for MCP tools.
   */
  toStructured(): {
    error: {
      code: string;
      message: string;
      context: Record<string, any>;
      suggestion?: string;
      examples?: Record<string, any>;
    };
  } {
    return {
      error: {
        code: this.code,
        message: this.message,
        context: this.context,
        suggestion: this.context.suggestion,
        examples: this.getExamples(),
      },
    };
  }

  private getExamples(): Record<string, any> {
    switch (this.code) {
      case 'PATH_OUTSIDE_BASE':
        return {
          good_call: { filePath: 'src/components/Button.tsx' },
          bad_call: { filePath: '../../../etc/passwd' },
        };
      case 'ABSOLUTE_PATH_FORBIDDEN':
        return {
          good_call: { filePath: 'src/utils/helpers.ts' },
          bad_call: { filePath: '/home/user/project/src/helpers.ts' },
        };
      default:
        return {};
    }
  }
}
