/**
 * @fileOverview: Central resource registry that tracks and auto-disposes resources to prevent memory leaks
 * @module: ResourceGuard
 * @keyFunctions:
 *   - register(): Register a resource for auto-disposal
 *   - dispose(): Manually dispose of a specific resource
 *   - disposeAll(): Dispose all resources and shut down
 *   - startCleanupTimer(): Periodic cleanup of expired resources
 * @dependencies:
 *   - logger: Logging utilities for resource tracking
 *   - Node.js process handlers for graceful shutdown
 * @context: Prevents memory leaks from timers, watchers, processes, streams, and other resources by providing centralized lifecycle management
 */

import { logger } from '../utils/logger';

export interface Resource {
  id: string;
  type: 'timer' | 'watcher' | 'process' | 'stream' | 'worker';
  createdAt: Date;
  metadata?: Record<string, any>;
  dispose: () => Promise<void> | void;
}

/**
 * Central resource registry that tracks and auto-disposes resources.
 * Prevents memory leaks from timers, watchers, and other resources.
 */
export class ResourceGuard {
  private resources = new Map<string, Resource>();
  private cleanupTimer?: NodeJS.Timeout;
  private maxAge: number = 30 * 60 * 1000; // 30 minutes
  private disposed = false;
  private static handlersInstalled = false;

  constructor() {
    this.startCleanupTimer();
    this.setupProcessHandlers();
  }

  /**
   * Register a resource for auto-disposal.
   */
  register(resource: Omit<Resource, 'createdAt'>): string {
    if (this.disposed) {
      throw new Error('ResourceGuard has been disposed');
    }

    const fullResource: Resource = {
      ...resource,
      createdAt: new Date(),
    };

    this.resources.set(resource.id, fullResource);
    logger.debug(`Registered ${resource.type} resource: ${resource.id}`);

    return resource.id;
  }

  /**
   * Manually dispose of a specific resource.
   */
  async dispose(resourceId: string): Promise<boolean> {
    const resource = this.resources.get(resourceId);
    if (!resource) {
      return false;
    }

    try {
      await resource.dispose();
      this.resources.delete(resourceId);
      logger.debug(`Disposed ${resource.type} resource: ${resourceId}`);
      return true;
    } catch (error) {
      logger.error(`Error disposing resource ${resourceId}:`, {
        error,
        resourceType: resource.type,
      });
      // Remove from registry even if disposal failed to prevent retry loops
      this.resources.delete(resourceId);
      return false;
    }
  }

  /**
   * Dispose all resources and shut down.
   */
  async disposeAll(permanent: boolean = false): Promise<void> {
    // If we're already in a disposed state and asked again, just return
    if (this.disposed && permanent) {
      return;
    }

    this.disposed = true;

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }

    const resourceIds = Array.from(this.resources.keys());
    logger.info(`Disposing all resources: ${resourceIds.length} items`);

    const disposePromises = resourceIds.map(id => this.dispose(id));
    await Promise.allSettled(disposePromises);

    this.resources.clear();
    logger.info('ResourceGuard disposed');

    // For tests and reusable environments, allow re-initialization by default
    if (!permanent) {
      this.disposed = false;
      this.startCleanupTimer();
    }
  }

  /**
   * Get resource statistics.
   */
  getStats(): {
    total: number;
    byType: Record<string, number>;
    oldestResource?: { id: string; type: string; age: number };
  } {
    const byType: Record<string, number> = {};
    let oldestResource: { id: string; type: string; age: number } | undefined;

    for (const resource of this.resources.values()) {
      byType[resource.type] = (byType[resource.type] || 0) + 1;

      const age = Date.now() - resource.createdAt.getTime();
      if (!oldestResource || age > oldestResource.age) {
        oldestResource = {
          id: resource.id,
          type: resource.type,
          age,
        };
      }
    }

    return {
      total: this.resources.size,
      byType,
      oldestResource,
    };
  }

  /**
   * Create a managed timer that will be auto-disposed.
   */
  createTimer(callback: () => void, delay: number, metadata?: Record<string, any>): string {
    const id = `timer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const timer = setTimeout(() => {
      try {
        callback();
      } catch (error) {
        logger.error(`Error in managed timer ${id}:`, { error });
      }
      // Auto-remove after execution
      this.resources.delete(id);
    }, delay);

    this.register({
      id,
      type: 'timer',
      metadata: { delay, ...metadata },
      dispose: () => {
        clearTimeout(timer);
      },
    });

    return id;
  }

  /**
   * Create a managed interval that will be auto-disposed.
   */
  createInterval(callback: () => void, interval: number, metadata?: Record<string, any>): string {
    const id = `interval_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const timer = setInterval(() => {
      try {
        callback();
      } catch (error) {
        logger.error(`Error in managed interval ${id}:`, { error });
      }
    }, interval);

    this.register({
      id,
      type: 'timer',
      metadata: { interval, ...metadata },
      dispose: () => {
        clearInterval(timer);
      },
    });

    return id;
  }

  /**
   * Create a managed file watcher that will be auto-disposed.
   */
  createWatcher(
    path: string,
    callback: (event: string, filename?: string) => void,
    metadata?: Record<string, any>
  ): string {
    const fs = require('fs');
    const id = `watcher_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const watcher = fs.watch(path, (event: string, filename?: string) => {
      try {
        callback(event, filename);
      } catch (error) {
        logger.error(`Error in managed watcher ${id}:`, { error, path, event });
      }
    });

    watcher.on('error', (error: Error) => {
      logger.error(`Watcher error for ${id}:`, { error, path });
    });

    this.register({
      id,
      type: 'watcher',
      metadata: { path, ...metadata },
      dispose: () => {
        watcher.close();
      },
    });

    return id;
  }

  /**
   * Create a managed AbortController that will be auto-disposed.
   */
  createAbortController(metadata?: Record<string, any>): {
    id: string;
    controller: AbortController;
  } {
    const id = `abort_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const controller = new AbortController();

    this.register({
      id,
      type: 'stream',
      metadata,
      dispose: () => {
        if (!controller.signal.aborted) {
          controller.abort();
        }
      },
    });

    return { id, controller };
  }

  /**
   * Start automatic cleanup of old resources.
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(
      () => {
        this.cleanupOldResources().catch(error => {
          logger.error('Error during resource cleanup:', { error });
        });
      },
      5 * 60 * 1000
    ); // Check every 5 minutes
  }

  /**
   * Clean up resources older than maxAge.
   */
  private async cleanupOldResources(): Promise<void> {
    const now = Date.now();
    const oldResources: string[] = [];

    for (const [id, resource] of this.resources) {
      if (now - resource.createdAt.getTime() > this.maxAge) {
        oldResources.push(id);
      }
    }

    if (oldResources.length > 0) {
      logger.info(`Cleaning up ${oldResources.length} old resources`);

      for (const id of oldResources) {
        await this.dispose(id);
      }
    }
  }

  /**
   * Set up process handlers for graceful shutdown.
   */
  private setupProcessHandlers(): void {
    // Install process handlers only once per process to avoid listener leaks in tests
    if (ResourceGuard.handlersInstalled) {
      return;
    }
    ResourceGuard.handlersInstalled = true;

    const cleanup = () => {
      logger.info('Process exit detected, disposing resources...');
      // Permanent disposal on process signals/exits
      this.disposeAll(true).catch(error => {
        logger.error('Error during process cleanup:', { error });
      });
    };

    // Use once to avoid accumulating listeners across re-instantiations in test runs
    process.once('SIGINT', cleanup);
    process.once('SIGTERM', cleanup);
    process.once('exit', cleanup);
  }
}

// Singleton instance
export const resourceGuard = new ResourceGuard();
