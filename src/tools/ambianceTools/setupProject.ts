/**
 * @fileOverview: Ambiance project setup tool
 * @module: SetupProject
 * @keyFunctions:
 *   - handleSetupProject(): Auto-detect, index, and configure project for optimal context retrieval
 * @dependencies:
 *   - fileSyncClient: Project synchronization with cloud
 *   - ConnectorWatcher: File system monitoring
 *   - FSGuard: Path validation and security
 * @context: Handles project detection, indexing, file watching, and cloud sync setup
 */

import * as path from 'path';
import { logger } from '../../utils/logger';
import { syncProject } from '../../connector/fileSyncClient';
import { ConnectorWatcher } from '../../connector/watcher';
import { FSGuard } from '../../core/fsGuard';

// Local state for watcher management
let currentWatcher: ConnectorWatcher | null = null;
let lastSyncAt: Date | null = null;
let lastProjectId: string | undefined;

function resolveBaseDir(): string {
  // Standard MCP behavior: prefer the process CWD unless explicitly overridden.
  const envBase = process.env.AMBIANCE_BASE_DIR?.trim();
  if (envBase) {
    // Security: Validate environment-provided paths
    try {
      const resolved = path.resolve(envBase);
      // Basic validation - ensure it's not trying to escape to sensitive areas
      if (resolved.includes('..') || resolved.startsWith('/etc') || resolved.startsWith('/root')) {
        logger.warn('⚠️ Potentially unsafe AMBIANCE_BASE_DIR ignored:', { envBase });
        return process.cwd();
      }
      return resolved;
    } catch (error) {
      logger.warn('⚠️ Invalid AMBIANCE_BASE_DIR, using CWD:', { envBase });
      return process.cwd();
    }
  }
  return process.cwd();
}

function pathBasename(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || p;
}

export const ambianceSetupProjectTool = {
  name: 'ambiance_setup_project',
  description: `⚙️ SETUP PROJECT - Auto-detect, index, and configure project for optimal context retrieval.

Handles all the background complexity: project detection, smart indexing with ignore patterns, file watching for incremental updates, and cloud sync (if authenticated).

Run this once per project or when you want to refresh the index.`,

  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Project path (auto-detects current workspace if not provided)',
        examples: ['.', '/path/to/project', 'relative/path'],
      },
      force: {
        type: 'boolean',
        description: 'Force re-setup even if project is already configured',
        default: false,
      },
      includeTests: {
        type: 'boolean',
        description: 'Include test files in indexing',
        default: true,
      },
      watchFiles: {
        type: 'boolean',
        description: 'Start file watching for automatic updates',
        default: true,
      },
    },
  },
};

export async function handleSetupProject(args: any): Promise<any> {
  const { path: inputPath, watchFiles = true } = args;

  try {
    // Detect project path with security validation
    let projectPath: string;
    const baseDir = resolveBaseDir();

    if (inputPath) {
      // Security: Use FSGuard for path validation
      const fsGuard = new FSGuard({
        baseDir: baseDir,
        allowAbsolutePaths: false, // Only allow relative paths for security
      });

      try {
        if (inputPath === '.') {
          projectPath = baseDir;
        } else {
          // Validate path through FSGuard
          const guardedPath = await fsGuard.guardPath(inputPath);
          projectPath = guardedPath.canonical;
        }
      } catch (error) {
        logger.error('❌ Invalid project path provided:', {
          inputPath,
          error: error instanceof Error ? error.message : String(error),
        });
        return {
          success: false,
          error: `Invalid project path: ${inputPath}`,
          message: 'Path validation failed. Use relative paths within the workspace only.',
        };
      }
    } else {
      projectPath = baseDir;
    }

    logger.info('⚙️ Setting up project (thin connector)', { projectPath });

    // Perform manifest sync (server may respond with needed files); offline tolerated
    const sync = await syncProject(projectPath, pathBasename(projectPath));
    lastSyncAt = new Date();
    lastProjectId = sync.projectId;

    // Start debounced watcher if requested
    if (watchFiles) {
      currentWatcher?.stop();
      currentWatcher = new ConnectorWatcher({ baseDir: projectPath });
      await currentWatcher.start();
    }

    return {
      success: true,
      message: 'Project setup completed (thin connector)',
      project: {
        path: projectPath,
        projectId: lastProjectId,
      },
      sync: {
        manifestCount: sync.manifestCount,
        uploadedCount: sync.uploadedCount,
        limits: sync.limits,
      },
      watcher: {
        running: !!currentWatcher,
      },
    };
  } catch (error) {
    logger.error('❌ Project setup failed:', {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      message: 'Project setup failed. Check that the path exists and you have proper permissions.',
    };
  }
}

// Export state for other tools to use
export { lastSyncAt, lastProjectId, currentWatcher };
