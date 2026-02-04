/**
 * @fileOverview: MCP server implementation using the official @modelcontextprotocol/sdk
 * @module: AmbianceMCPServer
 * @keyFunctions:
 *   - setupToolHandlers(): Register tool handlers with the MCP server
 *   - start(): Initialize server with stdio transport
 * @dependencies:
 *   - @modelcontextprotocol/sdk: Official MCP SDK
 *   - localTools: Core local tool definitions
 *   - localHandlers: Tool execution functions
 *   - logger: Logging utilities
 * @context: Proper MCP server implementation using the latest SDK for full protocol compliance
 */

// Environment variables are provided by Cursor via mcp.json configuration

// Core imports for MCP server functionality
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import {
  localTools as lightweightTools,
  localHandlers as lightweightHandlers,
  localSemanticCompactTool,
  localProjectHintsTool,
  localFileSummaryTool,
  frontendInsightsTool,
  localDebugContextTool,
  manageEmbeddingsTool,
  astGrepTool,
  handleSemanticCompact,
  handleProjectHints,
  handleFileSummary,
  handleFrontendInsights,
  handleLocalDebugContext,
  handleManageEmbeddings,
  handleAstGrep,
  logPathConfiguration,
} from './tools/localTools';
import { openaiCompatibleTools, openaiCompatibleHandlers } from './tools/aiTools';
import { cloudToolDefinitions, cloudToolHandlers } from './tools/cloudTools/index';
import { getAvailableTools } from './tools/index';
import { logger } from './utils/logger';
import { openaiService } from './core/openaiService';
import { apiClient } from './client/apiClient';
import { initializeAutoIndexing } from './startup/autoIndexingStartup';
import * as fs from 'fs';
import * as path from 'path';

// Get package version for logging
const packageJson = require('../../package.json');

// MCP Server implementation using official SDK
class AmbianceMCPServer {
  private static instance: AmbianceMCPServer | null = null;
  private static initializing: boolean = false;
  private server!: Server;
  private tools!: any[];
  private handlers!: any;
  private validKeys!: {
    openai: boolean;
    ambiance: boolean;
  };

  constructor() {
    // Return existing instance if already created
    if (AmbianceMCPServer.instance) {
      logger.warn('⚠️ AmbianceMCPServer instance already exists, returning existing instance');
      // Copy the existing instance properties to this instance for TypeScript
      Object.assign(this, AmbianceMCPServer.instance);
      return;
    }

    if (AmbianceMCPServer.initializing) {
      throw new Error('AmbianceMCPServer is already being initialized');
    }

    AmbianceMCPServer.initializing = true;

    // Apply fallback environment variables if not set (for when mcp.json env vars aren't passed through)
    this.applyFallbackEnvironmentVariables();

    // Force enable local embeddings if we have any embeddings tools
    if (!process.env.USE_LOCAL_EMBEDDINGS) {
      process.env.USE_LOCAL_EMBEDDINGS = 'true';
      logger.info('🔧 Forcing USE_LOCAL_EMBEDDINGS=true for embedding functionality');
    }

    // Debug: Log the current state of key environment variables
    logger.info('🔧 Environment state after fallbacks', {
      USE_LOCAL_EMBEDDINGS: process.env.USE_LOCAL_EMBEDDINGS || 'undefined',
      LOCAL_EMBEDDING_MODEL: process.env.LOCAL_EMBEDDING_MODEL || 'undefined',
      AMBIANCE_API_KEY: process.env.AMBIANCE_API_KEY ? 'set' : 'unset',
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ? 'set' : 'unset',
    });

    // Force apply environment variables for local embeddings configuration
    if (!process.env.LOCAL_EMBEDDING_MODEL && process.env.USE_LOCAL_EMBEDDINGS === 'true') {
      process.env.LOCAL_EMBEDDING_MODEL = 'all-MiniLM-L6-v2';
      logger.info('🔧 Applied forced LOCAL_EMBEDDING_MODEL fallback');
    }

    // Security: Log only presence of sensitive environment variables, not their values
    logger.info('🔍 Environment key presence', {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ? 'set' : 'unset',
      AMBIANCE_API_KEY: process.env.AMBIANCE_API_KEY ? 'set' : 'unset',
      OPENAI_BASE_URL: process.env.OPENAI_BASE_URL ? 'set' : 'unset',
    });

    // Initialize with core tools; gate local_context on local embeddings/storage or Ambiance API key
    const useLocalEmbeddingsEnv = process.env.USE_LOCAL_EMBEDDINGS;
    const useLocalStorageEnv = process.env.USE_LOCAL_STORAGE;
    const allowLocalContext =
      useLocalEmbeddingsEnv === 'true' ||
      useLocalStorageEnv === 'true' ||
      !!process.env.AMBIANCE_API_KEY;

    // Log environment flags relevant to local_context availability
    logger.info('🔧 Startup flags', {
      USE_LOCAL_EMBEDDINGS: useLocalEmbeddingsEnv || 'undefined',
      USE_LOCAL_STORAGE: useLocalStorageEnv || 'undefined',
      AMBIANCE_API_KEY: process.env.AMBIANCE_API_KEY ? 'set' : 'unset',
      localContextEnabled: allowLocalContext,
    });

    this.tools = [
      ...(allowLocalContext ? [localSemanticCompactTool] : []),
      localProjectHintsTool,
      localFileSummaryTool,
      frontendInsightsTool,
      localDebugContextTool,
      astGrepTool,
    ];

    this.handlers = {
      ...(allowLocalContext ? { local_context: handleSemanticCompact } : {}),
      local_project_hints: handleProjectHints,
      local_file_summary: handleFileSummary,
      frontend_insights: handleFrontendInsights,
      local_debug_context: handleLocalDebugContext,
      ast_grep_search: handleAstGrep,
    };

    // Note: ambianceTools are CLI-only for manual control.
    // Automatic indexing runs via autoIndexingStartup on server initialization.

    this.validKeys = { openai: false, ambiance: false };

    // Initialize the MCP server
    this.server = new Server(
      {
        name: 'ambiance-mcp',
        version: packageJson.version,
      },
      {
        capabilities: {
          tools: {},
        },
        instructions: 'Ambiance MCP Server providing code context and analysis tools',
      }
    );

    this.setupToolHandlers();

    // Set the singleton instance
    AmbianceMCPServer.instance = this;
    AmbianceMCPServer.initializing = false;
  }

  /**
   * Apply fallback environment variables when mcp.json env vars aren't passed through by Cursor
   */
  private applyFallbackEnvironmentVariables(): void {
    // Use intelligent workspace detection instead of hardcoded paths
    const { detectWorkspaceDirectory } = require('./tools/utils/pathUtils');

    // Fallback environment variables (should match mcp.json configuration)
    const fallbacks = {
      WORKSPACE_FOLDER: detectWorkspaceDirectory(),
      USE_LOCAL_EMBEDDINGS: 'true',
      LOCAL_EMBEDDING_MODEL: 'all-MiniLM-L6-v2',
      OPENAI_BASE_URL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      OPENAI_BASE_MODEL: 'gpt-5',
      OPENAI_MINI_MODEL: 'gpt-5-mini',
      OPENAI_EMBEDDINGS_MODEL: 'text-embedding-3-small',
    };

    let appliedFallbacks = false;
    for (const [key, value] of Object.entries(fallbacks)) {
      if (!process.env[key]) {
        process.env[key] = value;
        appliedFallbacks = true;
        logger.info(`🔧 Applied fallback for ${key}: ${key.includes('KEY') ? '[SET]' : value}`);
      }
    }

    if (appliedFallbacks) {
      logger.info(
        '⚠️ Applied fallback environment variables - this indicates mcp.json env vars may not be passing through correctly from Cursor'
      );
    }
  }

  async initializeAsync(): Promise<void> {
    // Validate API keys
    this.validKeys = await this.validateApiKeys();

    // Check if local embeddings are enabled for embedding tools
    // Support both USE_LOCAL_EMBEDDINGS and USE_LOCAL_STORAGE for backward compatibility
    const useLocalEmbeddings =
      process.env.USE_LOCAL_EMBEDDINGS === 'true' || process.env.USE_LOCAL_STORAGE === 'true';

    // Update tools and handlers based on validated API keys and local embeddings
    if (this.validKeys.openai) {
      logger.info('✅ OpenAI connectivity probe succeeded - adding OpenAI-compatible tools');
      this.tools.push(...openaiCompatibleTools);
      this.handlers = { ...this.handlers, ...openaiCompatibleHandlers };
    } else if (process.env.OPENAI_API_KEY) {
      logger.warn(
        '⚠️ OpenAI API key detected but connectivity probe failed - OpenAI tools disabled'
      );
    }

    if (this.validKeys.ambiance) {
      logger.info('✅ Ambiance API key validated - adding cloud storage and embedding tools');
      this.tools.push(...cloudToolDefinitions);
      this.handlers = { ...this.handlers, ...cloudToolHandlers };
    } else if (process.env.AMBIANCE_API_KEY) {
      logger.warn('⚠️ Ambiance API key detected but validation failed - cloud tools disabled');
    }

    // Add embedding tools if local embeddings are enabled
    if (useLocalEmbeddings) {
      logger.info('✅ Local embeddings enabled - adding consolidated embedding management tool');
      this.tools.push(manageEmbeddingsTool);
      this.handlers = {
        ...this.handlers,
        manage_embeddings: handleManageEmbeddings,
      };
    } else {
      logger.info('📦 Local embeddings disabled - embedding management tool not available');
      logger.info(
        '💡 To enable embedding management: Set USE_LOCAL_EMBEDDINGS=true or USE_LOCAL_STORAGE=true'
      );
    }

    if (!this.validKeys.openai && !this.validKeys.ambiance && !useLocalEmbeddings) {
      logger.info(
        '📦 No valid API keys detected and local embeddings disabled - loading essential local tools only'
      );
    }

    logger.info(`🚀 Initializing Ambiance MCP Server v${packageJson.version} with SDK v1.17.3`);
    logger.info(`📦 Loaded ${this.tools.length} tools: ${this.tools.map(t => t.name).join(', ')}`);

    // Log path configuration for debugging
    logPathConfiguration();

    // Skip automatic indexing during build processes
    const isBuildProcess =
      process.env.AMBIANCE_SKIP_INDEXING === '1' ||
      process.env.npm_lifecycle_event ||
      process.env.npm_package_scripts ||
      process.env.npm_config_argv ||
      process.env.TSC_NONPOLLING_WATCHER === 'true' ||
      process.argv.some(
        arg => arg.includes('tsc') || arg.includes('typescript') || arg.includes('npm')
      ) ||
      process.mainModule?.filename?.includes('tsc') ||
      process.mainModule?.filename?.includes('npm') ||
      process.argv[0]?.includes('tsc') ||
      process.argv[0]?.includes('npm') ||
      (process.argv[1] && process.argv[1].includes('-e')) ||
      process.argv.some(arg => arg.includes('copy-facets-config') || arg.includes('copy-schemas'));

    if (isBuildProcess) {
      logger.debug('🔨 Build process detected - skipping automatic indexing in MCP server');
      return;
    }

    // Initialize automatic indexing and embedding generation in background
    if (this.validKeys.openai || this.validKeys.ambiance || useLocalEmbeddings) {
      logger.info('🚀 Starting background embedding generation');
      // Don't await - let it run in background
      initializeAutoIndexing().catch(error => {
        logger.warn('⚠️ Background indexing failed to start', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    } else {
      logger.info('⚠️ Background embedding generation disabled');
      logger.info('💡 To enable: Set USE_LOCAL_EMBEDDINGS=true or provide API keys');
    }
  }

  private async validateApiKeys(): Promise<{ openai: boolean; ambiance: boolean }> {
    const result = { openai: false, ambiance: false };

    // Validate OpenAI key
    if (process.env.OPENAI_API_KEY) {
      try {
        const skipProbe = process.env.SKIP_OPENAI_PROBE === 'true';
        if (skipProbe) {
          logger.warn('⏭️ Skipping OpenAI live probe due to SKIP_OPENAI_PROBE=true');
          result.openai = openaiService.isReady();
        } else {
          const timeoutMs = Number(process.env.OPENAI_PROBE_TIMEOUT_MS || '3000');
          result.openai = await openaiService.quickProbe(timeoutMs);
        }
        if (result.openai) {
          logger.info('✅ OpenAI connectivity probe successful');
        } else {
          logger.warn('⚠️ OpenAI key detected but connectivity probe failed');
        }
      } catch (error) {
        logger.warn('⚠️ OpenAI API key validation failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Validate Ambiance key (optional skip)
    if (process.env.AMBIANCE_API_KEY) {
      try {
        const skipAmbianceProbe = process.env.SKIP_AMBIANCE_PROBE === 'true';
        if (skipAmbianceProbe) {
          logger.warn('⏭️ Skipping Ambiance API health check due to SKIP_AMBIANCE_PROBE=true');
          result.ambiance = false;
        } else {
          // Use a lightweight health check to validate the key
          result.ambiance = await apiClient.healthCheck();
        }
        if (result.ambiance) {
          logger.info('✅ Ambiance API key validation successful');
        } else if (!skipAmbianceProbe) {
          logger.warn('⚠️ Ambiance API health check failed');
        }
      } catch (error) {
        logger.warn('⚠️ Ambiance API key validation failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return result;
  }

  /**
   * Dispose of the singleton instance (for testing)
   */
  static dispose(): void {
    AmbianceMCPServer.instance = null;
    AmbianceMCPServer.initializing = false;
  }

  private setupToolHandlers() {
    // Register tools/list handler
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      logger.info('📋 Listing available tools');
      return {
        tools: this.tools,
      };
    });

    // Register tools/call handler
    this.server.setRequestHandler(CallToolRequestSchema, async request => {
      const { name, arguments: args } = request.params;
      const pid = process.pid;
      const toolCallId = (request as any)?.id || 'n/a';
      logger.info(`🔧 Executing tool: ${name}`, { args, pid, toolCallId });

      const startTime = Date.now();

      try {
        if (name in this.handlers) {
          logger.info(`📝 Calling handler for: ${name}`, { pid, toolCallId });
          const result = await this.handlers[name as keyof typeof this.handlers](args);
          const elapsed = Date.now() - startTime;

          logger.info(`✅ Tool ${name} completed in ${elapsed}ms`, { pid, toolCallId });

          // Log result size before JSON.stringify
          const resultStr = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
          logger.info(`📊 Response size: ${resultStr.length} characters`);

          const response = {
            content: [
              {
                type: 'text',
                text: resultStr,
              },
            ],
          };

          logger.info(`🚀 Returning response for: ${name}`);
          return response;
        } else {
          throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`❌ Tool ${name} failed: ${errorMessage}`);
        throw error;
      }
    });

    logger.info('🔧 Tool handlers registered successfully');
  }

  async start() {
    logger.info('🌟 Starting MCP Server with stdio transport');

    // Create instance-specific lock file to allow multiple agents/instances
    const lockFile = path.join(process.cwd(), `.ambiance-mcp-${process.pid}.lock`);
    try {
      // Clean up any stale lock files from previous runs (older than 10 minutes)
      const lockDir = process.cwd();
      const lockFiles = fs
        .readdirSync(lockDir)
        .filter(f => f.startsWith('.ambiance-mcp-') && f.endsWith('.lock'));

      for (const file of lockFiles) {
        const filePath = path.join(lockDir, file);
        try {
          const lockData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          const now = Date.now();
          const lockAge = now - lockData.timestamp;

          // Remove stale locks (older than 10 minutes)
          if (lockAge > 10 * 60 * 1000) {
            logger.debug(
              `🗑️ Removing stale lock file: ${file} (age: ${Math.round(lockAge / 1000 / 60)}min)`
            );
            fs.unlinkSync(filePath);
          }
        } catch (e) {
          // If we can't read/parse the lock file, remove it
          logger.debug(`🗑️ Removing invalid lock file: ${file}`);
          fs.unlinkSync(filePath);
        }
      }

      // Create new instance-specific lock file
      const lockData = {
        pid: process.pid,
        timestamp: Date.now(),
        version: packageJson.version,
        workspace: process.env.WORKSPACE_FOLDER || process.cwd(),
      };
      fs.writeFileSync(lockFile, JSON.stringify(lockData, null, 2));
      logger.info('🔒 Created instance-specific lock file', {
        lockFile: path.basename(lockFile),
        pid: process.pid,
      });
    } catch (error) {
      logger.warn('⚠️ Could not create lock file, continuing anyway', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      // Initialize async components
      await this.initializeAsync();

      // Create stdio transport
      const transport = new StdioServerTransport();

      // Connect server to transport
      await this.server.connect(transport);

      logger.info('✅ MCP Server ready for requests');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`💥 Failed to start server: ${errorMessage}`);
      throw error;
    }
  }
}

// Graceful shutdown
const cleanupLockFile = () => {
  try {
    const lockFile = path.join(process.cwd(), `.ambiance-mcp-${process.pid}.lock`);
    if (fs.existsSync(lockFile)) {
      fs.unlinkSync(lockFile);
      logger.info('🔓 Removed instance lock file', { pid: process.pid });
    }
  } catch (error) {
    logger.warn('⚠️ Could not remove lock file during shutdown', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

process.on('SIGINT', () => {
  logger.info('🔄 Received SIGINT, shutting down gracefully...');
  cleanupLockFile();
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('🔄 Received SIGTERM, shutting down gracefully...');
  cleanupLockFile();
  process.exit(0);
});

// Start server if this file is executed directly
if (require.main === module) {
  const server = new AmbianceMCPServer();
  server.start().catch(error => {
    logger.error('💥 Fatal error starting server:', error);
    process.exit(1);
  });
}

export { AmbianceMCPServer };
