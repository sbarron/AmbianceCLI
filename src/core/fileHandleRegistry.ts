/**
 * @fileOverview: Secure file handle registry that prevents path traversal and provides opaque file IDs
 * @module: FileHandleRegistry
 * @keyFunctions:
 *   - discoverFiles(): Find files in base directory and return secure handles
 *   - getHandle(): Retrieve file handle by ID with path validation
 *   - reset(): Clear registry and set new base directory
 *   - validatePath(): Ensure paths are within allowed directory bounds
 * @dependencies:
 *   - fs: File system operations and path resolution
 *   - path: Path manipulation and normalization
 *   - uuid: Generate unique file identifiers
 *   - logger: Logging utilities
 * @context: Security layer that prevents path traversal attacks by providing opaque file IDs instead of raw paths to MCP tools
 */

import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';

export interface FileHandle {
  fileId: string;
  absPath: string;
  relPath: string;
  ext: string;
  size: number;
  lastModified: Date;
  baseDir: string;
}

export interface FileDiscoveryOptions {
  baseDir: string;
  extensions?: string[];
  maxFiles?: number;
  maxSize?: number; // bytes
  ignorePatterns?: string[];
}

/**
 * Secure file handle registry that prevents path traversal and provides
 * opaque file IDs to MCP tools instead of raw paths.
 */
export class FileHandleRegistry {
  private handles = new Map<string, FileHandle>();
  private pathToId = new Map<string, string>();
  private baseDir: string | null = null;

  constructor() {
    this.reset();
  }

  /**
   * Reset the registry and set a new base directory.
   * All previously issued handles become invalid.
   */
  reset(baseDir?: string): void {
    this.handles.clear();
    this.pathToId.clear();
    if (baseDir) {
      // Normalize and resolve symlinks for consistent comparisons
      const resolved = path.resolve(baseDir);
      try {
        this.baseDir = fs.realpathSync(resolved);
      } catch {
        this.baseDir = resolved;
      }
      logger.info(`FileHandleRegistry reset with baseDir: ${this.baseDir}`);
    }
  }

  /**
   * Discover files in the base directory and return secure handles.
   */
  async discoverFiles(options: FileDiscoveryOptions): Promise<{
    handles: FileHandle[];
    report: {
      candidatesFound: number;
      extensionFiltered: number;
      sizeFiltered: number;
      supported: number;
      ignored: number;
    };
  }> {
    if (!this.baseDir) {
      this.baseDir = path.resolve(options.baseDir);
    }

    const report = {
      candidatesFound: 0,
      extensionFiltered: 0,
      sizeFiltered: 0,
      supported: 0,
      ignored: 0,
    };

    const extensions = options.extensions || ['.ts', '.tsx', '.js', '.jsx', '.py', '.md'];
    const maxFiles = options.maxFiles || 1000;
    const maxSize = options.maxSize || 10 * 1024 * 1024; // 10MB default
    const ignorePatterns = options.ignorePatterns || [
      'node_modules',
      '.git',
      'dist',
      'build',
      '.next',
      '__pycache__',
      '*.min.js',
      '*.bundle.js',
      '.env*',
    ];

    const handles: FileHandle[] = [];
    const discoveredPaths = new Set<string>();

    const traverseDirectory = async (dir: string): Promise<void> => {
      if (handles.length >= maxFiles) return;

      try {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
          if (handles.length >= maxFiles) break;

          const fullPath = path.join(dir, entry.name);
          report.candidatesFound++;

          // Check ignore patterns
          const shouldIgnore = ignorePatterns.some(pattern => {
            if (pattern.includes('*')) {
              const regex = new RegExp(pattern.replace(/\*/g, '.*'));
              return regex.test(entry.name) || regex.test(fullPath);
            }
            return entry.name === pattern || fullPath.includes(pattern);
          });

          if (shouldIgnore) {
            report.ignored++;
            continue;
          }

          if (entry.isDirectory()) {
            await traverseDirectory(fullPath);
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name);

            if (!extensions.includes(ext)) {
              report.extensionFiltered++;
              continue;
            }

            const stats = await fs.promises.stat(fullPath);
            if (stats.size > maxSize) {
              report.sizeFiltered++;
              continue;
            }

            // Ensure path is within base directory (security check)
            // Normalize and realpath parent; keep filename to support non-existent files during discovery filtering
            let canonicalPath = path.resolve(fullPath);
            try {
              const parentDir = path.dirname(canonicalPath);
              const canonicalParentRaw = fs.realpathSync(parentDir);
              const canonicalParent =
                typeof canonicalParentRaw === 'string' && canonicalParentRaw.length > 0
                  ? canonicalParentRaw
                  : parentDir;
              canonicalPath = path.join(canonicalParent, path.basename(canonicalPath));
            } catch {
              // If realpath fails, keep resolved path
            }

            // Cross-OS within-base check via path.relative
            const relFromBase = path.relative(this.baseDir!, canonicalPath);
            if (relFromBase.startsWith('..') || path.isAbsolute(relFromBase)) {
              logger.warn(`Skipping file outside base directory: ${canonicalPath}`);
              report.ignored++;
              continue;
            }

            if (!discoveredPaths.has(canonicalPath)) {
              discoveredPaths.add(canonicalPath);
              const handle = await this.createHandle(canonicalPath, stats);
              handles.push(handle);
              report.supported++;
            }
          }
        }
      } catch (error) {
        logger.warn(`Error traversing directory ${dir}:`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };

    await traverseDirectory(this.baseDir);

    logger.info(
      `File discovery complete: ${report.supported} files indexed from ${report.candidatesFound} candidates`
    );
    return { handles, report };
  }

  /**
   * Create a secure handle for a file path.
   */
  private async createHandle(absPath: string, stats?: fs.Stats): Promise<FileHandle> {
    // Use resolved absolute path; avoid realpath on files to preserve test mocks and performance
    const canonicalPath = path.resolve(absPath);

    // Reuse existing handle if path already registered
    const existingId = this.pathToId.get(canonicalPath);
    if (existingId && this.handles.has(existingId)) {
      return this.handles.get(existingId)!;
    }

    if (!this.baseDir) {
      throw new Error('Base directory not set');
    }

    // Security: ensure path is within base directory
    const relFromBase = path.relative(this.baseDir, canonicalPath);
    if (relFromBase.startsWith('..') || path.isAbsolute(relFromBase)) {
      throw new Error(`Path outside base directory: ${canonicalPath}`);
    }

    if (!stats) {
      stats = await fs.promises.stat(canonicalPath);
    }

    const fileId = uuidv4();
    const relPath = path.normalize(path.relative(this.baseDir, canonicalPath));
    const ext = path.extname(canonicalPath);

    const handle: FileHandle = {
      fileId,
      absPath: canonicalPath,
      relPath,
      ext,
      size: stats.size,
      lastModified: stats.mtime,
      baseDir: this.baseDir,
    };

    this.handles.set(fileId, handle);
    this.pathToId.set(canonicalPath, fileId);

    return handle;
  }

  /**
   * Get a file handle by ID.
   */
  getHandle(fileId: string): FileHandle | null {
    return this.handles.get(fileId) || null;
  }

  /**
   * Get all registered handles.
   */
  getAllHandles(): FileHandle[] {
    return Array.from(this.handles.values());
  }

  /**
   * Get handles filtered by extension.
   */
  getHandlesByExtension(extensions: string[]): FileHandle[] {
    return Array.from(this.handles.values()).filter(h => extensions.includes(h.ext));
  }

  /**
   * Validate that a file ID exists and return the handle.
   */
  validateFileId(fileId: string): FileHandle {
    const handle = this.handles.get(fileId);
    if (!handle) {
      throw new Error(`Invalid file ID: ${fileId}`);
    }
    return handle;
  }

  /**
   * Check if a file still exists on disk.
   */
  async isFileValid(fileId: string): Promise<boolean> {
    const handle = this.getHandle(fileId);
    if (!handle) return false;

    try {
      const stats = await fs.promises.stat(handle.absPath);
      return stats.isFile();
    } catch {
      return false;
    }
  }

  /**
   * Remove a handle from the registry.
   */
  removeHandle(fileId: string): void {
    const handle = this.handles.get(fileId);
    if (handle) {
      this.handles.delete(fileId);
      this.pathToId.delete(handle.absPath);
    }
  }

  /**
   * Get registry statistics.
   */
  getStats(): {
    totalHandles: number;
    byExtension: Record<string, number>;
    baseDir: string | null;
  } {
    const byExtension: Record<string, number> = {};

    for (const handle of this.handles.values()) {
      byExtension[handle.ext] = (byExtension[handle.ext] || 0) + 1;
    }

    return {
      totalHandles: this.handles.size,
      byExtension,
      baseDir: this.baseDir,
    };
  }
}

// Singleton instance
export const fileHandleRegistry = new FileHandleRegistry();
