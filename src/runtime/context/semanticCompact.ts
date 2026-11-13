/**
 * @fileOverview: Runtime handler for local semantic compaction (local_context)
 */

import { formatEnhancedContextOutput } from '../../tools/localTools/formatters/enhancedContextFormatter';
import { SemanticCompactor } from '../../core/compactor/semanticCompactor';
import {
  enhancedSemanticCompactor,
  EnhancedSemanticCompactor,
} from '../../local/enhancedSemanticCompactor';
import { sharedRetriever } from '../../shared/retrieval/retriever';
import { logger } from '../../utils/logger';
import {
  compileExcludePatterns,
  estimateTokens as estimateTokensShared,
  isExcludedPath,
  truncateToTokens,
} from '../../tools/utils/toolHelpers';
import { formatContextOutput } from '../../tools/localTools/formatters/contextFormatters';
import {
  systemMapComposer,
  formatSystemMapAsMarkdown,
} from '../../tools/localTools/systemMapComposer';
import { validateAndResolvePath } from '../utils/pathUtils';
import * as path from 'path';
import type {
  LocalContextResponse,
  SemanticChunkMatch,
} from '../../tools/localTools/enhancedLocalContext';

// Simple single-flight guard to avoid duplicate concurrent runs for the same key
const inFlightRequests: Map<string, Promise<any>> = new Map();

/**
 * Handler for semantic compaction requests
 */
export async function handleSemanticCompact(args: any): Promise<any> {
  // Validate that projectPath is provided
  if (!args?.projectPath) {
    throw new Error(
      '❌ projectPath is required. Please provide an absolute path to the project directory.'
    );
  }

  // Compose a single-flight key early to dedupe duplicate concurrent calls
  const singleFlightKey = (() => {
    try {
      const q = (args?.query || '').toString().slice(0, 200);
      const p = validateAndResolvePath(args.projectPath);
      const f = args?.format || 'enhanced';
      const s = args?.autoSync ? 'sync' : 'nosync';
      const e = args?.disableEmbeddings === true ? 'embeddings-off' : 'embeddings-auto';
      return `${path.resolve(p)}::${f}::${q}::${s}::${e}`;
    } catch {
      return `default-key`;
    }
  })();

  if (inFlightRequests.has(singleFlightKey)) {
    logger.info('🔁 Single-flight: returning existing in-flight result for local_context', {
      key: singleFlightKey,
    });
    return inFlightRequests.get(singleFlightKey)!;
  }

  const execute = async () => {
    try {
      const {
        // New enhanced parameters
        query,
        taskType = 'understand',
        maxSimilarChunks = 20,
        maxTokens = 3000,
        autoSync = false,
        autoSyncBatchSize = 10,
        // If undefined, we will auto-generate embeddings when missing
        generateEmbeddingsIfMissing,
        useProjectHintsCache = true,
        astQueries = [],
        attackPlan = 'auto',
        format = 'enhanced',
        excludePatterns = [],
        // Legacy parameters for backward compatibility
        projectPath,
        folderPath,
        useEmbeddings = false,
        // Internal bounded-call escape hatch. Unlike useEmbeddings=false, this
        // also prevents auto-enabling an existing project embedding index.
        disableEmbeddings = false,
        embeddingSimilarityThreshold = 0.2,
        showmetadata = false,
      } = args;

      const excludeRegexes = compileExcludePatterns(excludePatterns);

      // Validate and resolve project path (now required)
      const resolvedProjectPath = validateAndResolvePath(projectPath);

      // ──────────────────────────────────────────────────────────────────
      // Embedding lifecycle: ALWAYS ensure embeddings exist & are fresh
      // before running any context query.  This runs regardless of flags.
      // ──────────────────────────────────────────────────────────────────
      let embeddingsEnabled =
        !disableEmbeddings && (process.env.USE_LOCAL_EMBEDDINGS === 'true' || useEmbeddings);

      // Auto-enable embeddings if they exist for the project, unless explicitly disabled
      if (
        !disableEmbeddings &&
        !embeddingsEnabled &&
        process.env.USE_LOCAL_EMBEDDINGS !== 'false'
      ) {
        try {
          const { LocalEmbeddingStorage } = await import('../../local/embeddingStorage');
          const { ProjectIdentifier } = await import('../../local/projectIdentifier');
          const storage = new LocalEmbeddingStorage();
          const projectInfo =
            await ProjectIdentifier.getInstance().identifyProject(resolvedProjectPath);
          const stats = await storage.getProjectStats(projectInfo.id);
          if (stats && stats.totalChunks > 0) {
            embeddingsEnabled = true;
            process.env.USE_LOCAL_EMBEDDINGS = 'true'; // For downstream sync managers
            logger.info(
              '🧠 Automatically enabled local embeddings because they were found for this project'
            );
          }
        } catch (error) {
          // ignore auto-detect error
        }
      }

      let embeddingSync: any = {
        enabled: embeddingsEnabled,
        checked: false,
        updated: false,
      };

      if (embeddingsEnabled) {
        try {
          const { LocalEmbeddingStorage } = await import('../../local/embeddingStorage');

          if (LocalEmbeddingStorage.isEnabled()) {
            const { checkStaleFiles, createProjectEmbeddings } = await import(
              '../embeddings/manageEmbeddings'
            );
            const { recordSync } = await import('../../local/autoSyncManager');
            const { ProjectIdentifier } = await import('../../local/projectIdentifier');

            const storage = new LocalEmbeddingStorage();
            const projectInfo =
              await ProjectIdentifier.getInstance().identifyProject(resolvedProjectPath);
            const projectId = projectInfo.id;

            const normalizedBatchSize =
              typeof autoSyncBatchSize === 'number' && Number.isFinite(autoSyncBatchSize)
                ? Math.max(1, Math.min(Math.floor(autoSyncBatchSize), 100))
                : 10;

            // Step 1: Check if any embeddings exist at all
            const stats = await storage.getProjectStats(projectId);
            const hasEmbeddings = stats && stats.totalChunks > 0;

            if (!hasEmbeddings && generateEmbeddingsIfMissing !== false) {
              // No embeddings at all — bootstrap them now (blocking)
              logger.info('🧱 No embeddings found for project; creating now before context query', {
                projectPath: resolvedProjectPath,
                projectId,
              });
              await createProjectEmbeddings({
                projectPath: resolvedProjectPath,
                batchSize: normalizedBatchSize,
              });
              await recordSync(projectId);
              embeddingSync = {
                enabled: true,
                checked: true,
                updated: true,
                mode: 'initial-create',
                message: 'No embeddings existed; created project embeddings before retrieval.',
              };
              logger.info('✅ Initial embeddings created', { projectPath: resolvedProjectPath });
            } else if (hasEmbeddings) {
              // Step 2: Embeddings exist; check actual file freshness before retrieval.
              logger.info('Checking embedding freshness before context query', {
                projectPath: resolvedProjectPath,
                forced: autoSync,
              });

              const syncResult = await checkStaleFiles({
                projectPath: resolvedProjectPath,
                autoUpdate: true,
                batchSize: normalizedBatchSize,
              });

              const pendingFileCount =
                (syncResult?.staleCount ?? 0) +
                (syncResult?.newCount ?? 0) +
                (syncResult?.incompleteCount ?? 0);
              const updateSucceeded = Boolean(syncResult?.updateResult?.success);

              embeddingSync = {
                enabled: true,
                checked: true,
                updated: updateSucceeded,
                mode: 'incremental',
                staleCount: syncResult?.staleCount ?? 0,
                newCount: syncResult?.newCount ?? 0,
                incompleteCount: syncResult?.incompleteCount ?? 0,
                missingCount: syncResult?.missingCount ?? 0,
                missingFilesRemoved: syncResult?.missingCleanupResult?.filesRemoved ?? 0,
                missingEmbeddingsDeleted: syncResult?.missingCleanupResult?.embeddingsDeleted ?? 0,
                updateAttempted: pendingFileCount > 0,
                processedFiles: syncResult?.updateResult?.result?.processedFiles ?? 0,
                embeddings: syncResult?.updateResult?.result?.embeddings ?? 0,
                errors: syncResult?.updateResult?.result?.errors ?? [],
                message: syncResult?.message,
              };

              if (updateSucceeded || pendingFileCount === 0) {
                await recordSync(projectId);
              }

              logger.info('Embedding freshness check completed before context query', {
                projectPath: resolvedProjectPath,
                staleCount: embeddingSync.staleCount,
                newCount: embeddingSync.newCount,
                incompleteCount: embeddingSync.incompleteCount,
                missingCount: embeddingSync.missingCount,
                updated: embeddingSync.updated,
                processedFiles: embeddingSync.processedFiles,
                embeddings: embeddingSync.embeddings,
              });
            }
          }
        } catch (syncError) {
          embeddingSync = {
            ...embeddingSync,
            checked: true,
            updated: false,
            error: syncError instanceof Error ? syncError.message : String(syncError),
            message: 'Embedding sync failed; continuing with existing embeddings.',
          };
          logger.warn('⚠️ Embedding sync failed; continuing with context generation', {
            projectPath: resolvedProjectPath,
            error: syncError instanceof Error ? syncError.message : String(syncError),
          });
        }
      }

      // ──────────────────────────────────────────────────────────────────
      // Unified pipeline: always use enhanced local context when query is
      // provided.  Embeddings enhance ranking when available.
      // ──────────────────────────────────────────────────────────────────
      if (query && !folderPath) {
        // System Map is its own specialized format
        if (format === 'system-map') {
          try {
            logger.info('🗺️ Using System Map format', { query });

            const relevantChunks = await sharedRetriever.retrieve(query, 'overview');
            const systemMap = await systemMapComposer.composeSystemMap(query, relevantChunks);
            const systemMapMarkdown = formatSystemMapAsMarkdown(systemMap);
            const tokenCount = estimateTokensShared(systemMapMarkdown);
            const content = truncateToTokens(systemMapMarkdown, maxTokens);

            return {
              success: true,
              content,
              compactedContent: content,
              metadata: {
                originalTokens: tokenCount,
                compactedTokens: Math.min(tokenCount, maxTokens),
                compressionRatio: 1.0,
                filesProcessed: systemMap.metadata.totalChunksUsed,
                symbolsFound: 0,
                symbolsAfterCompaction: 0,
                processingTimeMs: systemMap.metadata.processingTimeMs,
                format: 'system-map',
                coveragePct: systemMap.metadata.coveragePct,
                anchorsHit: systemMap.metadata.anchorsHit,
                queryFacets: systemMap.metadata.queryFacets,
                embeddingSync,
              },
              embeddingSync,
              usage: `System Map analysis: ${Math.min(tokenCount, maxTokens)} tokens with ${systemMap.metadata.coveragePct * 100}% coverage`,
            };
          } catch (error) {
            logger.warn('⚠️ System Map generation failed, falling back to enhanced mode', {
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        // Resolve embedding similarity scores to feed into ranking
        let embeddingScores: Map<string, number> | undefined;
        let semanticMatches: SemanticChunkMatch[] | undefined;
        let embeddingsUsed = false;

        const enhancedAvailable = EnhancedSemanticCompactor.isEnhancedModeAvailable();

        if (embeddingsEnabled && enhancedAvailable) {
          try {
            const { LocalEmbeddingStorage } = await import('../../local/embeddingStorage');
            const { embeddingGenerator } = await import('../../local/embeddingGenerator');
            const { ProjectIdentifier } = await import('../../local/projectIdentifier');

            if (LocalEmbeddingStorage.isEnabled()) {
              const storage = new LocalEmbeddingStorage();
              const projectInfo =
                await ProjectIdentifier.getInstance().identifyProject(resolvedProjectPath);
              const projectId = projectInfo.id;

              // Embeddings were ensured above; now query them
              const stats = await storage.getProjectStats(projectId);
              if (stats && stats.totalChunks > 0) {
                const queryEmbedding = await embeddingGenerator.generateQueryEmbedding(
                  query,
                  projectId
                );
                const similarChunks = await storage.searchSimilarEmbeddings(
                  projectId,
                  queryEmbedding,
                  Math.max(maxSimilarChunks * 10, 150), // Retrieve a deep pool of chunks to guarantee many unique files
                  0.0 // Get all, we'll use similarity as a score
                );

                if (similarChunks.length > 0) {
                  embeddingScores = new Map();
                  semanticMatches = similarChunks.map((sc, index) => ({
                    filePath: sc.chunk.filePath,
                    similarity: sc.similarity,
                    content: sc.chunk.content,
                    startLine: sc.chunk.metadata.startLine,
                    endLine: sc.chunk.metadata.endLine,
                    symbols: sc.chunk.metadata.symbols,
                    type: sc.chunk.metadata.type,
                    semanticRank: index + 1,
                  }));
                  for (const sc of similarChunks) {
                    const filePath = sc.chunk.filePath;
                    // Aggregate: keep max similarity per file
                    const existing = embeddingScores.get(filePath) || 0;
                    if (sc.similarity > existing) {
                      embeddingScores.set(filePath, sc.similarity);
                    }
                  }
                  embeddingsUsed = true;
                  logger.info('🧠 Embedding scores resolved for ranking', {
                    filesWithScores: embeddingScores.size,
                    topScore: Math.max(...embeddingScores.values()),
                    chunks: similarChunks.length,
                  });
                }
              }
            }
          } catch (error) {
            logger.warn('⚠️ Embedding lookup failed; proceeding without embedding scores', {
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        logger.info('🚀 Using enhanced local context mode', {
          query,
          taskType,
          attackPlan,
          maxTokens,
          maxSimilarChunks,
          embeddingsUsed,
        });

        try {
          const { localContext } = await import('../../tools/localTools/enhancedLocalContext');

          const enhancedResult = await localContext({
            projectPath: resolvedProjectPath,
            query,
            taskType: taskType as any,
            maxSimilarChunks,
            maxTokens,
            generateEmbeddingsIfMissing,
            useProjectHintsCache,
            astQueries,
            attackPlan: attackPlan as any,
            excludePatterns,
            embeddingScores,
            semanticMatches,
          });

          if (enhancedResult.success) {
            const content = formatEnhancedContextOutput(enhancedResult, query, maxTokens, format, resolvedProjectPath);
            return {
              success: true,
              content,
              compactedContent: content,
              metadata: {
                ...enhancedResult.metadata,
                filesProcessed: enhancedResult.metadata.filesScanned,
                renderedTokens: estimateTokensShared(content),
              },
              usage: `Enhanced context analysis: ${enhancedResult.metadata.bundleTokens} tokens in ${enhancedResult.jumpTargets.length} locations${embeddingsUsed ? ' (embedding-enhanced)' : ''}`,
              enhanced: true,
              embeddingsUsed,
              embeddingSync,
              jumpTargets: enhancedResult.jumpTargets,
              byFile: enhancedResult.byFile,
              answerDraft: enhancedResult.answerDraft,
              nextActions: enhancedResult.next,
              evidence: enhancedResult.evidence,
              ...(showmetadata ? { llmBundle: enhancedResult.llmBundle } : {}),
            };
          } else {
            logger.warn('Enhanced mode failed, falling back to legacy mode');
          }
        } catch (error) {
          logger.warn('⚠️ Enhanced local context failed, using legacy mode', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // Legacy fallback: folder-specific analysis or no query provided
      logger.info('🔧 Starting local semantic compaction (legacy fallback)', {
        originalPath: projectPath,
        resolvedPath: resolvedProjectPath,
        folderPath,
        maxTokens,
        taskType,
      });

      try {
        // Fall back to standard semantic compaction
        logger.info('📝 Using standard semantic compaction', {
          reason: folderPath
            ? 'Folder-specific analysis'
            : 'No query provided or enhanced mode unavailable',
        });
        // Handle folder-specific analysis if folderPath is provided, or general analysis with exclude patterns
        let analysisPath = resolvedProjectPath;
        const cleanupTempDir: (() => Promise<void>) | null = null;

        if ((folderPath && folderPath !== '.') || excludeRegexes.length > 0) {
          const fs = require('fs').promises;
          const path = require('path');
          const os = require('os');

          const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'semantic-compact-'));
          logger.info('📁 Creating folder-specific analysis in temp directory', { tempDir });

          try {
            const { FileDiscovery } = await import('../../core/compactor/fileDiscovery.js');
            const fileDiscovery = new FileDiscovery(resolvedProjectPath, {
              maxFileSize: 200000,
            });

            let allFiles = await fileDiscovery.discoverFiles();
            const originalFileCount = allFiles.length;

            if (excludeRegexes.length > 0) {
              allFiles = allFiles.filter(file => !isExcludedPath(file.relPath, excludeRegexes));

              logger.info('📊 Applied exclude patterns to files', {
                originalCount: originalFileCount,
                filteredCount: allFiles.length,
                excludedCount: originalFileCount - allFiles.length,
                excludePatterns,
              });
            }

            let filteredFiles = allFiles;
            if (folderPath && folderPath !== '.') {
              let normalizedFolderPath = folderPath.replace(/[\/\\]/g, path.sep);

              if (normalizedFolderPath.startsWith('.' + path.sep)) {
                normalizedFolderPath = normalizedFolderPath.substring(2);
              }

              if (path.isAbsolute(normalizedFolderPath)) {
                const relative = path.relative(resolvedProjectPath, normalizedFolderPath);
                normalizedFolderPath = relative.startsWith('..')
                  ? path.basename(normalizedFolderPath)
                  : relative;
              }

              filteredFiles = allFiles.filter(file => {
                const normalizedFilePath = file.relPath.replace(/[\/\\]/g, path.sep);
                return (
                  normalizedFilePath.startsWith(normalizedFolderPath + path.sep) ||
                  normalizedFilePath === normalizedFolderPath
                );
              });

              logger.info('📁 Folder-specific semantic compaction', {
                originalFolderPath: folderPath,
                normalizedFolderPath,
                resolvedProjectPath,
                totalFiles: allFiles.length,
                filteredFiles: filteredFiles.length,
                filesFound: filteredFiles.map((f: any) => f.relPath).slice(0, 5),
                sampleFiles: allFiles.slice(0, 5).map((f: any) => f.relPath),
              });

              if (filteredFiles.length === 0) {
                throw new Error(`No files found in folder: ${folderPath}`);
              }
            }

            for (const file of filteredFiles) {
              const sourcePath = file.absPath;
              const targetPath = path.join(tempDir, file.relPath);
              await fs.mkdir(path.dirname(targetPath), { recursive: true });
              await fs.copyFile(sourcePath, targetPath);
            }

            analysisPath = tempDir;

            logger.info('📁 Temporary directory created for folder analysis', {
              tempDir,
              filesCopied: filteredFiles.length,
            });

            process.on('exit', () => {
              fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
            });
            process.on('beforeExit', () => {
              fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
            });
          } catch (error) {
            await fs.rm(tempDir, { recursive: true, force: true });
            throw error;
          }
        }

        // Create semantic compactor instance (self-contained, no external deps)
        const compactor = new SemanticCompactor(analysisPath, {
          maxTotalTokens: maxTokens,
          supportedLanguages: [
            'typescript',
            'javascript',
            'python',
            'go',
            'rust',
            'html',
            'markdown',
          ],
          includeSourceCode: false, // Keep lightweight - just signatures and docs
          prioritizeExports: true,
          includeDocstrings: true,
        });

        // Create relevance context if query provided
        const relevanceContext = query
          ? {
              query,
              taskType,
              maxTokens,
            }
          : undefined;

        // Process and compact - all local, no external API calls
        const result = await compactor.compact(relevanceContext);

        // Clean up resources
        compactor.dispose();

        // Clean up temp directory if it was created
        if (analysisPath !== resolvedProjectPath) {
          await require('fs').promises.rm(analysisPath, { recursive: true, force: true });
          logger.info('🧹 Cleaned up temporary directory', { tempDir: analysisPath });
        }

        const originalTokens = Math.round(result.totalTokens / result.compressionRatio);

        logger.info('✅ Semantic compaction completed', {
          originalTokens,
          compactedTokens: result.totalTokens,
          compressionRatio: result.compressionRatio,
        });

        // Format the output based on preference
        let formattedContent = formatContextOutput(result, format, {
          originalTokens,
          query,
          taskType,
          projectPath: resolvedProjectPath,
        });

        // Enforce hard token cap on final content
        formattedContent = truncateToTokens(formattedContent, maxTokens);

        logger.debug('🏗️ Building final response metadata', {
          resultExists: !!result,
          resultType: typeof result,
          resultProcessingStats: (result as any)?.processingStats,
          resultTotalTokens: (result as any)?.totalTokens,
          resultCompressionRatio: (result as any)?.compressionRatio,
          originalTokens,
          filesProcessed_raw: (result as any).processingStats?.filesProcessed,
          totalSymbols_raw: (result as any).processingStats?.totalSymbols,
          symbolsAfterDeduplication_raw: (result as any).processingStats?.symbolsAfterDeduplication,
          processingTimeMs_raw: (result as any).processingStats?.processingTimeMs,
        });

        const responseMetadata = {
          originalTokens,
          compactedTokens: (result as any).totalTokens || 0,
          compressionRatio: (result as any).compressionRatio || 1,
          filesProcessed: (result as any).processingStats?.filesProcessed || 0,
          symbolsFound: (result as any).processingStats?.totalSymbols || 0,
          symbolsAfterCompaction: (result as any).processingStats?.symbolsAfterDeduplication || 0,
          processingTimeMs: (result as any).processingStats?.processingTimeMs || 0,
          format,
        };

        logger.debug('✅ Final response metadata created', { metadata: responseMetadata });

        const finalTokens = estimateTokensShared(formattedContent);
        return {
          success: true,
          content: formattedContent,
          compactedContent: formattedContent,
          metadata: responseMetadata,
          embeddingSync,
          usage: `Reduced context from ${originalTokens} to ${finalTokens} tokens (${Math.round(((result as any).compressionRatio || 1) * 100)}% compression, cap=${maxTokens})`,
        };
      } catch (error) {
        logger.error('❌ Semantic compaction failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
          fallback: `Basic project context for ${projectPath} - semantic compaction failed. Try local_project_hints for navigation assistance.`,
        };
      }
    } catch (error) {
      logger.error('❌ Enhanced handler execution failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };

  const executionPromise = execute();
  inFlightRequests.set(singleFlightKey, executionPromise);
  try {
    const result = await executionPromise;
    return result;
  } finally {
    inFlightRequests.delete(singleFlightKey);
  }
}
