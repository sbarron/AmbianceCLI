/**
 * @fileOverview: Background embedding generation manager
 * @module: BackgroundEmbeddingManager
 * @keyFunctions:
 *   - triggerEmbeddingGeneration(): Start non-blocking embedding generation
 *   - getGenerationStatus(): Check if embeddings are being generated
 *   - isGenerating(): Quick check if generation is in progress
 * @context: Manages background embedding generation to avoid blocking tool execution
 */

import { logger } from '../utils/logger';
import { LocalEmbeddingGenerator } from './embeddingGenerator';
import { LocalEmbeddingStorage } from './embeddingStorage';
import { ProjectIdentifier } from './projectIdentifier';

export interface GenerationStatus {
  projectId: string;
  projectPath: string;
  isGenerating: boolean;
  startedAt?: Date;
  progress?: {
    totalFiles: number;
    processedFiles: number;
    totalChunks: number;
    embeddings: number;
  };
  error?: string;
  completedAt?: Date;
}

/**
 * Singleton manager for background embedding generation
 */
export class BackgroundEmbeddingManager {
  private static instance: BackgroundEmbeddingManager;
  private activeGenerations: Map<string, GenerationStatus> = new Map();
  private embeddingGenerator: LocalEmbeddingGenerator;
  private embeddingStorage: LocalEmbeddingStorage;

  private constructor() {
    this.embeddingGenerator = new LocalEmbeddingGenerator();
    this.embeddingStorage = new LocalEmbeddingStorage();
  }

  static getInstance(): BackgroundEmbeddingManager {
    if (!BackgroundEmbeddingManager.instance) {
      BackgroundEmbeddingManager.instance = new BackgroundEmbeddingManager();
    }
    return BackgroundEmbeddingManager.instance;
  }

  /**
   * Trigger background embedding generation for a project (non-blocking)
   * Returns immediately after starting the generation
   */
  async triggerEmbeddingGeneration(
    projectPath: string,
    options?: {
      force?: boolean;
      batchSize?: number;
      rateLimit?: number;
    }
  ): Promise<{ started: boolean; reason: string; projectId: string }> {
    try {
      // Check if local embeddings are enabled
      if (!LocalEmbeddingStorage.isEnabled()) {
        return {
          started: false,
          reason: 'Local embeddings not enabled (set USE_LOCAL_EMBEDDINGS=true)',
          projectId: '',
        };
      }

      // Identify the project
      const projectIdentifier = ProjectIdentifier.getInstance();
      const projectInfo = await projectIdentifier.identifyProject(projectPath);

      if (!projectInfo) {
        return {
          started: false,
          reason: 'Could not identify project',
          projectId: '',
        };
      }

      const projectId = projectInfo.id;

      // Check if already generating
      if (this.isGenerating(projectId)) {
        const status = this.activeGenerations.get(projectId)!;
        return {
          started: false,
          reason: `Already generating embeddings (started ${Math.round((Date.now() - status.startedAt!.getTime()) / 1000)}s ago)`,
          projectId,
        };
      }

      // Check if embeddings already exist (unless force is true)
      if (!options?.force) {
        const stats = await this.embeddingStorage.getProjectStats(projectId);
        if (stats && stats.totalChunks > 0) {
          return {
            started: false,
            reason: `Embeddings already exist (${stats.totalChunks} chunks from ${stats.totalFiles} files)`,
            projectId,
          };
        }
      }

      // Start generation in background
      this.startBackgroundGeneration(projectId, projectPath, options);

      return {
        started: true,
        reason: 'Background embedding generation started',
        projectId,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('❌ Failed to trigger background embedding generation', {
        projectPath,
        error: errorMsg,
      });

      return {
        started: false,
        reason: `Failed to start: ${errorMsg}`,
        projectId: '',
      };
    }
  }

  /**
   * Start background generation (fire and forget)
   */
  private startBackgroundGeneration(
    projectId: string,
    projectPath: string,
    options?: {
      batchSize?: number;
      rateLimit?: number;
    }
  ): void {
    // Mark as generating
    this.activeGenerations.set(projectId, {
      projectId,
      projectPath,
      isGenerating: true,
      startedAt: new Date(),
    });

    logger.info('🚀 Starting background embedding generation', {
      projectId,
      projectPath,
    });

    // Run generation in background (don't await)
    this.embeddingGenerator
      .generateProjectEmbeddings(projectId, projectPath, {
        batchSize: options?.batchSize || 10,
        rateLimit: options?.rateLimit || 1000,
        maxChunkSize: 1500,
        filePatterns: [
          '**/*.{ts,tsx,js,jsx,py,go,rs,java,cpp,c,h,hpp,cs,rb,php,swift,kt,scala,clj,hs,ml,r,sql,sh,bash,zsh,md}',
        ],
      })
      .then(progress => {
        // Update status with completion
        this.activeGenerations.set(projectId, {
          projectId,
          projectPath,
          isGenerating: false,
          startedAt: this.activeGenerations.get(projectId)?.startedAt,
          completedAt: new Date(),
          progress: {
            totalFiles: progress.totalFiles,
            processedFiles: progress.processedFiles,
            totalChunks: progress.totalChunks,
            embeddings: progress.embeddings,
          },
        });

        logger.info('✅ Background embedding generation completed', {
          projectId,
          filesProcessed: progress.processedFiles,
          chunksCreated: progress.totalChunks,
          embeddings: progress.embeddings,
          errors: progress.errors.length,
          duration: this.activeGenerations.get(projectId)?.completedAt
            ? Math.round(
                (this.activeGenerations.get(projectId)!.completedAt!.getTime() -
                  this.activeGenerations.get(projectId)!.startedAt!.getTime()) /
                  1000
              )
            : 0,
        });

        // Clean up after 5 minutes
        setTimeout(
          () => {
            this.activeGenerations.delete(projectId);
          },
          5 * 60 * 1000
        );
      })
      .catch(error => {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error('❌ Background embedding generation failed', {
          projectId,
          error: errorMsg,
        });

        // Update status with error
        this.activeGenerations.set(projectId, {
          projectId,
          projectPath,
          isGenerating: false,
          startedAt: this.activeGenerations.get(projectId)?.startedAt,
          completedAt: new Date(),
          error: errorMsg,
        });

        // Clean up after 1 minute on error
        setTimeout(() => {
          this.activeGenerations.delete(projectId);
        }, 60 * 1000);
      });
  }

  /**
   * Check if embeddings are currently being generated for a project
   */
  isGenerating(projectId: string): boolean {
    const status = this.activeGenerations.get(projectId);
    return status?.isGenerating === true;
  }

  /**
   * Get generation status for a project
   */
  getGenerationStatus(projectId: string): GenerationStatus | null {
    return this.activeGenerations.get(projectId) || null;
  }

  /**
   * Get all active generations
   */
  getAllActiveGenerations(): GenerationStatus[] {
    return Array.from(this.activeGenerations.values());
  }

  /**
   * Wait for generation to complete (with timeout)
   */
  async waitForGeneration(
    projectId: string,
    timeoutMs: number = 60000
  ): Promise<GenerationStatus | null> {
    const startTime = Date.now();

    while (this.isGenerating(projectId)) {
      if (Date.now() - startTime > timeoutMs) {
        logger.warn('⏱️ Timeout waiting for embedding generation', {
          projectId,
          timeoutMs,
        });
        return null;
      }

      // Wait 1 second before checking again
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    return this.getGenerationStatus(projectId);
  }
}

// Export singleton instance getter
export function getBackgroundEmbeddingManager(): BackgroundEmbeddingManager {
  return BackgroundEmbeddingManager.getInstance();
}
