/**
 * @fileOverview: Ambiance project indexing tools for automatic file indexing and change monitoring
 * @module: IndexingTools
 * @keyFunctions:
 *   - handleAutoDetectIndex(): Auto-detect current project and start indexing
 *   - handleIndexProject(): Manual project indexing with smart ignore patterns
 *   - handleResetIndexes(): Reset/delete all project indexes
 *   - handleStartWatching(): Start file watching for automatic re-indexing
 *   - handleStopWatching(): Stop file watching
 *   - handleGetIndexingStatus(): Get status of active indexing sessions
 * @dependencies:
 *   - AutomaticIndexer: Local project indexing system
 *   - zod: Schema validation for tool parameters
 * @context: Provides comprehensive project indexing capabilities with file watching and cloud sync
 */

import { z } from 'zod';
import { AutomaticIndexer } from '../../local/automaticIndexer';
import { logger } from '../../utils/logger';

// Lazy getter to avoid module initialization issues in tests
function getIndexer(): AutomaticIndexer {
  return AutomaticIndexer.getInstance();
}

// Schema definitions for tool parameters
const IndexProjectSchema = z.object({
  path: z.string().describe('Project path to index'),
  force: z.boolean().optional().describe('Force re-index even if files unchanged'),
  skipCloud: z.boolean().optional().describe('Only index locally, skip cloud sync'),
  pattern: z.string().optional().describe('Only index files matching this pattern'),
});

const ResetIndexesSchema = z.object({
  path: z.string().describe('Project path to reset indexes for'),
});

const WatchProjectSchema = z.object({
  path: z.string().describe('Project path to watch for changes'),
});

const GetSessionSchema = z.object({
  sessionId: z.string().describe('Indexing session ID'),
});

// Tool definitions
export const ambianceAutoDetectIndexTool = {
  name: 'ambiance_auto_detect_index',
  description: 'Automatically detect current project and start indexing if user has API key',
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
};

export const ambianceIndexProjectTool = {
  name: 'ambiance_index_project',
  description: 'Index a project with smart ignore patterns and change detection',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Project path to index',
      },
      force: {
        type: 'boolean',
        description: 'Force re-index even if files unchanged',
        default: false,
      },
      skipCloud: {
        type: 'boolean',
        description: 'Only index locally, skip cloud sync',
        default: false,
      },
      pattern: {
        type: 'string',
        description: 'Only index files matching this pattern (glob pattern)',
      },
    },
    required: ['path'],
    additionalProperties: false,
  },
};

export const ambianceResetIndexesTool = {
  name: 'ambiance_reset_indexes',
  description: 'Delete/reset all indexes for a project (both local and cloud)',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Project path to reset indexes for',
      },
    },
    required: ['path'],
    additionalProperties: false,
  },
};

export const ambianceStartWatchingTool = {
  name: 'ambiance_start_watching',
  description: 'Start watching a project for file changes (automatic incremental indexing)',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Project path to watch for changes',
      },
    },
    required: ['path'],
    additionalProperties: false,
  },
};

export const ambianceStopWatchingTool = {
  name: 'ambiance_stop_watching',
  description: 'Stop watching a project for file changes',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Project path to stop watching',
      },
    },
    required: ['path'],
    additionalProperties: false,
  },
};

export const ambianceGetIndexingStatusTool = {
  name: 'ambiance_get_indexing_status',
  description: 'Get status of active indexing sessions',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: {
        type: 'string',
        description: 'Specific session ID to get status for (optional)',
      },
    },
    additionalProperties: false,
  },
};

// Tool handlers
export async function handleAutoDetectIndex(): Promise<any> {
  logger.info('🔍 Auto-detecting and indexing current project');

  const session = await getIndexer().autoDetectAndIndex();

  if (!session) {
    return {
      success: false,
      message: 'No project detected or no API key configured',
      suggestion: 'Make sure you have a valid API key and are in a project directory',
    };
  }

  return {
    success: true,
    message: 'Started automatic indexing',
    session: {
      id: session.id,
      projectId: session.projectId,
      status: session.status,
      filesFound: session.filesFound,
      startTime: session.startTime,
    },
  };
}

export async function handleIndexProject(args: z.infer<typeof IndexProjectSchema>): Promise<any> {
  const validatedArgs = IndexProjectSchema.parse(args);

  logger.info(`🚀 Starting project indexing: ${validatedArgs.path}`);

  try {
    const session = await getIndexer().indexProject(validatedArgs.path, {
      force: validatedArgs.force,
      skipCloud: validatedArgs.skipCloud,
      pattern: validatedArgs.pattern,
    });

    return {
      success: true,
      message: 'Project indexing started successfully',
      session: {
        id: session.id,
        projectId: session.projectId,
        status: session.status,
        filesFound: session.filesFound,
        filesProcessed: session.filesProcessed,
        chunksCreated: session.chunksCreated,
        symbolsExtracted: session.symbolsExtracted,
        errors: session.errors,
        startTime: session.startTime,
      },
    };
  } catch (error) {
    logger.error('❌ Project indexing failed:', {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      suggestion: 'Check the project path exists and you have necessary permissions',
    };
  }
}

export async function handleResetIndexes(args: z.infer<typeof ResetIndexesSchema>): Promise<any> {
  const validatedArgs = ResetIndexesSchema.parse(args);

  logger.info(`🗑️ Resetting indexes for: ${validatedArgs.path}`);

  try {
    await getIndexer().resetProjectIndexes(validatedArgs.path);

    return {
      success: true,
      message: 'Project indexes reset successfully',
      details: 'All local and cloud indexes have been deleted for this project',
    };
  } catch (error) {
    logger.error('❌ Reset indexes failed:', {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      suggestion: 'Ensure you have necessary permissions and the project exists',
    };
  }
}

export async function handleStartWatching(args: z.infer<typeof WatchProjectSchema>): Promise<any> {
  const validatedArgs = WatchProjectSchema.parse(args);

  logger.info(`👁️ Starting file watcher for: ${validatedArgs.path}`);

  try {
    await getIndexer().startWatching(validatedArgs.path);

    return {
      success: true,
      message: 'File watching started successfully',
      details: 'Project will be automatically re-indexed when files change',
    };
  } catch (error) {
    logger.error('❌ Start watching failed:', {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      suggestion: 'Check the project path exists and you have read permissions',
    };
  }
}

export async function handleStopWatching(args: z.infer<typeof WatchProjectSchema>): Promise<any> {
  const validatedArgs = WatchProjectSchema.parse(args);

  logger.info(`👁️ Stopping file watcher for: ${validatedArgs.path}`);

  try {
    await getIndexer().stopWatching(validatedArgs.path);

    return {
      success: true,
      message: 'File watching stopped successfully',
    };
  } catch (error) {
    logger.error('❌ Stop watching failed:', {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function handleGetIndexingStatus(args?: { sessionId?: string }): Promise<any> {
  logger.info('📊 Getting indexing status');

  try {
    if (args?.sessionId) {
      const session = getIndexer().getSession(args.sessionId);
      if (!session) {
        return {
          success: false,
          error: 'Session not found',
          sessionId: args.sessionId,
        };
      }

      return {
        success: true,
        session: {
          id: session.id,
          projectId: session.projectId,
          status: session.status,
          filesFound: session.filesFound,
          filesProcessed: session.filesProcessed,
          chunksCreated: session.chunksCreated,
          symbolsExtracted: session.symbolsExtracted,
          embeddings: session.embeddings,
          errors: session.errors,
          startTime: session.startTime,
          progress:
            session.filesFound > 0
              ? Math.round((session.filesProcessed / session.filesFound) * 100)
              : 0,
        },
      };
    } else {
      const activeSessions = getIndexer().getActiveSessions();

      return {
        success: true,
        message: `Found ${activeSessions.length} active indexing sessions`,
        sessions: activeSessions.map(session => ({
          id: session.id,
          projectId: session.projectId,
          status: session.status,
          filesFound: session.filesFound,
          filesProcessed: session.filesProcessed,
          progress:
            session.filesFound > 0
              ? Math.round((session.filesProcessed / session.filesFound) * 100)
              : 0,
          startTime: session.startTime,
          errors: session.errors.length,
        })),
      };
    }
  } catch (error) {
    logger.error('❌ Get indexing status failed:', {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
