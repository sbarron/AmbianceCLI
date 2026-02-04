/**
 * @fileOverview: Local project hints tool for project navigation and analysis
 * @module: ProjectHints
 * @keyFunctions:
 *   - localProjectHintsTool: Tool definition for project hints generation
 *   - handleProjectHints(): Handler for project hints requests
 * @context: Provides intelligent project navigation hints with folder analysis and architecture detection
 */

import { ProjectHintsGenerator, ProjectHints } from '../projectHints';
import { logger } from '../../utils/logger';
import { validateAndResolvePath } from '../utils/pathUtils';
import {
  formatProjectHints,
  formatFolderHints,
  formatEnhancedJSON,
  formatEnhancedMarkdown,
} from './formatters/projectHintsFormatters';
import { buildEnhancedProjectSummary, generateAnswerDraft } from './enhancedHints';
import { FileDiscovery, FileInfo } from '../../core/compactor/fileDiscovery';
import * as path from 'path';

/**
 * Analyze file composition by type across the project
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

  // Count all files by extension
  for (const file of allFiles) {
    const ext = file.ext || path.extname(file.relPath).toLowerCase() || 'no-extension';
    byType[ext] = (byType[ext] || 0) + 1;
  }

  // Count filtered out files (not in analyzedFiles)
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
 * Tool definition for local project hints generation
 */
export const localProjectHintsTool = {
  name: 'local_project_hints',
  description:
    '📊 Generate intelligent project navigation hints with word clouds, folder analysis, and architecture detection. Supports multiple output formats including markdown and HTML, with AI-powered analysis and configurable performance options. Accepts absolute paths or relative paths (when workspace can be detected).',
  inputSchema: {
    type: 'object',
    properties: {
      projectPath: {
        type: 'string',
        description:
          'Project directory path. Can be absolute (recommended) or relative to workspace. Examples: "C:\\Dev\\my-project", "/Users/username/project", or "." for current workspace.',
      },
      format: {
        type: 'string',
        enum: ['structured', 'compact', 'json', 'markdown', 'html'],
        default: 'compact',
        description:
          'Output format preference - structured for detailed analysis, compact for quick overview, json for raw data, markdown for documentation, html for visual reports',
      },
      maxFiles: {
        type: 'number',
        default: 100,
        minimum: 10,
        maximum: 200,
        description: 'Maximum number of files to analyze for performance',
      },
      folderPath: {
        type: 'string',
        description: 'Analyze specific folder instead of entire project (optional)',
      },
      includeContent: {
        type: 'boolean',
        default: false,
        description: 'Include file content analysis for deeper insights (may impact performance)',
      },
      useAI: {
        type: 'boolean',
        default: true,
        description:
          'Enable AI-powered folder analysis for better purpose detection (requires OpenAI API key)',
      },
      maxFileSizeForSymbols: {
        type: 'number',
        default: 50000,
        minimum: 10000,
        maximum: 200000,
        description: 'Maximum file size in bytes for symbol extraction (performance tuning)',
      },
    },
  },
};

/**
 * Handler for project hints requests
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
  } = args;

  // Validate that projectPath is provided and is absolute
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
      // Folder-specific analysis
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
        metadata: {
          folderPath,
          keyFiles: folderHints.keyFiles.length,
          subFolders: folderHints.subFolders.length,
          confidence: folderHints.confidence,
        },
      };
    } else {
      // Use the core ProjectHintsGenerator which handles embedding-assisted features
      logger.info('📊 Generating project hints with core generator', {
        format,
        maxFiles,
        useEmbeddingAssisted: hintsGenerator['shouldUseEmbeddingAssistedHints']?.(),
      });

      const hintsResult = await hintsGenerator.generateProjectHints(resolvedProjectPath, {
        maxFiles,
        includeContent,
        useAI,
        maxFileSizeForSymbols,
        format: 'json', // Get raw hints object for processing
      });

      // Type guard to ensure we have the ProjectHints object
      const hints = hintsResult as ProjectHints;

      // Handle different output formats
      let formattedHints: string;
      logger.info('🎨 Formatting hints', { requestedFormat: format });

      if (format === 'html') {
        // Regenerate with the desired format using the generator's built-in formatting
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
        // Use enhanced structured format that includes embedding-assisted features
        logger.info('🔧 Using structured format with potential embedding enhancement');

        const fileDiscovery = new FileDiscovery(resolvedProjectPath, {
          maxFileSize: maxFileSizeForSymbols,
        });
        const allFiles = await fileDiscovery.discoverFiles();
        const limitedFiles = fileDiscovery.sortByRelevance(allFiles).slice(0, maxFiles);

        // Analyze file composition across the project
        const fileCompositionStructured = analyzeFileComposition(allFiles, limitedFiles);

        const enhancedSummary = await buildEnhancedProjectSummary(
          resolvedProjectPath,
          limitedFiles,
          query
        );

        // Add answer draft if query provided
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
          metadata: {
            filesAnalyzed: enhancedSummary.summary.files,
            capabilities: enhancedSummary.capabilities.domains,
            hintsCount: enhancedSummary.hints.length,
            riskScore: enhancedSummary.risks.score,
            nextMode: enhancedSummary.next.mode,
            hasQuery: !!query,
            enhanced: true,
            embeddingAssisted: hintsGenerator['shouldUseEmbeddingAssistedHints']?.() || false,
            fileComposition: fileCompositionStructured,
          },
        };
      } else {
        // Use local formatting for remaining cases
        logger.info('📝 Using local formatting for', { format });
        formattedHints = formatProjectHints(hints, format);
      }

      // Analyze file composition for metadata
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
        metadata: {
          filesAnalyzed: hints.totalFiles,
          foldersFound: Object.keys(hints.folderHints).length,
          primaryLanguages: hints.primaryLanguages,
          architecturePatterns: hints.architectureKeywords,
          topFunctions: hints.symbolHints.functions.slice(0, 10).map((f: any) => f.word),
          codebaseSize: hints.codebaseSize,
          enhanced: false,
          embeddingAssisted: hintsGenerator['shouldUseEmbeddingAssistedHints']?.() || false,
          fileComposition,
        },
      };
    }
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
