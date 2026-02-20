/**
 * @fileOverview: Consolidated embedding lifecycle management tool
 * @module: EmbeddingManagement
 * @keyFunctions:
 *   - manageEmbeddingsTool: Tool definition with action-driven interface
 *   - handleManageEmbeddings(): Dispatch to specific embedding operations
 *   - getEmbeddingStatus(): Shared helper for workspace configuration flows
 * @context: Central entry point for embedding health, migration, validation, and project maintenance tasks
 */

import { logger } from '../../utils/logger';
import { validateAndResolvePath } from '../utils/pathUtils';
import { LocalEmbeddingStorage } from '../../local/embeddingStorage';
import { LocalEmbeddingGenerator } from '../../local/embeddingGenerator';
import { ProjectIdentifier } from '../../local/projectIdentifier';
import {
  listProjectsWithEmbeddings,
  deleteProjectEmbeddings,
  getProjectEmbeddingDetails,
} from './projectManagement';
import { getEmbeddingStatusRuntime } from './embeddingStatus';
import { getCurrentModelConfiguration } from './modelConfiguration';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { isQuantized, dequantizeInt8ToFloat32, QuantizedEmbedding } from '../../local/quantization';

export { getCurrentModelConfiguration };

/**
 * Format bytes into human readable format
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export type ManageEmbeddingsAction =
  | 'status'
  | 'health_check'
  | 'create'
  | 'update'
  | 'validate'
  | 'list_projects'
  | 'delete_project'
  | 'project_details'
  | 'recent_files'
  | 'check_stale'
  | 'find_duplicates'
  | 'cleanup_duplicates'
  | 'get_workspace'
  | 'set_workspace'
  | 'validate_workspace';

export const SUPPORTED_ACTIONS: readonly ManageEmbeddingsAction[] = [
  'status',
  'health_check',
  'create',
  'update',
  'validate',
  'list_projects',
  'delete_project',
  'project_details',
  'recent_files',
  'check_stale',
  'find_duplicates',
  'cleanup_duplicates',
  'get_workspace',
  'set_workspace',
  'validate_workspace',
];

export interface ManageEmbeddingsRequest {
  action?: ManageEmbeddingsAction;
  projectPath?: string;
  projectIdentifier?: string;
  format?: 'structured' | 'compact' | 'detailed';
  autoFix?: boolean;
  maxFixTime?: number;
  force?: boolean;
  batchSize?: number;
  includeStats?: boolean;
  checkIntegrity?: boolean;
  confirmDeletion?: boolean;
  // Workspace configuration options
  maxFiles?: number;
  excludePatterns?: string[];
  allowHiddenFolders?: boolean;
  autoGenerate?: boolean;
  // Incremental update options
  files?: string[];
  // Recent files options
  limit?: number;
  // Check stale options
  autoUpdate?: boolean;
}

interface ProjectResolution {
  projectPath: string;
  projectId: string;
  legacyProjectId: string;
}

export async function handleManageEmbeddings(args: ManageEmbeddingsRequest): Promise<any> {
  // Default to get_workspace if no action and no projectPath specified
  const action = (args?.action ||
    (args?.projectPath ? 'status' : 'get_workspace')) as ManageEmbeddingsAction;

  if (!SUPPORTED_ACTIONS.includes(action)) {
    throw new Error(`Unsupported manage_embeddings action: ${String(args?.action)}`);
  }

  try {
    switch (action) {
      case 'get_workspace':
        return await handleGetWorkspace();
      case 'validate_workspace': {
        const projectPath = requireProjectPath(args.projectPath);
        return await handleValidateWorkspace(projectPath, {
          maxFiles: args.maxFiles,
          excludePatterns: args.excludePatterns,
          allowHiddenFolders: args.allowHiddenFolders,
        });
      }
      case 'set_workspace': {
        const projectPath = requireProjectPath(args.projectPath);
        return await handleSetWorkspace(
          projectPath,
          {
            maxFiles: args.maxFiles,
            excludePatterns: args.excludePatterns,
            allowHiddenFolders: args.allowHiddenFolders,
          },
          args.force || false,
          args.autoGenerate || false
        );
      }
      case 'status': {
        const projectPath = requireProjectPath(args.projectPath);
        return await getEmbeddingStatus({ projectPath, format: args.format });
      }
      case 'health_check': {
        const projectPath = requireProjectPath(args.projectPath);
        return await runEmbeddingHealthCheck({
          projectPath,
          autoFix: args.autoFix,
          maxFixTime: args.maxFixTime,
        });
      }
      case 'create': {
        const projectPath = requireProjectPath(args.projectPath);
        return await createProjectEmbeddings({
          projectPath,
          force: args.force,
          batchSize: args.batchSize,
        });
      }
      case 'update': {
        const projectPath = requireProjectPath(args.projectPath);
        return await updateProjectEmbeddings({
          projectPath,
          files: args.files,
          force: args.force,
          batchSize: args.batchSize,
        });
      }
      case 'validate': {
        const projectPath = requireProjectPath(args.projectPath);
        return await validateProjectEmbeddings({
          projectPath,
          includeStats: args.includeStats,
          checkIntegrity: args.checkIntegrity,
        });
      }
      case 'list_projects':
        return await listProjectsWithEmbeddings();
      case 'delete_project': {
        if (!args.projectIdentifier) {
          throw new Error('projectIdentifier is required for delete_project action');
        }
        if (!args.confirmDeletion) {
          throw new Error('confirmDeletion must be true to delete project embeddings');
        }
        return await deleteProjectEmbeddings({
          projectIdentifier: args.projectIdentifier,
          confirmDeletion: args.confirmDeletion,
        });
      }
      case 'project_details': {
        if (!args.projectIdentifier) {
          throw new Error('projectIdentifier is required for project_details action');
        }
        return await getProjectEmbeddingDetails({
          projectIdentifier: args.projectIdentifier,
        });
      }
      case 'recent_files': {
        const projectPath = requireProjectPath(args.projectPath);
        return await getRecentlyUpdatedFiles({
          projectPath,
          limit: args.limit || 20,
        });
      }
      case 'check_stale': {
        const projectPath = requireProjectPath(args.projectPath);
        return await checkStaleFiles({
          projectPath,
          autoUpdate: args.autoUpdate || false,
          batchSize: args.batchSize,
        });
      }
      case 'find_duplicates': {
        const projectPath = requireProjectPath(args.projectPath);
        const { projectId } = await resolveProject(projectPath);
        const { LocalEmbeddingStorage } = await import('../../local/embeddingStorage');
        const storage = new LocalEmbeddingStorage();
        const staleFiles = await storage.findStaleFileEmbeddings(projectId);

        return {
          success: true,
          projectId,
          projectPath,
          staleFilesFound: staleFiles.length,
          totalAffectedChunks: staleFiles.reduce(
            (sum, file) =>
              sum + file.generations.reduce((genSum, gen) => genSum + gen.chunkCount, 0),
            0
          ),
          staleFiles: staleFiles.map(file => ({
            filePath: file.filePath,
            generations: file.generationCount,
            totalChunks: file.generations.reduce((sum, gen) => sum + gen.chunkCount, 0),
            dateRange:
              file.generations.length > 1
                ? {
                    oldest: file.generations[file.generations.length - 1].createdAt.toISOString(),
                    newest: file.generations[0].createdAt.toISOString(),
                  }
                : null,
            generationDetails: file.generations.map(gen => ({
              createdAt: gen.createdAt.toISOString(),
              chunkCount: gen.chunkCount,
              chunks: gen.embeddings.map(e => `${e.chunkIndex}:${e.hash.substring(0, 8)}...`),
            })),
          })),
          message: `Found ${staleFiles.length} files with stale embeddings, affecting ${staleFiles.reduce((sum, file) => sum + file.generations.reduce((genSum, gen) => genSum + gen.chunkCount, 0), 0)} total chunks`,
        };
      }
      case 'cleanup_duplicates': {
        const projectPath = requireProjectPath(args.projectPath);
        const { projectId } = await resolveProject(projectPath);
        const { LocalEmbeddingStorage } = await import('../../local/embeddingStorage');
        const storage = new LocalEmbeddingStorage();
        const result = await storage.cleanupStaleFileEmbeddings(projectId);

        return {
          success: true,
          projectId,
          projectPath,
          ...result,
          message: `Cleaned up ${result.staleFilesFound} stale files, deleted ${result.chunksDeleted} chunks, saved ~${formatBytes(result.spaceSaved)}`,
        };
      }
      default:
        throw new Error(`Unhandled manage_embeddings action: ${action}`);
    }
  } catch (error) {
    logger.error('manage_embeddings action failed', {
      action,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function getEmbeddingStatus(args: {
  projectPath: string;
  format?: 'structured' | 'compact' | 'detailed';
}): Promise<any> {
  const { projectPath, format = 'structured' } = args;

  let resolvedProjectPath = projectPath;
  let projectId = 'unknown';
  let legacyProjectId = 'unknown';

  try {
    const resolved = await resolveProject(projectPath);
    resolvedProjectPath = resolved.projectPath;
    projectId = resolved.projectId;
    legacyProjectId = resolved.legacyProjectId;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.warn('Embedding status project resolution failed', {
      error: errorMessage,
      projectPath,
    });

    return {
      success: false,
      projectPath,
      error: `Project resolution failed: ${errorMessage}`,
      recommendations: ['Provide a valid --project-path (or set WORKSPACE_FOLDER) and retry.'],
    };
  }

  const result = await getEmbeddingStatusRuntime({
    projectId,
    legacyProjectId,
    projectPath: resolvedProjectPath,
    format,
  });

  const warnings: string[] = Array.isArray((result as any)?.warnings)
    ? [...(result as any).warnings]
    : [];

  if (result?.success && result.stats && result.stats.totalChunks > 0) {
    try {
      const details = await getProjectEmbeddingDetails({
        projectIdentifier: projectId,
        projectPath: resolvedProjectPath,
      });

      if (details?.coverage) {
        return {
          ...result,
          coverage: details.coverage,
          ...(warnings.length > 0 ? { warnings } : {}),
        };
      }
    } catch (error) {
      // Non-fatal; include warning so callers can diagnose partial status.
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Coverage details unavailable: ${message}`);
    }
  }

  return { ...result, ...(warnings.length > 0 ? { warnings } : {}) };
}

export async function runEmbeddingHealthCheck(args: {
  projectPath: string;
  autoFix?: boolean;
  maxFixTime?: number;
}): Promise<any> {
  const { projectPath, autoFix = false, maxFixTime = 15 } = args;

  const { projectId, projectPath: resolvedProjectPath } = await resolveProject(projectPath);

  logger.info('Starting embedding health check', {
    projectPath: resolvedProjectPath,
    projectId,
    autoFix,
    maxFixTime,
  });

  const startTime = Date.now();
  const issues: string[] = [];
  const fixes: string[] = [];
  const recommendations: string[] = [];

  try {
    const storage = new LocalEmbeddingStorage();
    const generator = new LocalEmbeddingGenerator(storage);

    try {
      await storage.initializeDatabase();
      logger.info('Embedding database connectivity verified');
    } catch (error) {
      issues.push(`Database connectivity failed: ${(error as Error).message}`);
      return {
        success: false,
        projectPath: resolvedProjectPath,
        issues,
        error: 'Database connectivity failed',
      };
    }

    const currentModelConfig = await getCurrentModelConfiguration();
    const compatibility = await storage.validateEmbeddingCompatibility(
      projectId,
      currentModelConfig.provider,
      currentModelConfig.dimensions
    );
    if (!compatibility.compatible) {
      issues.push('Embedding model compatibility issues detected.');
      recommendations.push('Run manage_embeddings with action="create" to regenerate embeddings.');
      if (autoFix) {
        logger.info('Auto-fix enabled. Initiating embedding creation.');
        try {
          const migrationResult = await createProjectEmbeddings({
            projectPath: resolvedProjectPath,
            force: true,
            batchSize: 20,
          });
          fixes.push(`Creation completed: ${migrationResult.message || 'Embeddings refreshed.'}`);
        } catch (error) {
          issues.push(`Auto-migration failed: ${(error as Error).message}`);
        }
      }
    }

    const stats = await storage.getProjectStats(projectId);
    if (!stats || stats.totalChunks === 0) {
      issues.push('No embeddings found for this project.');
      recommendations.push(
        'Trigger local_context or manage_embeddings action="create" to populate embeddings.'
      );
    }

    if (process.env.OPENAI_API_KEY) {
      try {
        const testEmbedding = await generator.generateQueryEmbedding('health-check probe');
        if (!testEmbedding || testEmbedding.length === 0) {
          issues.push('OpenAI API returned an empty embedding during probe.');
        }
      } catch (error) {
        issues.push(`OpenAI API connectivity issue: ${(error as Error).message}`);
        recommendations.push('Verify OPENAI_API_KEY or fall back to local embeddings.');
      }
    }

    const requiredEnvVars = ['WORKSPACE_FOLDER'];
    const recommendedEnvVars = ['USE_LOCAL_EMBEDDINGS', 'OPENAI_API_KEY'];

    for (const envVar of requiredEnvVars) {
      if (!process.env[envVar]) {
        issues.push(`Required environment variable missing: ${envVar}`);
      }
    }

    for (const envVar of recommendedEnvVars) {
      if (!process.env[envVar]) {
        recommendations.push(`Consider setting ${envVar} for optimal behaviour.`);
      }
    }

    const duration = Date.now() - startTime;
    const healthScore = Math.max(0, 100 - issues.length * 20 - recommendations.length * 5);

    logger.info('Embedding health check complete', {
      duration,
      issues: issues.length,
      fixes: fixes.length,
      recommendations: recommendations.length,
      healthScore,
    });

    return {
      success: true,
      projectPath: resolvedProjectPath,
      projectId,
      healthScore: `${healthScore}%`,
      issues,
      fixes,
      recommendations,
      duration: `${duration}ms`,
      compatibility,
      stats,
      autoFixAttempted: autoFix,
      summary:
        issues.length === 0
          ? 'All embedding diagnostics passed.'
          : `${issues.length} issues detected, ${fixes.length} auto-fixed`,
    };
  } catch (error) {
    logger.error('Embedding health check failed', {
      error: error instanceof Error ? error.message : String(error),
      projectPath: resolvedProjectPath,
    });
    throw new Error(`Embedding health check failed: ${(error as Error).message}`);
  }
}

export async function createProjectEmbeddings(args: {
  projectPath: string;
  force?: boolean;
  batchSize?: number;
}): Promise<any> {
  const {
    projectPath,
    force = false,
    batchSize = (() => {
      const parsed = parseInt(process.env.EMBEDDING_BATCH_SIZE || '', 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 32;
    })(),
  } = args;

  const { projectId, projectPath: resolvedProjectPath } = await resolveProject(projectPath);

  logger.info('Starting embedding creation', {
    projectPath: resolvedProjectPath,
    projectId,
    force,
    batchSize,
  });

  try {
    const storage = new LocalEmbeddingStorage();
    const generator = new LocalEmbeddingGenerator(storage);

    if (!force) {
      const currentModelConfig = await getCurrentModelConfiguration();
      const compatibility = await storage.validateEmbeddingCompatibility(
        projectId,
        currentModelConfig.provider,
        currentModelConfig.dimensions
      );

      // Check if we have any embeddings at all
      const stats = await storage.getProjectStats(projectId);

      // If no embeddings exist, we should generate them (not skip)
      if (stats && stats.totalChunks > 0 && compatibility.compatible) {
        return {
          success: true,
          skipped: true,
          reason: 'No migration needed - embeddings already compatible.',
          compatibility,
        };
      }
    }

    await storage.clearProjectEmbeddings(projectId);

    const parallelMode = process.env.EMBEDDING_PARALLEL_MODE === 'true';
    const maxConcurrency = parseInt(process.env.EMBEDDING_MAX_CONCURRENCY || '', 10) || 10;

    const progress = await generator.generateProjectEmbeddings(projectId, resolvedProjectPath, {
      batchSize,
      autoMigrate: true,
      filePatterns: [
        '**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts,py,go,rs,java,cpp,c,cc,cxx,h,hpp,hh,hxx,cs,rb,php,swift,kt,kts,scala,clj,hs,lhs,ml,r,sql,sh,bash,zsh,ex,exs,lua,md,mdx,json,yaml,yml,xml,html,htm,css,scss,sass,less,astro,vue,svelte}',
      ],
      parallelMode,
      maxConcurrency,
    });

    const currentModelConfig = await getCurrentModelConfiguration();
    const postMigrationCompatibility = await storage.validateEmbeddingCompatibility(
      projectId,
      currentModelConfig.provider,
      currentModelConfig.dimensions
    );
    const newStats = await storage.getProjectStats(projectId);

    const result = {
      success: true,
      migrated: true,
      projectId,
      progress,
      compatibility: postMigrationCompatibility,
      stats: newStats,
      recommendations: [
        'Embedding creation completed successfully.',
        'Embeddings are now compatible with the active model configuration.',
        'You can resume semantic search and context generation tools.',
      ],
      message: 'Embedding creation completed successfully.',
    };

    logger.info('Embedding creation completed', {
      projectId,
      filesProcessed: progress.processedFiles,
      embeddingsGenerated: progress.embeddings,
      compatible: postMigrationCompatibility.compatible,
    });

    // Record sync time for auto-sync tracking
    try {
      const { recordSync } = await import('../../local/autoSyncManager');
      await recordSync(projectId);
    } catch (error) {
      logger.debug('Failed to record sync time', { error });
    }

    return result;
  } catch (error) {
    logger.error('Embedding creation failed', {
      error: error instanceof Error ? error.message : String(error),
      projectPath: resolvedProjectPath,
    });
    throw new Error(`Embedding creation failed: ${(error as Error).message}`);
  }
}

export async function updateProjectEmbeddings(args: {
  projectPath: string;
  files?: string[];
  force?: boolean;
  batchSize?: number;
}): Promise<any> {
  const { projectPath, files, force = false, batchSize = 10 } = args;

  const { projectId, projectPath: resolvedProjectPath } = await resolveProject(projectPath);

  logger.info('Starting incremental embedding update', {
    projectPath: resolvedProjectPath,
    projectId,
    filesToUpdate: files?.length || 'auto-detect',
    force,
    batchSize,
  });

  try {
    const { LocalEmbeddingGenerator } = await import('../../local/embeddingGenerator');
    const embeddingGenerator = new LocalEmbeddingGenerator();

    const result = await embeddingGenerator.updateProjectEmbeddings(
      projectId,
      resolvedProjectPath,
      {
        files,
        force,
        batchSize,
        rateLimit: 500,
      }
    );

    logger.info('Incremental embedding update completed', {
      projectId,
      processedFiles: result.processedFiles,
      embeddings: result.embeddings,
      totalChunks: result.totalChunks,
      errors: result.errors.length,
    });

    const hadErrors = result.errors.length > 0;
    const nothingUpdated = result.processedFiles === 0 && result.embeddings === 0;
    const success = !(hadErrors && nothingUpdated);

    // Record sync time for auto-sync tracking (only if successful)
    if (success) {
      try {
        const { recordSync } = await import('../../local/autoSyncManager');
        await recordSync(projectId);
      } catch (error) {
        logger.debug('Failed to record sync time', { error });
      }
    }

    return {
      success,
      updated: success,
      projectId,
      projectPath: resolvedProjectPath,
      result,
      message: success
        ? `Updated ${result.embeddings} embeddings across ${result.processedFiles} files`
        : `Failed to update embeddings: ${result.errors[0] || 'no files were updated'}`,
    };
  } catch (error) {
    logger.error('Incremental embedding update failed', {
      error: error instanceof Error ? error.message : String(error),
      projectPath: resolvedProjectPath,
    });
    throw new Error(`Incremental embedding update failed: ${(error as Error).message}`);
  }
}

export async function getRecentlyUpdatedFiles(args: {
  projectPath: string;
  limit?: number;
}): Promise<any> {
  const { projectPath, limit = 20 } = args;

  const { projectId, projectPath: resolvedProjectPath } = await resolveProject(projectPath);

  logger.info('Fetching recently updated files', {
    projectPath: resolvedProjectPath,
    projectId,
    limit,
  });

  try {
    const { LocalEmbeddingStorage } = await import('../../local/embeddingStorage');
    const storage = new LocalEmbeddingStorage();

    const recentFiles = await storage.getRecentlyUpdatedFiles(projectId, limit);

    logger.info('Retrieved recently updated files', {
      projectId,
      count: recentFiles.length,
      limit,
    });

    return {
      success: true,
      projectId,
      projectPath: resolvedProjectPath,
      recentFiles,
      totalFiles: recentFiles.length,
      message: `Found ${recentFiles.length} recently updated files`,
    };
  } catch (error) {
    logger.error('Failed to fetch recently updated files', {
      error: error instanceof Error ? error.message : String(error),
      projectPath: resolvedProjectPath,
    });
    throw new Error(`Failed to fetch recently updated files: ${(error as Error).message}`);
  }
}

/**
 * Check for stale files that need re-indexing (disk timestamp > database timestamp)
 */
export async function checkStaleFiles(args: {
  projectPath: string;
  autoUpdate?: boolean;
  batchSize?: number;
}): Promise<any> {
  const { projectPath, autoUpdate = false, batchSize = 10 } = args;

  const { projectId, projectPath: resolvedProjectPath } = await resolveProject(projectPath);

  logger.info('Checking for stale files', {
    projectPath: resolvedProjectPath,
    projectId,
    autoUpdate,
  });

  try {
    const { LocalEmbeddingStorage } = await import('../../local/embeddingStorage');
    const storage = new LocalEmbeddingStorage();

    // Get all files from database with their last modified timestamps
    const dbFiles = await storage.listProjectFiles(projectId);

    const staleFiles: Array<{
      filePath: string;
      fileId: string;
      dbTimestamp: Date;
      diskTimestamp: Date;
      timeDiff: number;
    }> = [];

    const missingFiles: Array<{
      filePath: string;
      fileId: string;
      dbTimestamp: Date;
    }> = [];

    // Check each file's disk timestamp vs database timestamp
    for (const dbFile of dbFiles) {
      const fullPath = path.join(resolvedProjectPath, dbFile.path);

      // Check if file exists on disk
      if (!fs.existsSync(fullPath)) {
        missingFiles.push({
          filePath: dbFile.path,
          fileId: dbFile.id,
          dbTimestamp: dbFile.lastModified,
        });
        continue;
      }

      // Get file stats from disk
      const diskStats = fs.statSync(fullPath);
      const diskTimestamp = diskStats.mtime;
      const dbTimestamp = dbFile.lastModified;

      // If disk file is newer than database, it's stale
      if (diskTimestamp > dbTimestamp) {
        const timeDiff = diskTimestamp.getTime() - dbTimestamp.getTime();
        staleFiles.push({
          filePath: dbFile.path,
          fileId: dbFile.id,
          dbTimestamp,
          diskTimestamp,
          timeDiff,
        });
      }
    }

    // Sort stale files by time difference (most stale first)
    staleFiles.sort((a, b) => b.timeDiff - a.timeDiff);

    logger.info('Stale file check complete', {
      projectId,
      totalFiles: dbFiles.length,
      staleFiles: staleFiles.length,
      missingFiles: missingFiles.length,
    });

    // If autoUpdate is true, update the stale files
    let updateResult = null;
    if (autoUpdate && staleFiles.length > 0) {
      logger.info('Auto-updating stale files', {
        count: staleFiles.length,
        batchSize,
      });

      updateResult = await updateProjectEmbeddings({
        projectPath: resolvedProjectPath,
        files: staleFiles.map(f => f.filePath),
        force: true,
        batchSize,
      });

      // Record sync time after successful auto-update
      if (updateResult?.success) {
        try {
          const { recordSync } = await import('../../local/autoSyncManager');
          await recordSync(projectId);
        } catch (error) {
          logger.debug('Failed to record sync time after stale file update', { error });
        }
      }
    }

    return {
      success: true,
      projectId,
      projectPath: resolvedProjectPath,
      totalFiles: dbFiles.length,
      staleFiles: staleFiles.map(f => ({
        filePath: f.filePath,
        dbTimestamp: f.dbTimestamp.toISOString(),
        diskTimestamp: f.diskTimestamp.toISOString(),
        timeDiffSeconds: Math.round(f.timeDiff / 1000),
      })),
      missingFiles: missingFiles.map(f => ({
        filePath: f.filePath,
        dbTimestamp: f.dbTimestamp.toISOString(),
      })),
      staleCount: staleFiles.length,
      missingCount: missingFiles.length,
      autoUpdate,
      updateResult,
      message: autoUpdate
        ? `Found and updated ${staleFiles.length} stale files`
        : `Found ${staleFiles.length} stale files that need updating`,
    };
  } catch (error) {
    logger.error('Failed to check stale files', {
      error: error instanceof Error ? error.message : String(error),
      projectPath: resolvedProjectPath,
    });
    throw new Error(`Failed to check stale files: ${(error as Error).message}`);
  }
}

export async function validateProjectEmbeddings(args: {
  projectPath: string;
  includeStats?: boolean;
  checkIntegrity?: boolean;
}): Promise<any> {
  const { projectPath, includeStats = true, checkIntegrity = false } = args;

  const {
    projectId,
    legacyProjectId,
    projectPath: resolvedProjectPath,
  } = await resolveProject(projectPath);

  logger.info('Starting embedding validation', {
    projectPath: resolvedProjectPath,
    projectId,
    includeStats,
    checkIntegrity,
  });

  try {
    const storage = new LocalEmbeddingStorage();

    const currentModelConfig = await getCurrentModelConfiguration();
    const compatibility = await storage.validateEmbeddingCompatibility(
      projectId,
      currentModelConfig.provider,
      currentModelConfig.dimensions
    );

    const result: any = {
      success: true,
      projectId,
      projectPath: resolvedProjectPath,
      compatibility,
      validation: {
        passed: compatibility.compatible,
        issues: compatibility.issues,
        recommendations: compatibility.recommendations,
      },
    };

    if (includeStats) {
      const stats = await storage.getProjectStats(projectId);
      const modelInfo = await storage.getModelInfo(projectId);
      const legacyStats =
        legacyProjectId !== projectId ? await storage.getProjectStats(legacyProjectId) : null;

      result.stats = stats;
      result.modelInfo = modelInfo;
      if (legacyStats) {
        result.legacy = { projectId: legacyProjectId, stats: legacyStats };
      }
    }

    if (checkIntegrity) {
      logger.info('Performing embedding integrity probe', { projectId });

      const embeddings = await storage.getProjectEmbeddings(projectId);
      const sampleSize = Math.min(10, embeddings.length);
      const sample = embeddings.slice(0, sampleSize);

      const integrityIssues: string[] = [];

      for (const embedding of sample) {
        let embeddingVector: number[];
        let embeddingLength: number;

        // Handle both quantized and float32 embeddings
        if (isQuantized(embedding.embedding)) {
          embeddingVector = dequantizeInt8ToFloat32(embedding.embedding);
          embeddingLength = embedding.embedding.originalDimensions;
        } else {
          embeddingVector = embedding.embedding;
          embeddingLength = embedding.embedding.length;
        }

        if (!embeddingVector || embeddingVector.length === 0) {
          integrityIssues.push(`Embedding ${embedding.id} has invalid vector data.`);
        }

        const hasInvalidValues = embeddingVector.some((value: number) => !Number.isFinite(value));
        if (hasInvalidValues) {
          integrityIssues.push(`Embedding ${embedding.id} contains NaN or infinite values.`);
        }

        if (embedding.metadata.embeddingDimensions !== embeddingLength) {
          integrityIssues.push(
            `Embedding ${embedding.id} has dimension mismatch: metadata ${embedding.metadata.embeddingDimensions}, actual ${embeddingLength}.`
          );
        }
      }

      result.integrity = {
        checked: sampleSize,
        total: embeddings.length,
        issues: integrityIssues,
        passed: integrityIssues.length === 0,
      };
    }

    logger.info('Embedding validation completed', {
      projectId,
      compatible: compatibility.compatible,
      issues: compatibility.issues.length,
      integrityChecked: checkIntegrity,
    });

    return result;
  } catch (error) {
    logger.error('Embedding validation failed', {
      error: error instanceof Error ? error.message : String(error),
      projectPath: resolvedProjectPath,
    });
    throw new Error(`Embedding validation failed: ${(error as Error).message}`);
  }
}

function requireProjectPath(projectPath?: string): string {
  if (!projectPath || typeof projectPath !== 'string') {
    throw new Error('projectPath is required and must be a string');
  }
  return projectPath;
}

async function resolveProject(projectPath: string): Promise<ProjectResolution> {
  const resolvedProjectPath = validateAndResolvePath(projectPath);
  const projectInfo = await ProjectIdentifier.getInstance().identifyProject(resolvedProjectPath);
  const projectId = projectInfo.id;

  // Use workspace root for legacy ID to ensure consistency across subdirectories
  const legacyProjectId = crypto
    .createHash('sha256')
    .update(projectInfo.workspaceRoot)
    .digest('hex')
    .substring(0, 16);

  return { projectPath: resolvedProjectPath, projectId, legacyProjectId };
}

/**
 * Workspace configuration handlers (migrated from workspaceConfig.ts)
 */

async function handleGetWorkspace(): Promise<any> {
  const { getCurrentWorkspaceFolder } = await import('../utils/workspaceValidator');
  const currentWorkspace = getCurrentWorkspaceFolder();

  logger.info('ðŸ“ Current workspace status', {
    workspace: currentWorkspace || '(not set)',
    fromEnv: !!process.env.WORKSPACE_FOLDER,
    fromBaseDir: !!process.env.AMBIANCE_BASE_DIR,
  });

  let embeddingStatus = null;
  if (currentWorkspace) {
    logger.info('ðŸ” Checking embedding status for current workspace', {
      workspace: currentWorkspace,
    });
    try {
      embeddingStatus = await getEmbeddingStatus({ projectPath: currentWorkspace });
    } catch (error) {
      logger.warn('âš ï¸ Could not check embedding status', {
        workspace: currentWorkspace,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    success: true,
    workspace: currentWorkspace || null,
    source: process.env.WORKSPACE_FOLDER
      ? 'WORKSPACE_FOLDER'
      : process.env.AMBIANCE_BASE_DIR
        ? 'AMBIANCE_BASE_DIR'
        : 'none',
    embeddingStatus,
    message: currentWorkspace
      ? `Current workspace: ${currentWorkspace}`
      : 'No workspace folder configured. Use action "set_workspace" to configure one.',
    recommendations: embeddingStatus?.recommendations || [],
  };
}

async function handleValidateWorkspace(
  path: string,
  options: {
    maxFiles?: number;
    excludePatterns?: string[];
    allowHiddenFolders?: boolean;
  }
): Promise<any> {
  const { validateWorkspaceFolder } = await import('../utils/workspaceValidator');

  logger.info('ðŸ” Validating workspace path', { path, options });

  const validation = await validateWorkspaceFolder(path, options);

  return {
    success: true,
    validation,
    message: validation.isValid
      ? `âœ… Path is valid for workspace: ${validation.path} (${validation.fileCount} files)`
      : `âŒ Path is not suitable for workspace: ${validation.error}`,
    recommendations: validation.isValid ? [] : getWorkspaceRecommendations(validation),
  };
}

async function handleSetWorkspace(
  path: string,
  options: {
    maxFiles?: number;
    excludePatterns?: string[];
    allowHiddenFolders?: boolean;
  },
  force: boolean,
  autoGenerate: boolean
): Promise<any> {
  const { validateWorkspaceFolder, setWorkspaceFolder } = await import(
    '../utils/workspaceValidator'
  );

  logger.info('ðŸ  Setting workspace folder', { path, options, force, autoGenerate });

  // First validate the path
  const validation = await validateWorkspaceFolder(path, options);

  if (!validation.isValid) {
    return {
      success: false,
      error: validation.error,
      validation,
      recommendations: getWorkspaceRecommendations(validation),
      message: `Cannot set workspace: ${validation.error}`,
    };
  }

  // Check for warnings
  if (validation.warnings && validation.warnings.length > 0 && !force) {
    return {
      success: false,
      error: 'Workspace has warnings. Use force=true to override.',
      validation,
      warnings: validation.warnings,
      message: `Workspace has warnings: ${validation.warnings.join(', ')}. Use force=true if you want to proceed anyway.`,
    };
  }

  // Set the workspace
  setWorkspaceFolder(validation.path!);

  logger.info('âœ… Workspace folder set successfully', {
    workspace: validation.path,
    fileCount: validation.fileCount,
    hadWarnings: !!validation.warnings,
  });

  // Mark workspace as initialized
  process.env.WORKSPACE_INITIALIZED = 'true';
  logger.info('ðŸ”§ Workspace initialization flag set');

  // Check embedding status for the newly set workspace
  logger.info('ðŸ” Checking embedding status for newly set workspace', {
    workspace: validation.path,
  });

  let embeddingStatus = null;
  try {
    embeddingStatus = await getEmbeddingStatus({ projectPath: validation.path! });
  } catch (error) {
    logger.warn('âš ï¸ Could not check embedding status', {
      workspace: validation.path,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  let embeddingGenerationResult = null;
  let embeddingMessage = '';

  // Handle automatic embedding generation if requested
  if (autoGenerate && LocalEmbeddingStorage.isEnabled()) {
    logger.info('ðŸš€ Starting automatic embedding generation', {
      workspace: validation.path,
      fileCount: validation.fileCount,
    });

    try {
      const projectInfo = await ProjectIdentifier.getInstance().identifyProject(validation.path!);
      if (projectInfo) {
        const embeddingGenerator = new LocalEmbeddingGenerator();
        const progress = await embeddingGenerator.generateProjectEmbeddings(
          projectInfo.id,
          validation.path!,
          {
            batchSize: 10,
            rateLimit: 500,
            maxChunkSize: 1500,
            filePatterns: [
              '**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts,py,go,rs,java,cpp,c,cc,cxx,h,hpp,hh,hxx,cs,rb,php,swift,kt,kts,scala,clj,hs,lhs,ml,r,sql,sh,bash,zsh,ex,exs,lua,md,mdx,json,yaml,yml,xml,html,htm,css,scss,sass,less,astro,vue,svelte}',
            ],
          }
        );

        embeddingGenerationResult = {
          success: true,
          filesProcessed: progress.processedFiles,
          chunksCreated: progress.totalChunks,
          embeddings: progress.embeddings,
          errors: progress.errors.length,
        };

        embeddingMessage = `Generated ${progress.embeddings} embeddings from ${progress.processedFiles} files`;

        logger.info('âœ… Automatic embedding generation completed', {
          workspace: validation.path,
          result: embeddingGenerationResult,
        });
      }
    } catch (error) {
      embeddingMessage = `Embedding generation failed: ${error instanceof Error ? error.message : String(error)}`;
      logger.error('âŒ Automatic embedding generation failed', {
        workspace: validation.path,
        error: embeddingMessage,
      });
    }
  } else if (!autoGenerate) {
    embeddingMessage = 'Embeddings will be generated automatically when AI tools are first used';
  }

  // Start automatic indexing (file watching + periodic stale checks) after workspace is set
  try {
    const { initializeAutoIndexing } = await import('../../startup/autoIndexingStartup');
    logger.info('ðŸ”„ Starting automatic indexing after workspace configuration');
    initializeAutoIndexing().catch(error => {
      logger.warn('âš ï¸ Background indexing failed to start after set_workspace', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  } catch (error) {
    logger.warn('âš ï¸ Could not start automatic indexing', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return {
    success: true,
    workspace: validation.path,
    fileCount: validation.fileCount,
    warnings: validation.warnings,
    embeddingStatus,
    embeddingGeneration: autoGenerate ? embeddingGenerationResult : null,
    message:
      `âœ… Workspace set successfully: ${validation.path} (${validation.fileCount} files)` +
      (validation.warnings ? ` [Warnings: ${validation.warnings.length}]` : '') +
      (autoGenerate
        ? ` [Embedding generation: ${embeddingGenerationResult?.success ? 'completed' : 'failed'}]`
        : '') +
      ' [Auto-indexing started]',
    embeddingMessage,
  };
}

function getWorkspaceRecommendations(validation: any): string[] {
  const recommendations: string[] = [];

  if (!validation.isValid && validation.error) {
    if (validation.error.includes('root drive')) {
      recommendations.push('Use a specific project directory instead of root drive');
      recommendations.push('Example: C:\\Projects\\MyProject instead of C:\\');
    }

    if (validation.error.includes('too many files')) {
      recommendations.push('Choose a more specific subdirectory');
      recommendations.push('Add exclude patterns for build/dependency folders');
      recommendations.push('Consider using folderPath parameter in other tools instead');
    }

    if (validation.error.includes('does not exist')) {
      recommendations.push('Create the directory first');
      recommendations.push('Check the path spelling and access permissions');
    }

    if (validation.error.includes('not a directory')) {
      recommendations.push('Use the parent directory instead');
      recommendations.push('Check that the path points to a folder, not a file');
    }
  }

  if (recommendations.length === 0) {
    recommendations.push('Try a different path');
    recommendations.push('Use action "validate_workspace" to check paths before setting');
  }

  return recommendations;
}
