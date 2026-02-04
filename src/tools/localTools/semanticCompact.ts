/**
 * @fileOverview: Local semantic compaction tool with embedding support
 * @module: SemanticCompact
 * @keyFunctions:
 *   - localSemanticCompactTool: Tool definition for local context compression
 *   - handleSemanticCompact(): Handler for semantic compaction requests
 * @context: Provides 60-80% token reduction using local AST parsing with optional embedding enhancement (OpenAI → Local Models → AST-only)
 */

import { SemanticCompactor } from '../../core/compactor/semanticCompactor';
import { logger } from '../../utils/logger';
import { validateAndResolvePath, detectWorkspaceDirectory } from '../utils/pathUtils';
import { formatContextOutput } from './formatters/contextFormatters';
import {
  enhancedSemanticCompactor,
  EnhancedSemanticCompactor,
} from '../../local/enhancedSemanticCompactor';
import { LocalContextResponse } from './enhancedLocalContext';
import { estimateTokens as estimateTokensShared, truncateToTokens } from '../utils/toolHelpers';
import { systemMapComposer, formatSystemMapAsMarkdown } from './systemMapComposer';
import { sharedRetriever } from '../../shared/retrieval/retriever';
import * as path from 'path';
import { compileExcludePatterns, isExcludedPath } from '../utils/toolHelpers';

// Simple single-flight guard to avoid duplicate concurrent runs for the same key
const inFlightRequests: Map<string, Promise<any>> = new Map();

/**
 * Tool definition for enhanced local context
 */
export const localSemanticCompactTool = {
  name: 'local_context',
  description:
    '🚀 Enhanced local context with deterministic query-aware retrieval, AST-grep, and actionable intelligence. Provides: (1) deterministic AnswerDraft, (2) ranked JumpTargets, (3) tight MiniBundle (≤3k tokens), (4) NextActions—all using AST + static heuristics. Optional embedding enhancement when available. Completely offline with zero external dependencies for core functionality.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'Query to focus analysis (required for enhanced mode). Example: "How does database connection and local database storage work?"',
      },
      taskType: {
        type: 'string',
        enum: ['understand', 'debug', 'trace', 'spec', 'test'],
        default: 'understand',
        description: 'Type of analysis task - affects query processing and output format',
      },
      maxSimilarChunks: {
        type: 'number',
        default: 20,
        minimum: 5,
        maximum: 50,
        description:
          'Maximum number of semantically similar code chunks to retrieve. Higher values (30-50) provide broader coverage for exploration; lower values (10-15) focus on highly relevant matches. Default 20 balances breadth and relevance.',
      },
      maxTokens: {
        type: 'number',
        default: 3000,
        minimum: 1000,
        maximum: 8000,
        description: 'Token budget for mini-bundle assembly',
      },
      generateEmbeddingsIfMissing: {
        type: 'boolean',
        default: false,
        description:
          'Generate embeddings if missing (requires OpenAI API key) - leave false for pure AST mode',
      },
      useProjectHintsCache: {
        type: 'boolean',
        default: true,
        description: 'Reuse project_hints indices for faster processing',
      },
      astQueries: {
        type: 'array',
        items: { type: 'object' },
        description: 'Optional custom AST queries to supplement automatic detection',
      },
      attackPlan: {
        type: 'string',
        enum: ['auto', 'init-read-write', 'api-route', 'error-driven', 'auth'],
        default: 'auto',
        description:
          'Analysis strategy: auto-detect from query, or specify: init-read-write (DB/storage), api-route (endpoints), auth (authentication), error-driven (debugging)',
      },
      projectPath: {
        type: 'string',
        description: 'Project directory path. Required. Can be absolute or relative to workspace.',
      },
      folderPath: {
        type: 'string',
        description:
          'Analyze specific folder (falls back to legacy mode if enhanced analysis unavailable)',
      },
      format: {
        type: 'string',
        enum: ['xml', 'structured', 'compact', 'enhanced', 'system-map'],
        default: 'enhanced',
        description:
          'Output format: enhanced (new format with jump targets), system-map (architecture overview), structured (legacy), compact, xml',
      },
      excludePatterns: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Additional patterns to exclude from analysis (e.g., ["*.md", "docs/**", "*.test.js"])',
      },
      useEmbeddings: {
        type: 'boolean',
        default: false,
        description: 'Use embeddings for similarity search if available (legacy parameter)',
      },
      embeddingSimilarityThreshold: {
        type: 'number',
        default: 0.2,
        minimum: 0.0,
        maximum: 1.0,
        description:
          'Minimum similarity score (0.0-1.0) for including chunks. Lower values (0.15-0.2) cast a wider net for related code; higher values (0.25-0.35) return only close matches. Use lower thresholds when exploring unfamiliar code.',
      },
    },
    required: ['query', 'projectPath'],
  },
};

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
      return `${path.resolve(p)}::${f}::${q}`;
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
        embeddingSimilarityThreshold = 0.2,
      } = args;

      const excludeRegexes = compileExcludePatterns(excludePatterns);

      // Validate and resolve project path (now required)
      const resolvedProjectPath = validateAndResolvePath(projectPath);

      // Enhanced mode: Use new local_context implementation if query is provided
      if (query && (format === 'enhanced' || format === 'system-map') && !folderPath) {
        // Auto-enable embeddings when local storage is enabled and we have a query
        const localStorageEnabled = process.env.USE_LOCAL_EMBEDDINGS === 'true';
        const enhancedAvailable = EnhancedSemanticCompactor.isEnhancedModeAvailable();

        if (localStorageEnabled && enhancedAvailable) {
          try {
            logger.info('🧠 Auto-enabled embeddings (local storage active)', {
              projectPath: resolvedProjectPath,
              threshold: embeddingSimilarityThreshold,
              maxChunks: maxSimilarChunks,
            });

            // Query-scoped file selection via quick AST pre-pass
            let filePatterns: string[] | undefined;
            try {
              const { localContext } = await import('./enhancedLocalContext');
              const prepass = await localContext({
                projectPath: resolvedProjectPath,
                query,
                taskType: taskType as any,
                maxSimilarChunks: Math.max(10, maxSimilarChunks),
                maxTokens: Math.min(1500, maxTokens),
                useProjectHintsCache,
                attackPlan: attackPlan as any,
                excludePatterns,
              });

              if (prepass?.jumpTargets?.length) {
                const uniqueFiles = Array.from(
                  new Set(prepass.jumpTargets.map((t: any) => t.file).filter(Boolean))
                );
                filePatterns = uniqueFiles.map((absOrRel: string) => {
                  const rel = path.isAbsolute(absOrRel)
                    ? path.relative(resolvedProjectPath, absOrRel)
                    : absOrRel;
                  // Use exact file paths as patterns
                  return rel.replace(/\\/g, '/');
                });
                logger.info('🗂️ Query-scoped embedding file set prepared', {
                  files: filePatterns.slice(0, 10),
                  total: filePatterns.length,
                });
              }
            } catch (preErr) {
              logger.warn('⚠️ Query-scoped pre-pass failed; proceeding without scoped patterns', {
                error: preErr instanceof Error ? preErr.message : String(preErr),
              });
            }

            const enhancedResult = await enhancedSemanticCompactor.generateEnhancedContext({
              projectPath: resolvedProjectPath,
              maxTokens,
              query,
              taskType,
              format,
              useEmbeddings: true,
              embeddingSimilarityThreshold,
              maxSimilarChunks,
              // Default to generating embeddings on first run unless explicitly disabled
              generateEmbeddingsIfMissing: generateEmbeddingsIfMissing !== false,
              embeddingOptions: {
                batchSize: 48,
                rateLimit: 0,
                maxChunkSize: 1800,
                filePatterns,
              },
              excludePatterns,
            });

            // Enforce final token cap on returned content
            const cappedContent = truncateToTokens(enhancedResult.content, maxTokens);
            const cappedTokens = estimateTokensShared(cappedContent);
            return {
              success: true,
              compactedContent: cappedContent,
              metadata: {
                originalTokens: Math.round(
                  (enhancedResult.metadata.tokenCount || 0) /
                    (enhancedResult.metadata.compressionRatio || 1)
                ),
                compactedTokens: cappedTokens,
                compressionRatio: enhancedResult.metadata.compressionRatio || 1,
                filesProcessed: enhancedResult.metadata.includedFiles || 0,
                symbolsFound: 0,
                symbolsAfterCompaction: 0,
                processingTimeMs: 0,
                format,
                embeddingsUsed: enhancedResult.metadata.embeddingsUsed,
                similarChunksFound: enhancedResult.metadata.similarChunksFound,
              },
              usage: `Enhanced context with ${enhancedResult.metadata.embeddingsUsed ? 'embeddings' : 'base compaction'}: ${cappedTokens} tokens (cap=${maxTokens})`,
            };
          } catch (error) {
            logger.warn('⚠️ Auto-embedding path failed, falling back to enhanced AST mode', {
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
        });

        try {
          const { localContext } = await import('./enhancedLocalContext');

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
          });

          if (enhancedResult.success) {
            return {
              success: true,
              compactedContent: formatEnhancedContextOutput(enhancedResult, maxTokens),
              metadata: enhancedResult.metadata,
              usage: `Enhanced context analysis: ${enhancedResult.metadata.bundleTokens} tokens in ${enhancedResult.jumpTargets.length} locations`,
              enhanced: true,
              jumpTargets: enhancedResult.jumpTargets,
              answerDraft: enhancedResult.answerDraft,
              nextActions: enhancedResult.next,
              evidence: enhancedResult.evidence,
            };
          } else {
            // Fall back to legacy mode if enhanced mode fails
            logger.warn('Enhanced mode failed, falling back to legacy mode');
          }
        } catch (error) {
          logger.warn('⚠️ Enhanced local context failed, using legacy mode', {
            error: error instanceof Error ? error.message : String(error),
          });
        }

        // System Map mode: Use shared retriever to build architecture overview
        if (format === 'system-map') {
          try {
            logger.info('🗺️ Using System Map format', { query });

            // Use shared retriever to get relevant chunks
            const relevantChunks = await sharedRetriever.retrieve(query, 'overview');

            // Compose System Map
            const systemMap = await systemMapComposer.composeSystemMap(query, relevantChunks);

            // Format as markdown
            const systemMapMarkdown = formatSystemMapAsMarkdown(systemMap);

            // Estimate tokens and return
            const tokenCount = estimateTokensShared(systemMapMarkdown);

            return {
              success: true,
              compactedContent: truncateToTokens(systemMapMarkdown, maxTokens),
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
              },
              usage: `System Map analysis: ${Math.min(tokenCount, maxTokens)} tokens with ${systemMap.metadata.coveragePct * 100}% coverage`,
            };
          } catch (error) {
            logger.warn('⚠️ System Map generation failed, falling back to enhanced mode', {
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }

      // resolvedProjectPath is already computed above

      logger.info('🔧 Starting local semantic compaction', {
        originalPath: projectPath,
        resolvedPath: resolvedProjectPath,
        folderPath,
        maxTokens,
        taskType,
        useEmbeddings,
        enhancedModeAvailable: EnhancedSemanticCompactor.isEnhancedModeAvailable(),
      });

      try {
        // Check if we should use enhanced compactor with embeddings
        const canUseEmbeddings =
          useEmbeddings &&
          query &&
          !folderPath && // Don't use embeddings for folder-specific analysis yet
          EnhancedSemanticCompactor.isEnhancedModeAvailable();

        if (canUseEmbeddings) {
          logger.info('🚀 Using enhanced semantic compactor with embeddings', {
            query,
            threshold: embeddingSimilarityThreshold,
            maxChunks: maxSimilarChunks,
          });

          logger.debug('🔧 Calling enhanced semantic compactor with embeddings');

          const enhancedResult = await enhancedSemanticCompactor.generateEnhancedContext({
            projectPath: resolvedProjectPath,
            maxTokens,
            query,
            taskType,
            format,
            useEmbeddings: true,
            embeddingSimilarityThreshold,
            maxSimilarChunks,
            generateEmbeddingsIfMissing,
            excludePatterns,
          });

          logger.debug('📊 Enhanced compactor result', {
            contentLength: enhancedResult.content?.length || 0,
            metadata: enhancedResult.metadata,
            metadataKeys: Object.keys(enhancedResult.metadata || {}),
          });

          // Return properly structured response for enhanced path
          const cappedContent = truncateToTokens(enhancedResult.content, maxTokens);
          const cappedTokens = estimateTokensShared(cappedContent);
          return {
            success: true,
            compactedContent: cappedContent,
            metadata: {
              originalTokens: Math.round(
                (enhancedResult.metadata.tokenCount || 0) /
                  (enhancedResult.metadata.compressionRatio || 1)
              ),
              compactedTokens: cappedTokens,
              compressionRatio: enhancedResult.metadata.compressionRatio || 1,
              filesProcessed: enhancedResult.metadata.includedFiles || 0,
              symbolsFound: 0, // Enhanced compactor doesn't track symbols the same way
              symbolsAfterCompaction: 0, // Enhanced compactor doesn't track symbols the same way
              processingTimeMs: 0, // Could add timing to enhanced compactor
              format,
              embeddingsUsed: enhancedResult.metadata.embeddingsUsed,
              similarChunksFound: enhancedResult.metadata.similarChunksFound,
            },
            usage: `Enhanced context with ${enhancedResult.metadata.embeddingsUsed ? 'embeddings' : 'base compaction'}: ${cappedTokens} tokens (cap=${maxTokens})`,
          };
        }

        // Fall back to standard semantic compaction
        logger.info('📝 Using standard semantic compaction', {
          reason: !canUseEmbeddings
            ? 'Enhanced mode not available or not requested'
            : 'Folder-specific analysis',
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
                filesFound: filteredFiles.map(f => f.relPath).slice(0, 5),
                sampleFiles: allFiles.slice(0, 5).map(f => f.relPath),
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
          supportedLanguages: ['typescript', 'javascript', 'python', 'go', 'rust'],
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
          resultProcessingStats: result?.processingStats,
          resultTotalTokens: result?.totalTokens,
          resultCompressionRatio: result?.compressionRatio,
          originalTokens,
          filesProcessed_raw: result.processingStats?.filesProcessed,
          totalSymbols_raw: result.processingStats?.totalSymbols,
          symbolsAfterDeduplication_raw: result.processingStats?.symbolsAfterDeduplication,
          processingTimeMs_raw: result.processingStats?.processingTimeMs,
        });

        const responseMetadata = {
          originalTokens,
          compactedTokens: result.totalTokens || 0,
          compressionRatio: result.compressionRatio || 1,
          filesProcessed: result.processingStats?.filesProcessed || 0,
          symbolsFound: result.processingStats?.totalSymbols || 0,
          symbolsAfterCompaction: result.processingStats?.symbolsAfterDeduplication || 0,
          processingTimeMs: result.processingStats?.processingTimeMs || 0,
          format,
        };

        logger.debug('✅ Final response metadata created', { metadata: responseMetadata });

        const finalTokens = estimateTokensShared(formattedContent);
        return {
          success: true,
          compactedContent: formattedContent,
          metadata: responseMetadata,
          usage: `Reduced context from ${originalTokens} to ${finalTokens} tokens (${Math.round((result.compressionRatio || 1) * 100)}% compression, cap=${maxTokens})`,
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

/**
 * Format enhanced context output for display
 */
function formatEnhancedContextOutput(result: LocalContextResponse, maxTokens?: number): string {
  const sections: string[] = [];

  // Answer Draft Section
  sections.push('## Query Analysis\n');
  sections.push(result.answerDraft);
  sections.push('');

  // Jump Targets Section
  if (result.jumpTargets.length > 0) {
    sections.push('## Key Locations\n');
    result.jumpTargets.forEach((target, index) => {
      const location =
        target.start && target.end ? `${target.file}:${target.start}-${target.end}` : target.file;

      sections.push(`${index + 1}. **${target.symbol}** (${target.role})`);
      sections.push(`   📍 ${location}`);
      sections.push(`   🔍 Confidence: ${Math.round(target.confidence * 100)}%`);
      if (target.why && target.why.length > 0) {
        sections.push(`   💡 ${target.why.join(', ')}`);
      }
      sections.push('');
    });
  }

  // Mini Bundle Section
  if (result.miniBundle.length > 0) {
    sections.push('## Code Snippets\n');
    result.miniBundle.forEach((snippet, index) => {
      sections.push(`### ${index + 1}. ${snippet.symbol} (${snippet.file})\n`);
      sections.push('```typescript');
      sections.push(snippet.snippet);
      sections.push('```\n');
    });
  }

  // Next Actions Section
  if (result.next) {
    sections.push('## Next Actions\n');
    sections.push(`**Mode**: ${result.next.mode}`);
    sections.push('');

    if (result.next.openFiles.length > 0) {
      sections.push('**Files to examine**:');
      result.next.openFiles.forEach(file => {
        sections.push(`- ${file}`);
      });
      sections.push('');
    }

    if (result.next.checks.length > 0) {
      sections.push('**Verification commands**:');
      result.next.checks.forEach(check => {
        sections.push(`- \`${check}\``);
      });
      sections.push('');
    }
  }

  // Evidence Section (if available)
  if (result.evidence && result.evidence.length > 0) {
    sections.push('## Evidence\n');
    result.evidence.forEach(evidence => {
      sections.push(`- ${evidence}`);
    });
    sections.push('');
  }

  // Metadata Section
  sections.push('---\n');
  sections.push(
    `**Analysis Stats**: ${result.metadata.filesScanned} files scanned, ${result.metadata.symbolsConsidered} symbols considered, ${result.metadata.bundleTokens} tokens in output, processed in ${result.metadata.processingTimeMs}ms`
  );

  const full = sections.join('\n');
  return typeof maxTokens === 'number' ? truncateToTokens(full, maxTokens) : full;
}
