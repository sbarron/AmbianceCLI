/**
 * @fileOverview: Automatic embedding synchronization manager
 * @module: AutoSyncManager
 * @purpose: Ensure embeddings stay fresh automatically when enabled
 */

import { logger } from '../utils/logger';
import * as path from 'path';
import * as fs from 'fs';

// Default: 10 minutes (600000 ms)
const DEFAULT_SYNC_THRESHOLD_MS = 10 * 60 * 1000;

// Minimum interval between syncs to avoid thrashing (30 seconds)
const MIN_SYNC_INTERVAL_MS = 30 * 1000;

interface LastSyncInfo {
  projectId: string;
  lastSyncTime: number;
  lastCheckTime: number;
}

// In-memory cache of last sync times to avoid excessive database queries
const syncCache = new Map<string, LastSyncInfo>();

/**
 * Get the configured auto-sync threshold from environment or use default
 */
export function getAutoSyncThresholdMs(): number {
  const envValue = process.env.EMBEDDING_AUTO_SYNC_THRESHOLD_MS;
  if (envValue) {
    const parsed = parseInt(envValue, 10);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return DEFAULT_SYNC_THRESHOLD_MS;
}

/**
 * Check if auto-sync is enabled
 */
export function isAutoSyncEnabled(): boolean {
  // Auto-sync is enabled if:
  // 1. USE_LOCAL_EMBEDDINGS is true
  // 2. EMBEDDING_AUTO_SYNC is not explicitly set to false
  const useEmbeddings = process.env.USE_LOCAL_EMBEDDINGS === 'true';
  const autoSyncDisabled = process.env.EMBEDDING_AUTO_SYNC === 'false';

  return useEmbeddings && !autoSyncDisabled;
}

/**
 * Check if embeddings need syncing based on time threshold
 */
export async function shouldAutoSync(projectId: string): Promise<{
  shouldSync: boolean;
  reason?: string;
  timeSinceLastSync?: number;
}> {
  if (!isAutoSyncEnabled()) {
    return { shouldSync: false, reason: 'Auto-sync disabled' };
  }

  const now = Date.now();
  const threshold = getAutoSyncThresholdMs();

  // Check in-memory cache first to avoid excessive checks
  const cached = syncCache.get(projectId);
  if (cached) {
    const timeSinceLastCheck = now - cached.lastCheckTime;

    // Don't check again if we checked very recently (within min interval)
    if (timeSinceLastCheck < MIN_SYNC_INTERVAL_MS) {
      return {
        shouldSync: false,
        reason: 'Recently checked',
        timeSinceLastSync: now - cached.lastSyncTime,
      };
    }
  }

  try {
    const { LocalEmbeddingStorage } = await import('./embeddingStorage');
    const storage = new LocalEmbeddingStorage();

    // Get last sync time from database metadata
    const lastSyncTime = await getLastSyncTime(storage, projectId);

    // Update cache
    syncCache.set(projectId, {
      projectId,
      lastSyncTime: lastSyncTime || 0,
      lastCheckTime: now,
    });

    if (!lastSyncTime) {
      return {
        shouldSync: true,
        reason: 'No previous sync found',
        timeSinceLastSync: undefined,
      };
    }

    const timeSinceLastSync = now - lastSyncTime;
    const isStale = timeSinceLastSync > threshold;

    return {
      shouldSync: isStale,
      reason: isStale
        ? `Embeddings stale (${Math.round(timeSinceLastSync / 1000)}s since last sync, threshold: ${Math.round(threshold / 1000)}s)`
        : 'Embeddings fresh',
      timeSinceLastSync,
    };
  } catch (error) {
    logger.warn('Failed to check auto-sync status', {
      error: error instanceof Error ? error.message : String(error),
      projectId,
    });
    return { shouldSync: false, reason: 'Check failed' };
  }
}

/**
 * Record that a sync was performed
 */
export async function recordSync(projectId: string): Promise<void> {
  const now = Date.now();

  // Update in-memory cache
  syncCache.set(projectId, {
    projectId,
    lastSyncTime: now,
    lastCheckTime: now,
  });

  try {
    const { LocalEmbeddingStorage } = await import('./embeddingStorage');
    const storage = new LocalEmbeddingStorage();

    await setLastSyncTime(storage, projectId, now);

    logger.debug('Recorded sync time', { projectId, timestamp: new Date(now).toISOString() });
  } catch (error) {
    logger.warn('Failed to record sync time', {
      error: error instanceof Error ? error.message : String(error),
      projectId,
    });
  }
}

/**
 * Clear sync cache for a project (useful after deletions)
 */
export function clearSyncCache(projectId?: string): void {
  if (projectId) {
    syncCache.delete(projectId);
  } else {
    syncCache.clear();
  }
}

/**
 * Get last sync time from database metadata
 */
async function getLastSyncTime(storage: any, projectId: string): Promise<number | null> {
  try {
    // Store last sync time in a metadata table
    const db = (storage as any).db;
    if (!db) return null;

    // Ensure metadata table exists
    db.prepare(
      `CREATE TABLE IF NOT EXISTS project_metadata (
        project_id TEXT PRIMARY KEY,
        last_sync_time INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      )`
    ).run();

    const row = db
      .prepare('SELECT last_sync_time FROM project_metadata WHERE project_id = ?')
      .get(projectId);

    return row?.last_sync_time || null;
  } catch (error) {
    logger.debug('Failed to get last sync time', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Set last sync time in database metadata
 */
async function setLastSyncTime(storage: any, projectId: string, timestamp: number): Promise<void> {
  try {
    const db = (storage as any).db;
    if (!db) return;

    // Ensure metadata table exists
    db.prepare(
      `CREATE TABLE IF NOT EXISTS project_metadata (
        project_id TEXT PRIMARY KEY,
        last_sync_time INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      )`
    ).run();

    db.prepare(
      `INSERT OR REPLACE INTO project_metadata (project_id, last_sync_time, updated_at)
       VALUES (?, ?, ?)`
    ).run(projectId, timestamp, new Date().toISOString());
  } catch (error) {
    logger.debug('Failed to set last sync time', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
