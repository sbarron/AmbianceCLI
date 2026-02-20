/**
 * @fileOverview: ⚠️ DEPRECATED - Workspace configuration tool (use manage_embeddings instead)
 * @module: WorkspaceConfig
 * @deprecated: This tool has been merged into manage_embeddings. Use manage_embeddings with actions:
 *   - get_workspace (replaces action="get")
 *   - set_workspace (replaces action="set")
 *   - validate_workspace (replaces action="validate")
 * @keyFunctions:
 *   - workspaceConfigTool: Tool definition for workspace configuration
 *   - handleWorkspaceConfig(): Handler for workspace configuration requests
 * @context: Kept for backward compatibility only. New code should use manage_embeddings.
 */

import { logger } from '../../utils/logger';
import { initializeAutoIndexing } from '../../startup/autoIndexingStartup';
import {
  validateWorkspaceFolder,
  getCurrentWorkspaceFolder,
  setWorkspaceFolder,
  WorkspaceValidationOptions,
} from '../utils/workspaceValidator';
import { getEmbeddingStatus } from './embeddingManagement';
import { LocalEmbeddingGenerator } from '../../local/embeddingGenerator';
import { ProjectIdentifier } from '../../local/projectIdentifier';

async function safeGetEmbeddingStatus(projectPath: string) {
  try {
    return await getEmbeddingStatus({ projectPath });
  } catch (error) {
    logger.warn('�s��,? Could not check embedding status', {
      projectPath,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      projectId: 'unknown',
      hasEmbeddings: false,
      totalEmbeddings: 0,
      compatible: false,
      error: 'Could not check embedding status',
      recommendations: [
        'dY"? Embedding status check failed - AI tools may still work but with reduced performance',
      ],
    };
  }
}

/**
 * Check if we should proactively generate embeddings after workspace setup
 */
async function shouldGenerateEmbeddingsProactively(
  workspacePath: string,
  fileCount: number
): Promise<{
  shouldGenerate: boolean;
  reason: string;
  maxFiles?: number;
}> {
  // Check if proactive embedding generation is enabled
  if (process.env.WORKSPACE_PROACTIVE_EMBEDDINGS !== 'true') {
    return {
      shouldGenerate: false,
      reason: 'Proactive embedding generation disabled (set WORKSPACE_PROACTIVE_EMBEDDINGS=true)',
    };
  }

  // Check if local embeddings are enabled
  if (process.env.USE_LOCAL_EMBEDDINGS !== 'true') {
    return {
      shouldGenerate: false,
      reason: 'Local embeddings not enabled (set USE_LOCAL_EMBEDDINGS=true)',
    };
  }

  // Check if embeddings already exist
  try {
    const embeddingStatus = await safeGetEmbeddingStatus(workspacePath);
    if (embeddingStatus.hasEmbeddings && embeddingStatus.totalEmbeddings > 0) {
      return {
        shouldGenerate: false,
        reason: `Embeddings already exist (${embeddingStatus.totalEmbeddings} chunks)`,
      };
    }
  } catch (error) {
    logger.debug('Could not check existing embeddings, proceeding with generation check');
  }

  // Check file count limits to avoid long delays
  const maxFiles = parseInt(process.env.WORKSPACE_EMBEDDING_MAX_FILES || '500', 10);
  if (fileCount > maxFiles) {
    return {
      shouldGenerate: false,
      reason: `Too many files (${fileCount} > ${maxFiles} limit)`,
      maxFiles,
    };
  }

  // Check if we're in a reasonable project size
  const minFiles = parseInt(process.env.WORKSPACE_EMBEDDING_MIN_FILES || '10', 10);
  if (fileCount < minFiles) {
    return {
      shouldGenerate: false,
      reason: `Too few files (${fileCount} < ${minFiles} minimum)`,
    };
  }

  return {
    shouldGenerate: true,
    reason: `Ready for proactive embedding generation (${fileCount} files)`,
  };
}

/**
 * Proactively generate embeddings for a newly configured workspace
 */
async function generateEmbeddingsProactively(
  workspacePath: string,
  fileCount: number
): Promise<{
  success: boolean;
  message: string;
  stats?: any;
}> {
  try {
    logger.info('🚀 Starting proactive embedding generation', {
      workspacePath,
      fileCount,
    });

    // Identify the project
    const projectIdentifier = ProjectIdentifier.getInstance();
    const projectInfo = await projectIdentifier.identifyProject(workspacePath);

    if (!projectInfo) {
      return {
        success: false,
        message: 'Could not identify project for embedding generation',
      };
    }

    // Initialize embedding generator
    const embeddingGenerator = new LocalEmbeddingGenerator();

    // Generate embeddings with reasonable limits for proactive generation
    const progress = await embeddingGenerator.generateProjectEmbeddings(
      projectInfo.id,
      workspacePath,
      {
        batchSize: 5, // Smaller batches for background processing
        rateLimit: 500, // Lower rate limit for background processing
        maxChunkSize: 1000, // Smaller chunks for faster processing
        filePatterns: [
          '**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts,py,go,rs,java,cpp,c,cc,cxx,h,hpp,hh,hxx,cs,rb,php,swift,kt,kts,scala,clj,hs,lhs,ml,r,sql,sh,bash,zsh,ex,exs,lua,md,mdx,json,yaml,yml,xml,html,htm,css,scss,sass,less,astro,vue,svelte}',
        ],
      }
    );

    logger.info('✅ Proactive embedding generation completed', {
      projectId: projectInfo.id,
      filesProcessed: progress.processedFiles,
      chunksCreated: progress.totalChunks,
      embeddings: progress.embeddings,
      errors: progress.errors.length,
    });

    return {
      success: true,
      message: `Generated ${progress.embeddings} embeddings from ${progress.processedFiles} files`,
      stats: {
        filesProcessed: progress.processedFiles,
        chunksCreated: progress.totalChunks,
        embeddings: progress.embeddings,
        errors: progress.errors.length,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('❌ Proactive embedding generation failed', {
      workspacePath,
      error: errorMessage,
    });

    return {
      success: false,
      message: `Embedding generation failed: ${errorMessage}`,
    };
  }
}

/**
 * Tool definition for workspace configuration
 */
export const workspaceConfigTool = {
  name: 'workspace_config',
  description:
    '⚠️ DEPRECATED: Use manage_embeddings instead. This tool has been merged into manage_embeddings for unified workspace and embedding management. Use manage_embeddings with actions: get_workspace, set_workspace, or validate_workspace. This tool is kept for backward compatibility only.',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['get', 'set', 'validate'],
        description:
          'Action to perform: get current workspace (includes embedding status), set new workspace (triggers embedding check), or validate a path',
        default: 'get',
      },
      path: {
        type: 'string',
        description:
          'Path to set as workspace (required for set/validate actions). Can be absolute or relative.',
      },
      maxFiles: {
        type: 'number',
        default: 5000,
        minimum: 100,
        maximum: 10000,
        description: 'Maximum number of analyzable files allowed in workspace (default: 5000)',
      },
      excludePatterns: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Additional glob patterns to exclude when counting files (e.g., ["*.tmp", "cache/**"])',
        default: [],
      },
      allowHiddenFolders: {
        type: 'boolean',
        default: false,
        description: 'Whether to include hidden folders (starting with .) in file counting',
      },
      force: {
        type: 'boolean',
        default: false,
        description: 'Force set workspace even with warnings (but not errors)',
      },
    },
    required: [],
  },
};

/**
 * Handle workspace configuration requests
 * @deprecated Use manage_embeddings with workspace actions instead
 */
export async function handleWorkspaceConfig(args: any): Promise<any> {
  const {
    action = 'get',
    path,
    maxFiles = 5000,
    excludePatterns = [],
    allowHiddenFolders = false,
    force = false,
  } = args;

  logger.warn('⚠️ workspace_config is deprecated - use manage_embeddings instead', {
    action,
    recommendation: `Use manage_embeddings with action="${action === 'get' ? 'get_workspace' : action === 'set' ? 'set_workspace' : 'validate_workspace'}"`,
  });

  logger.info('🏠 Workspace configuration request (deprecated tool)', {
    action,
    path,
    maxFiles,
    excludePatterns,
    allowHiddenFolders,
    force,
  });

  try {
    switch (action) {
      case 'get':
        return await handleGetWorkspace();

      case 'validate':
        if (!path) {
          return {
            success: false,
            error: 'Path is required for validate action',
          };
        }
        return handleValidateWorkspace(path, { maxFiles, excludePatterns, allowHiddenFolders });

      case 'set':
        if (!path) {
          return {
            success: false,
            error: 'Path is required for set action',
          };
        }
        return await handleSetWorkspace(
          path,
          { maxFiles, excludePatterns, allowHiddenFolders },
          force
        );

      default:
        return {
          success: false,
          error: `Unknown action: ${action}. Use 'get', 'validate', or 'set'`,
        };
    }
  } catch (error) {
    logger.error('❌ Workspace configuration failed', {
      action,
      path,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Get current workspace configuration
 */
async function handleGetWorkspace(): Promise<any> {
  const currentWorkspace = getCurrentWorkspaceFolder();

  logger.info('📍 Current workspace status', {
    workspace: currentWorkspace || '(not set)',
    fromEnv: !!process.env.WORKSPACE_FOLDER,
    fromBaseDir: !!process.env.AMBIANCE_BASE_DIR,
  });

  let embeddingStatus = null;
  if (currentWorkspace) {
    logger.info('🔍 Checking embedding status for current workspace', {
      workspace: currentWorkspace,
    });
    embeddingStatus = await safeGetEmbeddingStatus(currentWorkspace);
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
      : 'No workspace folder configured. Use action "set" to configure one.',
    recommendations: embeddingStatus?.recommendations || [],
  };
}

/**
 * Validate a workspace path
 */
async function handleValidateWorkspace(
  path: string,
  options: WorkspaceValidationOptions
): Promise<any> {
  logger.info('🔍 Validating workspace path', { path, options });

  const validation = await validateWorkspaceFolder(path, options);

  return {
    success: true,
    validation,
    message: validation.isValid
      ? `✅ Path is valid for workspace: ${validation.path} (${validation.fileCount} files)`
      : `❌ Path is not suitable for workspace: ${validation.error}`,
    recommendations: validation.isValid ? [] : getWorkspaceRecommendations(validation),
  };
}

/**
 * Set workspace folder
 */
async function handleSetWorkspace(
  path: string,
  options: WorkspaceValidationOptions,
  force: boolean
): Promise<any> {
  logger.info('🏠 Setting workspace folder', { path, options, force });

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

  logger.info('✅ Workspace folder set successfully', {
    workspace: validation.path,
    fileCount: validation.fileCount,
    hadWarnings: !!validation.warnings,
  });

  // Mark workspace as initialized so startup can begin indexing on next cycle
  process.env.WORKSPACE_INITIALIZED = 'true';
  logger.info('🔧 Workspace initialization flag set');

  // Check if we should proactively generate embeddings
  const shouldGenerate = await shouldGenerateEmbeddingsProactively(
    validation.path!,
    validation.fileCount || 0
  );
  logger.info('📊 Proactive embedding generation check', {
    shouldGenerate: shouldGenerate.shouldGenerate,
    reason: shouldGenerate.reason,
    fileCount: validation.fileCount || 0,
  });

  const embeddingGenerationResult = null;
  let embeddingMessage = '';

  if (shouldGenerate.shouldGenerate) {
    // Start proactive embedding generation in the background
    setTimeout(async () => {
      try {
        const result = await generateEmbeddingsProactively(
          validation.path!,
          validation.fileCount || 0
        );
        if (result.success) {
          logger.info('✅ Background embedding generation completed', {
            workspace: validation.path,
            message: result.message,
            stats: result.stats,
          });
        } else {
          logger.warn('⚠️ Background embedding generation failed', {
            workspace: validation.path,
            error: result.message,
          });
        }
      } catch (error) {
        logger.error('❌ Background embedding generation error', {
          workspace: validation.path,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }, 100); // Small delay to let workspace_config return first

    embeddingMessage =
      'Starting background embedding generation for optimal AI tool performance...';
    logger.info('🚀 Triggered proactive embedding generation after workspace setup');
  } else {
    // Kick off auto-indexing in the background now that workspace is set
    try {
      setTimeout(() => {
        initializeAutoIndexing().catch(error => {
          logger.warn('⚠️ Failed to start auto-indexing after workspace setup', {
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }, 0);
      logger.info('🚀 Triggered automatic indexing after workspace setup');
    } catch (err) {
      logger.warn('⚠️ Could not trigger automatic indexing after workspace setup', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    embeddingMessage = shouldGenerate.reason;
  }

  // Check embedding status for the newly set workspace
  logger.info('🔍 Checking embedding status for newly set workspace', {
    workspace: validation.path,
  });
  const embeddingStatus = await safeGetEmbeddingStatus(validation.path!);

  // Log embedding status for visibility
  if (embeddingStatus.hasEmbeddings) {
    logger.info('📊 Embedding status for workspace', {
      workspace: validation.path,
      totalEmbeddings: embeddingStatus.totalEmbeddings,
      compatible: embeddingStatus.compatible,
      lastUpdated: embeddingStatus.lastUpdated,
    });
  } else {
    logger.info('📝 No embeddings found for workspace - will be generated on first AI tool use', {
      workspace: validation.path,
    });
  }

  // Notify about any compatibility issues
  if (!embeddingStatus.compatible) {
    logger.warn('⚠️ Embedding compatibility issues detected in new workspace', {
      workspace: validation.path,
      issues: embeddingStatus.issues,
      recommendations: embeddingStatus.recommendations,
    });
  }

  return {
    success: true,
    workspace: validation.path,
    fileCount: validation.fileCount,
    warnings: validation.warnings,
    embeddingStatus,
    proactiveEmbeddingGeneration: {
      triggered: shouldGenerate.shouldGenerate,
      reason: shouldGenerate.reason,
      message: embeddingMessage,
    },
    message:
      `✅ Workspace set successfully: ${validation.path} (${validation.fileCount} files)` +
      (validation.warnings ? ` [Warnings: ${validation.warnings.length}]` : '') +
      (shouldGenerate.shouldGenerate ? ' [Embedding generation started]' : ''),
    embeddingMessage: embeddingMessage,
  };
}

/**
 * Generate recommendations for failed workspace validation
 */
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
    recommendations.push('Use action "validate" to check paths before setting');
  }

  return recommendations;
}
