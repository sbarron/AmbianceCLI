/**
 * @fileOverview: Enhanced semantic compactor with local embedding support for improved context generation
 * @module: EnhancedSemanticCompactor
 * @keyFunctions:
 *   - generateEnhancedContext(): Context generation with embedding-based similarity search
 *   - ensureEmbeddings(): Generate embeddings if needed and enabled
 *   - searchSimilarContent(): Find relevant code using embedding similarity
 *   - hybridContextGeneration(): Combine AST analysis with embedding search
 * @dependencies:
 *   - semanticCompactor: Core semantic compaction functionality
 *   - embeddingGenerator: Local embedding generation service
 *   - embeddingStorage: SQLite-based embedding persistence
 * @context: Enhances the existing semantic compaction with embedding-based similarity search for more relevant context when local storage is enabled
 */

import { logger } from '../utils/logger';
import { LocalEmbeddingGenerator, GenerationOptions } from './embeddingGenerator';
import { LocalEmbeddingStorage, SimilarChunk } from './embeddingStorage';
import { semanticCompactor } from '../core/compactor/semanticCompactor';
import { ProjectIdentifier } from './projectIdentifier';
import { openaiService } from '../core/openaiService';
import { compileExcludePatterns, isExcludedPath } from '../tools/utils/toolHelpers';

export interface EnhancedContextOptions {
  projectPath: string;
  maxTokens?: number;
  query?: string;
  taskType?: 'debug' | 'implement' | 'understand' | 'refactor';
  format?: 'xml' | 'structured' | 'compact' | 'enhanced';
  excludePatterns?: string[];

  // Embedding options
  useEmbeddings?: boolean;
  embeddingSimilarityThreshold?: number;
  maxSimilarChunks?: number;
  generateEmbeddingsIfMissing?: boolean;
  embeddingOptions?: GenerationOptions;
}

export interface EnhancedContextResult {
  content: string;
  metadata: {
    totalFiles: number;
    includedFiles: number;
    tokenCount: number;
    compressionRatio: number;
    embeddingsUsed: boolean;
    similarChunksFound: number;
    embeddingStats?: {
      totalEmbeddings: number;
      searchTime: number;
    };
    embeddingGenerationStatus?: {
      isGenerating: boolean;
      message: string;
      startedAt?: Date;
    };
  };
}

export class EnhancedSemanticCompactor {
  private embeddingGenerator: LocalEmbeddingGenerator;
  private embeddingStorage: LocalEmbeddingStorage;
  private projectIdentifier: ProjectIdentifier;

  constructor() {
    this.embeddingGenerator = new LocalEmbeddingGenerator();
    this.embeddingStorage = new LocalEmbeddingStorage();
    this.projectIdentifier = new ProjectIdentifier();
  }

  /**
   * Generate enhanced context with optional embedding-based similarity search
   */
  async generateEnhancedContext(options: EnhancedContextOptions): Promise<EnhancedContextResult> {
    const startTime = Date.now();

    logger.info('🚀 Starting enhanced context generation', {
      projectPath: options.projectPath,
      query: options.query || '(no query)',
      useEmbeddings: options.useEmbeddings !== false && LocalEmbeddingStorage.isEnabled(),
      taskType: options.taskType || 'understand',
    });

    // Handle exclude patterns by creating a temporary directory if needed
    let analysisPath = options.projectPath;
    let cleanupTempDir: (() => Promise<void>) | null = null;

    try {
      // Get project info
      const projectInfo = await this.projectIdentifier.identifyProject(options.projectPath);
      const projectId = projectInfo.id;

      const excludeRegexes = compileExcludePatterns(options.excludePatterns);

      if (excludeRegexes.length > 0) {
        const fs = require('fs').promises;
        const path = require('path');
        const os = require('os');
        const { FileDiscovery } = await import('../core/compactor/fileDiscovery.js');

        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'enhanced-context-'));
        logger.info('📁 Creating temporary directory for exclude pattern filtering', { tempDir });

        try {
          const fileDiscovery = new FileDiscovery(options.projectPath, {
            maxFileSize: 200000,
          });

          let allFiles = await fileDiscovery.discoverFiles();

          allFiles = allFiles.filter(file => !isExcludedPath(file.relPath, excludeRegexes));

          logger.info('📊 Applied exclude patterns to enhanced context', {
            filteredCount: allFiles.length,
            excludePatterns: options.excludePatterns,
          });

          // Copy filtered files to temp directory
          for (const file of allFiles) {
            const sourcePath = file.absPath;
            const relativePath = path.relative(options.projectPath, sourcePath);
            const destPath = path.join(tempDir, relativePath);

            await fs.mkdir(path.dirname(destPath), { recursive: true });
            await fs.copyFile(sourcePath, destPath);
          }

          analysisPath = tempDir;
          cleanupTempDir = async () => {
            try {
              await fs.rm(tempDir, { recursive: true, force: true });
              logger.debug('🧹 Cleaned up temporary directory', { tempDir });
            } catch (error) {
              logger.warn('Failed to cleanup temporary directory', { tempDir, error });
            }
          };
        } catch (error) {
          // Clean up temp directory on error
          try {
            await fs.rm(tempDir, { recursive: true, force: true });
          } catch {}
          throw error;
        }
      }

      // First, generate standard semantic compaction
      let baseContext: any = null;
      try {
        logger.debug('🔧 Starting base semantic compaction', {
          projectPath: options.projectPath,
          maxTokens: options.maxTokens,
        });

        baseContext = await semanticCompactor.compactProject(analysisPath, {
          maxTokens: options.maxTokens,
          maxTotalTokens: options.maxTokens,
          includeSourceCode: false,
          includeDocstrings: true,
        });

        logger.debug('✅ Base semantic compaction completed', {
          hasBaseContext: !!baseContext,
          hasCompactedContent: !!baseContext?.compactedContent,
          hasProcessingStats: !!baseContext?.processingStats,
          processingStatsKeys: baseContext?.processingStats
            ? Object.keys(baseContext.processingStats)
            : [],
          totalTokens: baseContext?.totalTokens,
          compressionRatio: baseContext?.compressionRatio,
        });
      } catch (error) {
        logger.warn('⚠️ Standard semantic compaction failed, continuing with embeddings only', {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      logger.debug('🏗️ Building initial result object', {
        baseContextExists: !!baseContext,
        baseProcessingStats: baseContext?.processingStats,
        totalFiles: baseContext?.processingStats?.totalFiles,
        filesProcessed: baseContext?.processingStats?.filesProcessed,
        totalTokens: baseContext?.totalTokens,
        compressionRatio: baseContext?.compressionRatio,
      });

      // Generate fallback content if base context failed
      const fallbackContent =
        baseContext?.compactedContent ||
        `# Context Generation Notice

No context could be generated from the project at: ${options.projectPath}

This might happen if:
- The directory contains too many files
- No supported code files were found  
- File access permissions are restrictive

Try using a more specific directory or check the project path.`;

      let result: EnhancedContextResult = {
        content: fallbackContent,
        metadata: {
          totalFiles: baseContext?.processingStats?.totalFiles || 0,
          includedFiles: baseContext?.processingStats?.filesProcessed || 0,
          tokenCount: baseContext?.totalTokens || fallbackContent.length,
          compressionRatio: baseContext?.compressionRatio || 1,
          embeddingsUsed: false,
          similarChunksFound: 0,
        },
      };

      logger.debug('✅ Initial result object created', {
        contentLength: result.content.length,
        metadata: result.metadata,
      });

      // If embeddings are enabled and we have a query, enhance with similarity search
      logger.debug('🔍 Checking embedding enhancement conditions', {
        useEmbeddingsOption: options.useEmbeddings,
        useEmbeddingsCondition: options.useEmbeddings !== false,
        localStorageEnabled: LocalEmbeddingStorage.isEnabled(),
        hasQuery: !!options.query,
        willEnhance:
          options.useEmbeddings !== false && LocalEmbeddingStorage.isEnabled() && !!options.query,
      });

      if (options.useEmbeddings !== false && LocalEmbeddingStorage.isEnabled() && options.query) {
        logger.debug('🚀 Starting embedding enhancement', {
          projectId,
          query: options.query,
          baseContextType: typeof baseContext,
          baseContextNull: baseContext === null,
          baseContextUndefined: baseContext === undefined,
        });

        try {
          const enhancedResult = await this.enhanceWithEmbeddings(projectId, options, baseContext);

          logger.debug('📊 Embedding enhancement result', {
            enhancedResultExists: !!enhancedResult,
            enhancedResultType: typeof enhancedResult,
            enhancedMetadata: enhancedResult?.metadata,
          });

          if (enhancedResult) {
            result = enhancedResult;
            logger.debug('✅ Using enhanced result', {
              finalMetadata: result.metadata,
            });
          }
        } catch (error) {
          logger.warn('⚠️ Embedding enhancement failed, using base context', {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
          });
        }
      }

      const totalTime = Date.now() - startTime;

      // Add embedding generation status to metadata
      const { getBackgroundEmbeddingManager } = await import('./backgroundEmbeddingManager');
      const bgManager = getBackgroundEmbeddingManager();
      const generationStatus = bgManager.getGenerationStatus(projectId);

      if (generationStatus?.isGenerating) {
        result.metadata.embeddingGenerationStatus = {
          isGenerating: true,
          message: `Embeddings are being generated in the background (started ${Math.round((Date.now() - generationStatus.startedAt!.getTime()) / 1000)}s ago)`,
          startedAt: generationStatus.startedAt,
        };
      }

      logger.info('✅ Enhanced context generation completed', {
        tokenCount: result.metadata.tokenCount,
        embeddingsUsed: result.metadata.embeddingsUsed,
        similarChunks: result.metadata.similarChunksFound,
        processingTime: `${totalTime}ms`,
        embeddingGenerationInProgress: generationStatus?.isGenerating || false,
      });

      // Clean up temporary directory if created
      if (cleanupTempDir) {
        try {
          await cleanupTempDir();
        } catch (cleanupError) {
          logger.warn('Failed to cleanup temporary directory', { error: cleanupError });
        }
      }

      return result;
    } catch (error) {
      // Clean up temporary directory on error
      if (cleanupTempDir) {
        try {
          await cleanupTempDir();
        } catch (cleanupError) {
          logger.warn('Failed to cleanup temporary directory on error', { error: cleanupError });
        }
      }

      logger.error('❌ Enhanced context generation failed', {
        error: error instanceof Error ? error.message : String(error),
        projectPath: options.projectPath,
      });
      throw error;
    }
  }

  /**
   * Enhance context using embedding similarity search
   */
  private async enhanceWithEmbeddings(
    projectId: string,
    options: EnhancedContextOptions,
    baseContext: any
  ): Promise<EnhancedContextResult | null> {
    const searchStart = Date.now();

    // Ensure embeddings exist
    await this.ensureEmbeddings(projectId, options.projectPath, options);

    // Get embeddings stats - check both current and legacy project IDs
    let stats = await this.embeddingStorage.getProjectStats(projectId);
    let actualProjectId = projectId;

    // If no embeddings found under current ID, try legacy ID (sha256/16)
    if (!stats || stats.totalChunks === 0) {
      const legacyProjectId = require('crypto')
        .createHash('sha256')
        .update(options.projectPath)
        .digest('hex')
        .substring(0, 16);
      const legacyStats = await this.embeddingStorage.getProjectStats(legacyProjectId);

      if (legacyStats && legacyStats.totalChunks > 0) {
        logger.info('🔄 Found embeddings under legacy project ID, using legacy data', {
          originalId: projectId,
          legacyId: legacyProjectId,
          legacyEmbeddings: legacyStats.totalChunks,
        });
        stats = legacyStats;
        actualProjectId = legacyProjectId;
      }
    }

    if (!stats || stats.totalChunks === 0) {
      // Check if generation is in progress
      const { getBackgroundEmbeddingManager } = await import('./backgroundEmbeddingManager');
      const bgManager = getBackgroundEmbeddingManager();
      const generationStatus = bgManager.getGenerationStatus(projectId);

      if (generationStatus?.isGenerating) {
        logger.info('⏳ Embeddings generation in progress - using fallback context', {
          projectId,
          startedAt: generationStatus.startedAt,
          elapsedSeconds: Math.round((Date.now() - generationStatus.startedAt!.getTime()) / 1000),
        });
      } else {
        logger.info('📭 No embeddings found for project (will be generated in background)', {
          projectId,
        });
      }
      return null;
    }

    // Check embedding model compatibility before searching
    const currentProvider = this.embeddingGenerator.getCurrentProvider();
    const currentDimensions = this.embeddingGenerator.getCurrentDimensions();
    const compatibility = await this.embeddingStorage.validateEmbeddingCompatibility(
      actualProjectId,
      currentProvider,
      currentDimensions
    );
    if (!compatibility.compatible) {
      logger.warn('⚠️ Embedding model compatibility issue detected', {
        issues: compatibility.issues,
        recommendations: compatibility.recommendations,
      });

      // Provide agent-friendly guidance for this common issue
      logger.info('🔧 EMBEDDING COMPATIBILITY ISSUE - ACTION REQUIRED', {
        diagnosis: 'Stored embeddings use different model than current configuration',
        immediateAction: 'Call manage_embeddings (action="migrate") to fix this issue',
        toolSequence: [
          '1. manage_embeddings {"action": "status", "projectPath": "your_project_path"}',
          '2. manage_embeddings {"action": "migrate", "projectPath": "your_project_path", "force": true}',
          '3. Retry your original query',
        ],
        commonCause: 'Switching between local (Xenova) and cloud (OpenAI) embedding providers',
        estimatedFixTime: '1-10 minutes depending on project size',
      });

      // Still try the search, but warn user about potential poor results
      logger.warn(
        '🔍 Proceeding with similarity search despite compatibility issues - results may be suboptimal'
      );
    }

    logger.info('🔍 Searching for similar content using embeddings', {
      query: options.query,
      totalEmbeddings: stats.totalChunks,
      modelCompatible: compatibility.compatible,
    });

    // Generate query embedding using same model as stored embeddings (if possible)
    logger.debug('🔍 Generating query embedding', {
      query: options.query,
      projectId: actualProjectId,
    });

    const queryEmbedding = await this.embeddingGenerator.generateQueryEmbedding(
      options.query!,
      actualProjectId
    );

    logger.debug('✅ Query embedding generated', {
      query: options.query,
      embeddingLength: queryEmbedding.length,
      embeddingPreview: queryEmbedding.slice(0, 5),
    });

    // Use consistent threshold - let's try a lower threshold first to see if we can find relevant chunks
    const similarityThreshold = options.embeddingSimilarityThreshold || 0.1; // Lower threshold for better recall

    // Search for similar chunks (get more than we need to see what's available)
    const allSimilarChunks = await this.embeddingStorage.searchSimilarEmbeddings(
      actualProjectId,
      queryEmbedding,
      Math.max(options.maxSimilarChunks || 10, 20), // Get more chunks to analyze
      0.0 // Get all chunks above 0 similarity first
    );

    logger.info('🔍 Raw similarity search results', {
      query: options.query,
      totalChunksFound: allSimilarChunks.length,
      allSimilarities: allSimilarChunks.map(c => ({
        similarity: c.similarity.toFixed(3),
        filePath: c.chunk.filePath.split('/').pop(), // Just filename
        startLine: c.chunk.metadata.startLine,
      })),
    });

    // Apply the similarity threshold
    const similarChunks = allSimilarChunks.filter(chunk => chunk.similarity >= similarityThreshold);

    const searchTime = Date.now() - searchStart;

    if (similarChunks.length === 0) {
      logger.info('🔍 No similar chunks found above threshold', {
        threshold: similarityThreshold,
        query: options.query,
        projectId: actualProjectId,
        totalEmbeddings: stats.totalChunks,
      });

      // If no chunks found and we have compatibility issues, provide specific guidance
      if (!compatibility.compatible) {
        logger.error('❌ SIMILARITY SEARCH FAILED - MODEL COMPATIBILITY ISSUE', {
          problem: 'No chunks found above similarity threshold',
          rootCause: "Query embedding model doesn't match stored embedding model",
          immediateFix:
            'Call manage_embeddings (action="migrate") to regenerate embeddings with current model',
          toolCalls: [
            'manage_embeddings {"action": "status", "projectPath": "your_project_path"}',
            'manage_embeddings {"action": "migrate", "projectPath": "your_project_path", "force": true, "batchSize": 20}',
            'Retry your original AI context query',
          ],
          expectedResult: 'Similarity search will work and return relevant context',
        });
      }

      return null;
    }

    // Log successful similarity search results
    logger.info('✅ Similarity search found chunks above threshold', {
      query: options.query,
      chunksFound: similarChunks.length,
      totalRawChunks: allSimilarChunks.length,
      topSimilarities: similarChunks.slice(0, 3).map(c => ({
        similarity: c.similarity.toFixed(3),
        filePath: c.chunk.filePath,
        startLine: c.chunk.metadata.startLine,
      })),
      threshold: similarityThreshold,
      chunksBelowThreshold: allSimilarChunks.length - similarChunks.length,
    });

    // Sort and limit chunks first
    const maxChunks = options.maxSimilarChunks || 10;
    const sortedChunks = similarChunks
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, maxChunks);

    // Combine base context with similar chunks
    logger.debug('🔗 Combining base context with similar chunks', {
      baseContextExists: !!baseContext,
      baseContextType: typeof baseContext,
      baseContextContent: baseContext?.compactedContent?.length || 0,
      baseProcessingStats: baseContext?.processingStats,
      similarChunksCount: similarChunks.length,
      sortedChunksCount: sortedChunks.length,
    });

    const enhancedContent = await this.combineContextWithSimilarChunks(
      baseContext?.compactedContent || '',
      sortedChunks,
      options
    );

    logger.debug('🏗️ Building enhanced result metadata', {
      baseContext_exists: !!baseContext,
      baseContext_processingStats: baseContext?.processingStats,
      totalFiles_raw: baseContext?.processingStats?.totalFiles,
      filesProcessed_raw: baseContext?.processingStats?.filesProcessed,
      totalTokens_raw: baseContext?.totalTokens,
      compressionRatio_raw: baseContext?.compressionRatio,
    });

    // Calculate approximate token count for the focused results
    const focusedTokenCount = Math.ceil(enhancedContent.length / 4); // Rough token estimation

    const enhancedResult = {
      content: enhancedContent,
      metadata: {
        totalFiles: sortedChunks.length, // Number of files represented in chunks
        includedFiles: sortedChunks.length,
        tokenCount: focusedTokenCount,
        compressionRatio: baseContext?.totalTokens
          ? focusedTokenCount / baseContext.totalTokens
          : 1,
        embeddingsUsed: true,
        similarChunksFound: similarChunks.length,
        embeddingStats: {
          totalEmbeddings: stats.totalChunks,
          searchTime,
          chunksShown: sortedChunks.length,
          avgSimilarity:
            sortedChunks.length > 0
              ? sortedChunks.reduce((sum: number, chunk: any) => sum + chunk.similarity, 0) /
                sortedChunks.length
              : 0,
        },
      },
    };

    logger.debug('✅ Enhanced result created successfully', {
      contentLength: enhancedResult.content.length,
      metadata: enhancedResult.metadata,
    });

    return enhancedResult;
  }

  /**
   * Ensure embeddings exist for the project (non-blocking)
   * Triggers background generation if needed but doesn't wait for completion
   */
  private async ensureEmbeddings(
    projectId: string,
    projectPath: string,
    options: EnhancedContextOptions
  ): Promise<void> {
    // Import background manager dynamically to avoid circular dependencies
    const { getBackgroundEmbeddingManager } = await import('./backgroundEmbeddingManager');
    const bgManager = getBackgroundEmbeddingManager();

    // Proceed with generation as long as local storage is enabled
    if (!LocalEmbeddingStorage.isEnabled()) {
      logger.info('💡 Embedding generation not available - local storage disabled');
      return;
    }

    // Check if embeddings exist
    const stats = await this.embeddingStorage.getProjectStats(projectId);

    // Check if currently generating
    const isGenerating = bgManager.isGenerating(projectId);

    if (!stats && options.generateEmbeddingsIfMissing !== false && !isGenerating) {
      // Trigger background generation (non-blocking)
      const result = await bgManager.triggerEmbeddingGeneration(projectPath, {
        batchSize: 10,
        rateLimit: 1000,
      });

      if (result.started) {
        logger.info('🚀 Background embedding generation triggered (non-blocking)', {
          projectId,
          projectPath,
        });
      } else {
        logger.debug('ℹ️ Embedding generation not started', {
          projectId,
          reason: result.reason,
        });
      }
    } else if (isGenerating) {
      logger.info('⏳ Embeddings are currently being generated in the background', {
        projectId,
        status: bgManager.getGenerationStatus(projectId),
      });
    } else if (stats) {
      logger.debug('📊 Using existing embeddings', {
        projectId,
        totalChunks: stats.totalChunks,
        totalFiles: stats.totalFiles,
        lastUpdated: stats.lastUpdated,
      });
    }
  }

  /**
   * Generate focused context from similar chunks (already sorted and limited)
   * When we have good embedding matches, return ONLY the top relevant chunks
   */
  private async combineContextWithSimilarChunks(
    baseContent: string,
    sortedChunks: SimilarChunk[],
    options: EnhancedContextOptions
  ): Promise<string> {
    const format = options.format || 'structured';

    // Instead of adding to base context, return ONLY the relevant chunks
    logger.debug('🎯 Generating focused embedding results', {
      chunksToProcess: sortedChunks.length,
      format,
      avgSimilarity:
        sortedChunks.length > 0
          ? (
              sortedChunks.reduce((sum, chunk) => sum + chunk.similarity, 0) / sortedChunks.length
            ).toFixed(3)
          : 0,
    });

    // Generate content with ONLY the relevant chunks
    let enhancedContent = '';

    if (format === 'xml') {
      // XML format - focused embedding results only
      const similarChunksXml = sortedChunks
        .map(
          item => `
    <relevant_chunk similarity="${item.similarity.toFixed(3)}" file="${item.chunk.filePath}" lines="${item.chunk.metadata.startLine}-${item.chunk.metadata.endLine}">
      <content>${this.escapeXml(item.chunk.content)}</content>
      <symbols>${item.chunk.metadata.symbols?.join(', ') || ''}</symbols>
    </relevant_chunk>`
        )
        .join('\n');

      enhancedContent = `<?xml version="1.0" encoding="UTF-8"?>
<focused_context>
  <query>${this.escapeXml(options.query || '')}</query>
  <similarity_threshold>${options.embeddingSimilarityThreshold || 0.2}</similarity_threshold>
  <chunks_shown>${sortedChunks.length}</chunks_shown>
  <results>${similarChunksXml}
  </results>
</focused_context>`;
    } else if (format === 'structured') {
      // Structured format - focused embedding results only
      enhancedContent =
        `# 🎯 Focused Context Results

## Query Information
- **Query:** "${options.query || 'N/A'}"
- **Similarity Threshold:** ${(options.embeddingSimilarityThreshold || 0.2) * 100}%
- **Chunks Shown:** ${sortedChunks.length} (most relevant)

## Relevant Code Sections
` +
        sortedChunks
          .map(
            (item, index) => `
### ${index + 1}. ${item.chunk.filePath} (${(item.similarity * 100).toFixed(1)}% similar)
**Lines:** ${item.chunk.metadata.startLine}-${item.chunk.metadata.endLine} | **Language:** ${item.chunk.metadata.language || 'unknown'}
${item.chunk.metadata.symbols?.length ? `**Symbols:** ${item.chunk.metadata.symbols.join(', ')}\n` : ''}
\`\`\`${item.chunk.metadata.language || 'text'}
${item.chunk.content}
\`\`\``
          )
          .join('\n');
    } else if (format === 'enhanced' || format === 'compact') {
      // Enhanced/Compact format - focused results with smart chunk limiting
      // Use maxSimilarChunks from options, or default to 10 for enhanced, 5 for compact
      const maxDisplayChunks = format === 'compact' ? 5 : options.maxSimilarChunks || 10;
      const displayChunks = Math.min(sortedChunks.length, maxDisplayChunks);

      enhancedContent =
        `🎯 FOCUSED RESULTS | Query: "${options.query || 'N/A'}" | Threshold: ${(options.embeddingSimilarityThreshold || 0.2) * 100}%\n` +
        `Showing ${displayChunks} most relevant chunks:\n\n` +
        sortedChunks
          .slice(0, displayChunks)
          .map(
            (item, index) =>
              `${index + 1}. ${item.chunk.filePath}:${item.chunk.metadata.startLine} (${(item.similarity * 100).toFixed(0)}%)\n${item.chunk.content}`
          )
          .join('\n---\n');
    } else {
      // Fallback to structured format for unknown formats
      enhancedContent =
        `# 🎯 Focused Context Results

## Query Information
- **Query:** "${options.query || 'N/A'}"
- **Similarity Threshold:** ${(options.embeddingSimilarityThreshold || 0.2) * 100}%
- **Chunks Shown:** ${sortedChunks.length} (most relevant)

## Relevant Code Sections
` +
        sortedChunks
          .map(
            (item, index) => `
### ${index + 1}. ${item.chunk.filePath} (${(item.similarity * 100).toFixed(1)}% similar)
**Lines:** ${item.chunk.metadata.startLine}-${item.chunk.metadata.endLine} | **Language:** ${item.chunk.metadata.language || 'unknown'}
${item.chunk.metadata.symbols?.length ? `**Symbols:** ${item.chunk.metadata.symbols.join(', ')}\n` : ''}
\`\`\`${item.chunk.metadata.language || 'text'}
${item.chunk.content}
\`\`\``
          )
          .join('\n');
    }

    return enhancedContent;
  }

  /**
   * Escape XML special characters
   */
  private escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Get embedding statistics for a project
   */
  async getEmbeddingStats(projectPath: string): Promise<{
    hasEmbeddings: boolean;
    totalChunks: number;
    totalFiles: number;
    lastUpdated?: Date;
  } | null> {
    if (!LocalEmbeddingStorage.isEnabled()) {
      return null;
    }

    try {
      const projectInfo = await this.projectIdentifier.identifyProject(projectPath);
      const stats = await this.embeddingStorage.getProjectStats(projectInfo.id);

      if (stats) {
        return {
          hasEmbeddings: true,
          totalChunks: stats.totalChunks,
          totalFiles: stats.totalFiles,
          lastUpdated: stats.lastUpdated,
        };
      }

      return {
        hasEmbeddings: false,
        totalChunks: 0,
        totalFiles: 0,
      };
    } catch (error) {
      logger.error('❌ Failed to get embedding stats', {
        error: error instanceof Error ? error.message : String(error),
        projectPath,
      });
      return null;
    }
  }

  /**
   * Check if enhanced context generation is available
   */
  static isEnhancedModeAvailable(): boolean {
    return LocalEmbeddingStorage.isEnabled();
  }
}

// Export default instance
export const enhancedSemanticCompactor = new EnhancedSemanticCompactor();
