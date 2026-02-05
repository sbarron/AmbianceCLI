import { logger } from '../../utils/logger';
import { LocalEmbeddingStorage } from '../../local/embeddingStorage';
import { getCurrentModelConfiguration } from './modelConfiguration';

function estimateEmbeddingTime(fileCount: number, avgFileSize: number = 5000): string {
  let filesPerMinute = 500;

  if (avgFileSize < 1000) {
    filesPerMinute = 1000;
  } else if (avgFileSize < 10000) {
    filesPerMinute = 500;
  } else {
    filesPerMinute = 200;
  }

  const estimatedMinutes = Math.ceil(fileCount / filesPerMinute);

  if (estimatedMinutes < 1) {
    return '< 1 minute';
  }
  if (estimatedMinutes === 1) {
    return '1 minute';
  }
  if (estimatedMinutes < 60) {
    return `${estimatedMinutes} minutes`;
  }

  const hours = Math.floor(estimatedMinutes / 60);
  const minutes = estimatedMinutes % 60;
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

export async function getEmbeddingStatusRuntime(args: {
  projectId: string;
  legacyProjectId: string;
  projectPath: string;
  format?: 'structured' | 'compact' | 'detailed';
}): Promise<any> {
  const { projectId, legacyProjectId, projectPath, format = 'structured' } = args;

  logger.info('Checking embedding model status', {
    projectPath,
    projectId,
    format,
  });

  try {
    const storage = new LocalEmbeddingStorage();

    try {
      await storage.initializeDatabase();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn('Embedding storage unavailable; returning degraded status', {
        error: errorMessage,
        projectId,
        projectPath,
      });

      const currentModelConfig = await getCurrentModelConfiguration();

      return {
        success: false,
        projectId,
        projectPath,
        currentModel: currentModelConfig,
        error: `Embedding storage unavailable: ${errorMessage}`,
        recommendations: [
          'Embeddings are currently unavailable in this environment. Reinstall dependencies so better-sqlite3 bindings match your Node version.',
          'If you do not need embeddings, you can set USE_LOCAL_EMBEDDINGS=false to suppress embedding-related work.',
        ],
      };
    }

    const currentModelConfig = await getCurrentModelConfiguration();
    const modelInfo = await storage.getModelInfo(projectId);
    const compatibility = await storage.validateEmbeddingCompatibility(
      projectId,
      currentModelConfig.provider,
      currentModelConfig.dimensions
    );
    const statsCurrent = await storage.getProjectStats(projectId);
    const statsLegacy =
      legacyProjectId !== projectId ? await storage.getProjectStats(legacyProjectId) : null;

    let generation: any | undefined;
    try {
      const { getBackgroundEmbeddingManager } = await import(
        '../../local/backgroundEmbeddingManager'
      );
      const mgr = getBackgroundEmbeddingManager();
      const status = mgr.getGenerationStatus(projectId);
      if (status) {
        generation = {
          inProgress: status.isGenerating,
          startedAt: status.startedAt,
          completedAt: status.completedAt,
          progress: status.progress,
          message: status.isGenerating
            ? 'Background embedding generation is in progress'
            : status.completedAt
              ? 'Background embedding generation completed recently'
              : undefined,
        };

        if (status.isGenerating && status.progress) {
          const elapsed = status.startedAt
            ? Math.round((Date.now() - status.startedAt.getTime()) / 1000)
            : 0;
          const remainingFiles = status.progress.totalFiles - status.progress.processedFiles;
          const remaining = estimateEmbeddingTime(remainingFiles, 5000);
          const progressPercent = Math.round(
            (status.progress.processedFiles / status.progress.totalFiles) * 100
          );

          generation.estimatedTimeRemaining = remaining;
          generation.elapsedTime =
            elapsed > 0
              ? `${Math.floor(elapsed / 60)}:${(elapsed % 60).toString().padStart(2, '0')}`
              : '0:00';
          generation.progressPercent = progressPercent;
          generation.progressSummary = `${status.progress.processedFiles}/${status.progress.totalFiles} files (${progressPercent}%)`;
        }
      } else {
        generation = { inProgress: false };
      }
    } catch {
      // Ignore generation status errors silently
    }

    const result = {
      success: true,
      projectId,
      projectPath,
      currentModel: currentModelConfig,
      storedModel: modelInfo,
      compatibility,
      stats: statsCurrent,
      legacy:
        statsLegacy && statsLegacy.totalChunks > 0
          ? { projectId: legacyProjectId, stats: statsLegacy }
          : undefined,
      generation,
      recommendations: [] as string[],
    };

    if (!compatibility.compatible) {
      result.recommendations.push(
        'Embedding model compatibility issues detected. Run manage_embeddings with action="create" to refresh embeddings.'
      );
    }

    if (
      modelInfo &&
      (modelInfo.currentProvider !== currentModelConfig.provider ||
        modelInfo.currentDimensions !== currentModelConfig.dimensions)
    ) {
      result.recommendations.push(
        `Stored embeddings use ${modelInfo.currentProvider} (${modelInfo.currentDimensions}d) while the current environment prefers ${currentModelConfig.provider} (${currentModelConfig.dimensions}d). Consider migration.`
      );
    }

    if ((!statsCurrent || statsCurrent.totalChunks === 0) && !statsLegacy) {
      result.recommendations.push(
        'No embeddings found. They will be generated automatically when embedding-enhanced tools like local_context run.'
      );
    } else if (!statsCurrent && statsLegacy) {
      result.recommendations.push(
        'Embeddings exist under a legacy project ID. Re-running manage_embeddings with action="create" will standardise storage.'
      );
    } else if (statsCurrent && statsCurrent.totalChunks > 0 && compatibility.compatible) {
      result.recommendations.push('Embeddings look healthy for similarity search.');
    }

    logger.info('Embedding model status check complete', {
      projectId,
      compatible: compatibility.compatible,
      issues: compatibility.issues.length,
      recommendations: result.recommendations.length,
    });

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Embedding model status check failed', {
      error: errorMessage,
      projectPath,
      projectId,
    });

    const currentModelConfig = await getCurrentModelConfiguration();

    return {
      success: false,
      projectId,
      projectPath,
      currentModel: currentModelConfig,
      error: `Embedding model status check failed: ${errorMessage}`,
      recommendations: [
        'Retry the command with --format json for more details.',
        'Run manage_embeddings action="health_check" to diagnose and optionally auto-fix issues.',
      ],
    };
  }
}
