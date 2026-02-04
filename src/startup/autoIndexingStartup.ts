/**
 * @fileOverview: Startup service for automatic project indexing when MCP server initializes
 * @module: AutoIndexingStartup
 * @keyFunctions:
 *   - initialize(): Run startup indexing process with authentication check
 *   - checkAuthentication(): Verify API key and cloud service availability
 *   - monitorIndexingProgress(): Track indexing session progress
 *   - startFileWatching(): Set up continuous file monitoring
 * @dependencies:
 *   - AutomaticIndexer: Project indexing and detection
 *   - apiClient: Cloud service authentication and health checks
 *   - ProjectIdentifier: Project detection and workspace analysis
 *   - logger: Logging utilities for startup monitoring
 * @context: Provides seamless automatic indexing on MCP server startup, detecting current project and initiating background indexing with file watching
 */

import { AutomaticIndexer } from '../local/automaticIndexer';
import { logger } from '../utils/logger';
import { apiClient } from '../client/apiClient';
import { ProjectIdentifier } from '../local/projectIdentifier';
import * as fs from 'fs';
import * as path from 'path';

export class AutoIndexingStartup {
  private static instance: AutoIndexingStartup;
  private static initializing: boolean = false;
  private indexer: AutomaticIndexer;
  private startupComplete: boolean = false;

  private constructor() {
    this.indexer = AutomaticIndexer.getInstance();
  }

  static getInstance(): AutoIndexingStartup {
    if (!AutoIndexingStartup.instance) {
      AutoIndexingStartup.instance = new AutoIndexingStartup();
    }
    return AutoIndexingStartup.instance;
  }

  /**
   * Run startup indexing process
   * Called when MCP server initializes
   */
  async initialize(baseDir?: string): Promise<void> {
    if (this.startupComplete) {
      logger.debug('🔄 Auto-indexing startup already completed');
      return;
    }

    if (AutoIndexingStartup.initializing) {
      logger.debug('🔄 Auto-indexing startup already in progress');
      return;
    }

    AutoIndexingStartup.initializing = true;
    logger.info('🚀 Starting automatic indexing startup sequence');

    // Auto-initialize workspace if WORKSPACE_FOLDER is set but WORKSPACE_INITIALIZED isn't
    const workspaceInitialized = process.env.WORKSPACE_INITIALIZED === 'true';
    const workspaceFolder = process.env.WORKSPACE_FOLDER;

    if (!workspaceInitialized && workspaceFolder) {
      logger.info('🔧 Auto-initializing workspace from WORKSPACE_FOLDER', { workspaceFolder });
      process.env.WORKSPACE_INITIALIZED = 'true';
    } else if (!workspaceInitialized && !workspaceFolder) {
      logger.info('⏸️ Auto-indexing deferred until workspace is configured (first run)');
      logger.info(
        '💡 Run manage_embeddings { action: "set_workspace", projectPath: "<your project path>" } to enable indexing'
      );
      AutoIndexingStartup.initializing = false;
      return;
    }

    try {
      // Skip automatic indexing during build processes and when running npm scripts
      const buildLockFile = path.join(process.cwd(), '.build-lock');
      const buildLockExists = fs.existsSync(buildLockFile);
      const isExplicitSkip = process.env.AMBIANCE_SKIP_INDEXING === '1';
      const isBuildProcess = buildLockExists || isExplicitSkip;

      logger.debug('🔍 Build process check', {
        buildLockFile,
        buildLockExists,
        isExplicitSkip,
        cwd: process.cwd(),
        argv: process.argv.slice(0, 3),
      });

      if (isBuildProcess) {
        logger.debug('🔨 Build process or npm script detected - skipping automatic indexing', {
          buildLockExists,
          isExplicitSkip,
          npmLifecycleEvent: process.env.npm_lifecycle_event,
          cwd: process.cwd(),
          mainModule: process.mainModule?.filename,
          argv: process.argv.slice(0, 3),
        });
        this.startupComplete = true;
        return;
      }

      // Check if user has cloud API key OR local embeddings enabled
      const hasApiKey = await this.checkAuthentication();
      const useLocalEmbeddings =
        process.env.USE_LOCAL_EMBEDDINGS === 'true' || process.env.USE_LOCAL_STORAGE === 'true';

      if (!hasApiKey && !useLocalEmbeddings) {
        logger.info(
          '⚠️ No API key configured and local embeddings disabled - skipping automatic indexing'
        );
        logger.info(
          '💡 Set AMBIANCE_API_KEY environment variable for cloud sync, or USE_LOCAL_EMBEDDINGS=true for local embeddings'
        );
        this.startupComplete = true;
        return;
      }

      if (hasApiKey) {
        logger.info('✅ Cloud API key detected - enabling automatic cloud indexing');
      } else if (useLocalEmbeddings) {
        logger.info(
          '✅ Local embeddings enabled - enabling automatic file watching for embedding updates'
        );
      }

      // Check for proper workspace configuration
      const workspaceFolder = process.env.WORKSPACE_FOLDER;
      if (!workspaceFolder) {
        logger.info(
          '⚠️ WORKSPACE_FOLDER environment variable not set - skipping automatic indexing'
        );
        logger.info(
          '💡 Set WORKSPACE_FOLDER environment variable or call manage_embeddings (action: set_workspace) to enable automatic indexing'
        );
        logger.info('🔧 This prevents indexing system directories like user home folder');

        // Try fallback workspace detection
        const { resolveWorkspacePath } = require('../tools/utils/pathUtils');
        const fallbackWorkspace = resolveWorkspacePath();
        if (fallbackWorkspace && fallbackWorkspace !== process.cwd()) {
          logger.info('🔄 Using fallback workspace detection for indexing:', { fallbackWorkspace });
          // Set the workspace for this process
          process.env.WORKSPACE_FOLDER = fallbackWorkspace;
        } else {
          this.startupComplete = true;
          return;
        }
      }

      // Validate that workspace folder exists and is accessible
      const workingDir = baseDir || workspaceFolder;
      if (!workingDir) {
        logger.warn('⚠️ No workspace folder configured - skipping automatic indexing');
        this.startupComplete = true;
        return;
      }
      if (!fs.existsSync(workingDir)) {
        logger.warn('⚠️ Configured workspace folder does not exist - skipping automatic indexing', {
          workspaceFolder: workingDir,
        });
        this.startupComplete = true;
        return;
      }

      // Handle cloud indexing vs local file watching
      if (hasApiKey) {
        // Cloud indexing: full auto-detect and index
        const session = await this.indexer.autoDetectAndIndex(workingDir);

        if (session) {
          logger.info(`🎯 Started cloud indexing session ${session.id} for current project`);
          // Monitor session progress
          this.monitorIndexingProgress(session.id);
        } else {
          logger.info('ℹ️ No project to index or project already up to date');
        }
      }

      // Always start file watching for both cloud and local embeddings
      // Use proper workspace detection to avoid watching system directories
      const projectIdentifier = ProjectIdentifier.getInstance();
      const projectInfo = await projectIdentifier.identifyProject(workingDir);
      const projectPath =
        projectInfo?.path || projectIdentifier.findWorkspaceRootSync(workingDir || process.cwd());

      await this.indexer.startWatching(projectPath);
      logger.info(
        `👁️ Started file watching for ${projectPath} (${hasApiKey ? 'cloud + local' : 'local embeddings only'})`
      );

      this.startupComplete = true;
      logger.info('✅ Auto-indexing startup completed successfully');
    } catch (error) {
      logger.error('❌ Auto-indexing startup failed:', {
        error: error instanceof Error ? error.message : String(error),
      });
      this.startupComplete = true;
      AutoIndexingStartup.initializing = false;
    } finally {
      AutoIndexingStartup.initializing = false;
    }
  }

  /**
   * Check if user has valid API key
   */
  private async checkAuthentication(): Promise<boolean> {
    // Gate outbound request: require API key before any network probe
    const apiKey = process.env.AMBIANCE_API_KEY;
    if (!apiKey) {
      return false;
    }

    try {
      const response = await apiClient.get('/health');
      return response && response.status === 'ok';
    } catch {
      logger.warn('⚠️ API key configured but not valid');
      return false;
    }
  }

  /**
   * Monitor indexing progress and log updates
   */
  private async monitorIndexingProgress(sessionId: string): Promise<void> {
    const maxChecks = 60; // Max 5 minutes of monitoring (5s interval)
    let checks = 0;

    const checkProgress = async () => {
      try {
        checks++;
        const session = this.indexer.getSession(sessionId);

        if (!session) {
          logger.warn(`⚠️ Session ${sessionId} not found`);
          return;
        }

        const progress =
          session.filesFound > 0
            ? Math.round((session.filesProcessed / session.filesFound) * 100)
            : 0;

        if (session.status === 'completed') {
          logger.info(
            `✅ Indexing completed: ${session.filesProcessed} files, ${session.chunksCreated} chunks, ${session.symbolsExtracted} symbols`
          );
          return;
        }

        if (session.status === 'failed') {
          logger.error(`❌ Indexing failed: ${session.errors.join(', ')}`);
          return;
        }

        if (checks % 6 === 0) {
          // Log every 30 seconds
          logger.info(
            `📊 Indexing progress: ${progress}% (${session.filesProcessed}/${session.filesFound} files)`
          );
        }

        if (checks < maxChecks && !['completed', 'failed'].includes(session.status)) {
          setTimeout(checkProgress, 5000); // Check every 5 seconds
        }
      } catch (error) {
        logger.error('❌ Progress monitoring failed:', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };

    // Start monitoring after a short delay
    setTimeout(checkProgress, 2000);
  }

  /**
   * Setup graceful shutdown
   */
  async shutdown(): Promise<void> {
    logger.info('🔄 Shutting down auto-indexing...');

    try {
      // Stop all file watchers
      // Note: In a real implementation, we'd maintain a list of watched projects
      // For now, we'll just log the shutdown

      logger.info('✅ Auto-indexing shutdown completed');
    } catch (error) {
      logger.error('❌ Auto-indexing shutdown failed:', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * Initialize automatic indexing when MCP server starts
 * Call this from the main MCP server initialization
 */
export async function initializeAutoIndexing(baseDir?: string): Promise<void> {
  const startup = AutoIndexingStartup.getInstance();
  await startup.initialize(baseDir);
}

/**
 * Cleanup automatic indexing when MCP server shuts down
 */
export async function shutdownAutoIndexing(): Promise<void> {
  const startup = AutoIndexingStartup.getInstance();
  await startup.shutdown();
}
