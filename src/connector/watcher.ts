/**
 * @fileOverview: File system watcher with debounced synchronization to cloud service
 * @module: ConnectorWatcher
 * @keyFunctions:
 *   - start(): Initialize file system watching with ignore pattern filtering
 *   - stop(): Clean up watcher and cancel pending operations
 *   - onChange(): Handle file change events with debouncing
 *   - flush(): Execute debounced synchronization to cloud service
 * @dependencies:
 *   - fs: File system watching and change detection
 *   - path: Path manipulation and resolution
 *   - projectIdentifier: Ignore pattern loading and file filtering
 *   - fileSyncClient: Cloud service synchronization
 *   - logger: Logging utilities for watcher events
 * @context: Provides intelligent file system monitoring with debounced synchronization, preventing excessive API calls while ensuring timely cloud service updates
 */

import * as fs from 'fs';
import * as path from 'path';
import { loadIgnorePatterns, shouldIgnoreFile } from '../local/projectIdentifier';
import { syncProject } from './fileSyncClient';
import { logger } from '../utils/logger';

export interface WatcherOptions {
  baseDir: string;
  debounceMs?: number;
}

export class ConnectorWatcher {
  private baseDir: string;
  private debounceMs: number;
  private pending = false;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private watcher: fs.FSWatcher | null = null;
  private ignorePatterns: string[] = [];

  constructor(options: WatcherOptions) {
    this.baseDir = path.resolve(options.baseDir);
    this.debounceMs = options.debounceMs ?? 1500;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.ignorePatterns = await loadIgnorePatterns(this.baseDir);
    this.watcher = fs.watch(this.baseDir, { recursive: true }, (event, filename) => {
      if (!filename) return;
      const rel = filename.replace(/\\/g, '/');
      if (shouldIgnoreFile(rel, this.ignorePatterns)) return;
      this.onChange();
    });
    this.running = true;
    logger.info('🔭 Connector watcher started', { baseDir: this.baseDir });
  }

  stop(): void {
    if (!this.running) return;
    this.watcher?.close();
    this.watcher = null;
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending = false;
    logger.info('🛑 Connector watcher stopped');
  }

  private onChange(): void {
    this.pending = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.debounceMs);
  }

  private async flush(): Promise<void> {
    if (!this.pending) return;
    this.pending = false;
    try {
      const result = await syncProject(this.baseDir);
      logger.info('☁️ Debounced sync complete', result);
    } catch (error) {
      logger.warn('⚠️ Debounced sync failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
