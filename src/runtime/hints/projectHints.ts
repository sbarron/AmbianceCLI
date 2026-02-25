import { ProjectHintsGenerator, ProjectHints } from '../../tools/projectHints';
import { logger } from '../../utils/logger';
import { validateAndResolvePath } from '../utils/pathUtils';
import {
  formatFolderHints,
  formatProjectHints,
} from '../../tools/localTools/formatters/projectHintsFormatters';
import {
  buildEnhancedProjectSummary,
  generateAnswerDraft,
} from '../../tools/localTools/enhancedHints';
import { FileDiscovery, FileInfo } from '../../core/compactor/fileDiscovery';
import * as path from 'path';

/**
 * Analyze file composition by type across the project.
 */
function analyzeFileComposition(
  allFiles: FileInfo[],
  analyzedFiles: FileInfo[]
): {
  totalFiles: number;
  byType: Record<string, number>;
  analyzedFiles: number;
  filteredOut: Record<string, number>;
} {
  const byType: Record<string, number> = {};
  const filteredOut: Record<string, number> = {};

  for (const file of allFiles) {
    const ext = file.ext || path.extname(file.relPath).toLowerCase() || 'no-extension';
    byType[ext] = (byType[ext] || 0) + 1;
  }

  const analyzedFileSet = new Set(analyzedFiles.map(f => f.absPath));
  for (const file of allFiles) {
    if (!analyzedFileSet.has(file.absPath)) {
      const ext = file.ext || path.extname(file.relPath).toLowerCase() || 'no-extension';
      filteredOut[ext] = (filteredOut[ext] || 0) + 1;
    }
  }

  return {
    totalFiles: allFiles.length,
    byType,
    analyzedFiles: analyzedFiles.length,
    filteredOut,
  };
}

/**
 * Runtime handler for project hints requests (CLI + adapters call into this).
 */
export async function handleProjectHints(args: any): Promise<any> {
  const {
    projectPath,
    format = 'compact',
    maxFiles = 100,
    folderPath,
    includeContent = false,
    useAI = true,
    maxFileSizeForSymbols = 50000,
    query,
    showmetadata = false,
  } = args;

  if (!projectPath) {
    throw new Error(
      '❌ projectPath is required. Please provide an absolute path to the project directory.'
    );
  }
  const resolvedProjectPath = validateAndResolvePath(projectPath);

  logger.info('📊 Generating project hints', {
    originalPath: projectPath,
    resolvedPath: resolvedProjectPath,
    format,
    maxFiles,
    folderPath,
  });

  try {
    const hintsGenerator = new ProjectHintsGenerator();

    if (folderPath && folderPath !== '.') {
      const folderHints = await hintsGenerator.generateFolderDocumentation(
        resolvedProjectPath,
        folderPath,
        {
          useAI,
          maxDepth: 2,
          includeSubfolders: true,
        }
      );

      return {
        success: true,
        hints: formatFolderHints(folderHints, format),
        type: 'folder-specific',
        ...(showmetadata
          ? {
            metadata: {
              folderPath,
              keyFiles: folderHints.keyFiles.length,
              subFolders: folderHints.subFolders.length,
              confidence: folderHints.confidence,
            },
          }
          : {}),
      };
    }

    logger.info('📊 Generating project hints with core generator', {
      format,
      maxFiles,
      useEmbeddingAssisted: (hintsGenerator as any)['shouldUseEmbeddingAssistedHints']?.(),
    });

    const hintsResult = await hintsGenerator.generateProjectHints(resolvedProjectPath, {
      maxFiles,
      includeContent,
      useAI,
      maxFileSizeForSymbols,
      format: 'json',
    });

    const hints = hintsResult as ProjectHints;

    let formattedHints: string | any;
    logger.info('🎨 Formatting hints', { requestedFormat: format });

    if (format === 'html') {
      logger.info('🔄 Regenerating with built-in HTML formatting');
      formattedHints = (await hintsGenerator.generateProjectHints(resolvedProjectPath, {
        maxFiles,
        includeContent,
        useAI,
        maxFileSizeForSymbols,
        format,
      })) as string;
      logger.info('✅ Generated formatted hints', {
        format,
        length: formattedHints.length,
        preview: formattedHints.substring(0, 100) + '...',
      });
    } else if (format === 'structured') {
      logger.info('🔧 Using structured format with potential embedding enhancement');

      const fileDiscovery = new FileDiscovery(resolvedProjectPath, {
        maxFileSize: maxFileSizeForSymbols,
      });
      const allFiles = await fileDiscovery.discoverFiles();
      const limitedFiles = fileDiscovery.sortByRelevance(allFiles).slice(0, maxFiles);

      const fileCompositionStructured = analyzeFileComposition(allFiles, limitedFiles);

      const enhancedSummary = await buildEnhancedProjectSummary(
        resolvedProjectPath,
        limitedFiles,
        query
      );

      if (query) {
        const answerDraft = generateAnswerDraft(enhancedSummary, query);
        if (answerDraft) {
          (enhancedSummary as any).answerDraft = answerDraft;
        }
      }

      formattedHints = formatProjectHints(enhancedSummary, format);

      return {
        success: true,
        hints: formattedHints,
        type: 'enhanced-project-wide',
        ...(showmetadata
          ? {
            metadata: {
              filesAnalyzed: enhancedSummary.summary.files,
              capabilities: enhancedSummary.capabilities.domains,
              hintsCount: enhancedSummary.hints.length,
              riskScore: enhancedSummary.risks.score,
              nextMode: enhancedSummary.next.mode,
              hasQuery: !!query,
              enhanced: true,
              embeddingAssisted:
                (hintsGenerator as any)['shouldUseEmbeddingAssistedHints']?.() || false,
              fileComposition: fileCompositionStructured,
            },
          }
          : {}),
      };
    } else {
      logger.info('📝 Using local formatting for', { format });
      formattedHints = formatProjectHints(hints, format);
    }

    const fileDiscoveryForComposition = new FileDiscovery(resolvedProjectPath, {
      maxFileSize: maxFileSizeForSymbols,
    });
    const allFilesForComposition = await fileDiscoveryForComposition.discoverFiles();
    const limitedFilesForComposition = fileDiscoveryForComposition
      .sortByRelevance(allFilesForComposition)
      .slice(0, maxFiles);
    const fileComposition = analyzeFileComposition(
      allFilesForComposition,
      limitedFilesForComposition
    );

    return {
      success: true,
      hints: formattedHints,
      type: 'project-wide',
      ...(showmetadata
        ? {
          metadata: {
            filesAnalyzed: hints.totalFiles,
            foldersFound: Object.keys(hints.folderHints).length,
            primaryLanguages: hints.primaryLanguages,
            architecturePatterns: hints.architectureKeywords,
            topFunctions: hints.symbolHints.functions.slice(0, 10).map((f: any) => f.word),
            codebaseSize: hints.codebaseSize,
            enhanced: false,
            embeddingAssisted:
              (hintsGenerator as any)['shouldUseEmbeddingAssistedHints']?.() || false,
            fileComposition,
          },
        }
        : {}),
    };
  } catch (error) {
    logger.error('❌ Project hints generation failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      fallback: `Could not analyze project structure for ${projectPath}. Ensure the path exists and contains supported code files.`,
    };
  }
}
