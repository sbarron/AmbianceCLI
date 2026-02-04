#!/usr/bin/env node

/**
 * Ambiance MCP Server CLI
 *
 * Provides command-line interface for the Ambiance MCP server and local tools.
 * Supports MCP server mode, help display, and direct tool execution.
 */

import type { ProviderType } from './core/openaiService';
import type { ModelTargetSpec } from './tools/aiTools/multiModelCompare';

const packageJson = require('../../package.json');

// Import local tool handlers for CLI access (using dynamic imports to avoid issues)
const handleSemanticCompact = require('./tools/localTools/semanticCompact').handleSemanticCompact;
const handleProjectHints = require('./tools/localTools/projectHints').handleProjectHints;
const handleFileSummary = require('./tools/localTools/fileSummary').handleFileSummary;
const handleFrontendInsights =
  require('./tools/localTools/frontendInsights').handleFrontendInsights;
const handleLocalDebugContext = require('./tools/debug/localDebugContext').handleLocalDebugContext;
const handleAstGrep = require('./tools/localTools/astGrep').handleAstGrep;
const handleManageEmbeddings =
  require('./tools/localTools/embeddingManagement').handleManageEmbeddings;
const { detectWorkspaceDirectory } = require('./tools/utils/pathUtils');

/**
 * Detect the appropriate project path for CLI operations
 */
function detectProjectPath(): string {
  // First check if WORKSPACE_FOLDER is set
  if (process.env.WORKSPACE_FOLDER) {
    return process.env.WORKSPACE_FOLDER;
  }

  // Use intelligent workspace detection
  const detected = detectWorkspaceDirectory();
  if (detected && detected !== process.cwd()) {
    console.log(`🔍 Auto-detected project directory: ${detected}`);
    return detected;
  }

  // Fallback to current directory
  return process.cwd();
}

/**
 * Estimate embedding generation time based on project characteristics
 */
function estimateEmbeddingTime(fileCount: number, avgFileSize: number = 5000): string {
  // Based on empirical data: ~200-500 files per minute depending on size and hardware
  // Rough estimates:
  // - Small files (< 1KB): ~1000 files/minute
  // - Medium files (1-10KB): ~500 files/minute
  // - Large files (> 10KB): ~200 files/minute

  let filesPerMinute = 500; // Default assumption

  if (avgFileSize < 1000) {
    filesPerMinute = 1000;
  } else if (avgFileSize < 10000) {
    filesPerMinute = 500;
  } else {
    filesPerMinute = 200;
  }

  const estimatedMinutes = Math.ceil(fileCount / filesPerMinute);

  if (estimatedMinutes < 1) {
    return '< 1 minute';
  } else if (estimatedMinutes === 1) {
    return '1 minute';
  } else if (estimatedMinutes < 60) {
    return `${estimatedMinutes} minutes`;
  } else {
    const hours = Math.floor(estimatedMinutes / 60);
    const remainingMinutes = estimatedMinutes % 60;
    return remainingMinutes > 0
      ? `${hours}h ${remainingMinutes}m`
      : `${hours} hour${hours > 1 ? 's' : ''}`;
  }
}

// Make this file a module
export {};

// Force enable local embeddings for CLI embedding operations
if (!process.env.USE_LOCAL_EMBEDDINGS) {
  process.env.USE_LOCAL_EMBEDDINGS = 'true';
  console.log('🔧 Auto-enabled USE_LOCAL_EMBEDDINGS=true for embedding functionality');
}

type OptionValue = string | number | boolean | string[] | undefined;

interface GlobalOptions {
  projectPath?: string;
  format?: string;
  output?: string;
  excludePatterns?: string[];
  help?: boolean;
  verbose?: boolean;
  expanded?: boolean;
  [key: string]: OptionValue;
}

type ToolArgMap = Record<string, OptionValue>;

interface ToolResultObject {
  success?: boolean;
  content?: string;
  summary?: string;
  [key: string]: unknown;
}

interface EnvVarSpec {
  name: string;
  defaultValue: string;
  description: string;
}

interface EnvVarCategory {
  title: string;
  summary?: string;
  vars: EnvVarSpec[];
}

const ENVIRONMENT_VARIABLES: EnvVarCategory[] = [
  {
    title: 'Core Workspace',
    summary: 'Workspace detection and automatic embedding generation.',
    vars: [
      {
        name: 'WORKSPACE_FOLDER',
        defaultValue: 'Auto-detected or set via manage_embeddings',
        description: 'Root path analysed by tools.',
      },
      {
        name: 'WORKSPACE_INITIALIZED',
        defaultValue: 'false',
        description: 'Set to true after workspace is configured.',
      },
      {
        name: 'WORKSPACE_PROACTIVE_EMBEDDINGS',
        defaultValue: 'false',
        description: 'Deprecated - embeddings now auto-generate on first tool use.',
      },
      {
        name: 'WORKSPACE_EMBEDDING_MAX_FILES',
        defaultValue: '500',
        description: 'Deprecated - use manage_embeddings for control.',
      },
      {
        name: 'WORKSPACE_EMBEDDING_MIN_FILES',
        defaultValue: '10',
        description: 'Deprecated - use manage_embeddings for control.',
      },
      {
        name: 'AMBIANCE_BASE_DIR',
        defaultValue: 'Not set',
        description: 'Optional base path hint for workspace discovery.',
      },
      {
        name: 'CURSOR_WORKSPACE_ROOT',
        defaultValue: 'IDE-provided',
        description: 'Cursor workspace hint used when available.',
      },
      {
        name: 'VSCODE_WORKSPACE_FOLDER',
        defaultValue: 'IDE-provided',
        description: 'VS Code workspace hint used when available.',
      },
    ],
  },
  {
    title: 'Embeddings & Storage',
    summary: 'Local embedding engine with automatic generation on first tool use.',
    vars: [
      {
        name: 'USE_LOCAL_EMBEDDINGS',
        defaultValue: 'true',
        description: 'Enables local embeddings (auto-generated on first tool use).',
      },
      {
        name: 'USE_LOCAL_STORAGE',
        defaultValue: 'false',
        description: 'Legacy toggle kept for backward compatibility.',
      },
      {
        name: 'LOCAL_EMBEDDING_MODEL',
        defaultValue: 'all-MiniLM-L6-v2',
        description: 'Transformers.js model used for offline embeddings.',
      },
      {
        name: 'LOCAL_STORAGE_PATH',
        defaultValue: '~/.ambiance',
        description: 'Folder for local embedding SQLite databases.',
      },
      {
        name: 'EMBEDDING_ASSISTED_HINTS',
        defaultValue: 'Auto',
        description: 'Turns on when local embeddings exist and are ready.',
      },
      {
        name: 'EMBEDDING_BATCH_SIZE',
        defaultValue: '32',
        description: 'Items processed per embedding batch.',
      },
      {
        name: 'EMBEDDING_PARALLEL_MODE',
        defaultValue: 'false',
        description: 'Enable parallel batch execution for embeddings.',
      },
      {
        name: 'EMBEDDING_MAX_CONCURRENCY',
        defaultValue: '10',
        description: 'Maximum concurrent requests when parallel mode is true.',
      },
      {
        name: 'EMBEDDING_RATE_LIMIT_RETRIES',
        defaultValue: '5',
        description: 'Retry attempts after provider rate limits.',
      },
      {
        name: 'EMBEDDING_RATE_LIMIT_BASE_DELAY',
        defaultValue: '1000 ms',
        description: 'Base delay between retries when throttled.',
      },
      {
        name: 'EMBEDDING_QUANTIZATION',
        defaultValue: 'true',
        description: 'Stores embeddings as int8 by default.',
      },
      {
        name: 'EMBEDDING_QUOTAS',
        defaultValue: 'false',
        description: 'Enforce per-project and global storage quotas.',
      },
      {
        name: 'EMBEDDING_GLOBAL_QUOTA',
        defaultValue: '10GB',
        description: 'Total storage cap when quotas are enabled.',
      },
      {
        name: 'USE_OPENAI_EMBEDDINGS',
        defaultValue: 'false',
        description: 'Opt in to use OpenAI for embeddings instead of local models.',
      },
      {
        name: 'USE_VOYAGEAI_EMBEDDINGS',
        defaultValue: 'false',
        description: 'Legacy VoyageAI toggle (feature off by default).',
      },
      {
        name: 'VOYAGEAI_MODEL',
        defaultValue: 'voyageai-model',
        description: 'Default VoyageAI model name when enabled.',
      },
    ],
  },
  {
    title: 'OpenAI & Providers',
    summary: 'API connectivity and model defaults for hosted AI providers.',
    vars: [
      {
        name: 'OPENAI_API_KEY',
        defaultValue: 'Not set',
        description: 'Required to unlock OpenAI-compatible tools.',
      },
      {
        name: 'OPENAI_BASE_URL',
        defaultValue: 'https://api.openai.com/v1',
        description: 'Override for OpenAI-style endpoints.',
      },
      {
        name: 'OPENAI_BASE_MODEL',
        defaultValue: 'gpt-5',
        description: 'Primary reasoning model requested by default.',
      },
      {
        name: 'OPENAI_MINI_MODEL',
        defaultValue: 'gpt-5-mini',
        description: 'Lightweight model used for fast operations.',
      },
      {
        name: 'OPENAI_EMBEDDINGS_MODEL',
        defaultValue: 'text-embedding-3-small',
        description: 'Embeddings model requested from hosted providers.',
      },
      {
        name: 'OPENAI_PROVIDER',
        defaultValue: 'openai',
        description:
          'Explicit provider selector (openai, qwen, azure, anthropic, together, openrouter, grok, groq, custom).',
      },
      {
        name: 'OPENAI_ORG_ID',
        defaultValue: 'Not set',
        description: 'Optional OpenAI organisation identifier.',
      },
      {
        name: 'OPENAI_PROBE_TIMEOUT_MS',
        defaultValue: '3000',
        description: 'Timeout used when probing OpenAI connectivity.',
      },
      {
        name: 'SKIP_OPENAI_PROBE',
        defaultValue: 'false',
        description: 'Skip connectivity probe in constrained environments.',
      },
      {
        name: 'AZURE_OPENAI_ENDPOINT',
        defaultValue: 'Not set',
        description: 'Azure endpoint when OPENAI_PROVIDER=azure.',
      },
      {
        name: 'PROJECT_HINTS_MODEL',
        defaultValue: 'gpt-5-mini',
        description: 'Fallback hints model when providers are unavailable.',
      },
      {
        name: 'AI_CODE_EXPLANATION_TIMEOUT_MS',
        defaultValue: '60000',
        description: 'Timeout applied to AI code explanation requests.',
      },
    ],
  },
  {
    title: 'Ambiance Cloud',
    summary: 'Settings for Ambiance cloud APIs and local overrides.',
    vars: [
      {
        name: 'AMBIANCE_API_KEY',
        defaultValue: 'Not set',
        description: 'Required to enable Ambiance cloud tooling.',
      },
      {
        name: 'AMBIANCE_API_URL',
        defaultValue: 'https://api.ambiance.dev',
        description: 'Primary Ambiance API endpoint.',
      },
      {
        name: 'AMBIANCE_API_BASE_URL',
        defaultValue: 'https://api.ambiance.dev',
        description: 'Alternate endpoint for helper clients.',
      },
      {
        name: 'USING_LOCAL_SERVER_URL',
        defaultValue: 'Not set',
        description: 'Direct cloud calls to a local Ambiance-compatible server.',
      },
      {
        name: 'AMBIANCE_DEVICE_TOKEN',
        defaultValue: 'local-device',
        description: 'Identifier sent with project sync operations.',
      },
    ],
  },
  {
    title: 'Diagnostics & Logging',
    summary: 'Flags that adjust logging verbosity.',
    vars: [
      { name: 'DEBUG', defaultValue: 'false', description: 'Enable verbose debug logging.' },
      {
        name: 'NODE_ENV',
        defaultValue: 'production',
        description: 'Controls logging mode (test, development, etc.).',
      },
    ],
  },
];

// Parse command line arguments
const args = process.argv.slice(2);

// Global options
const wantsExpandedHelp =
  args.includes('--expanded') || args.includes('--env-help') || args.includes('-E');
const isHelp = args.includes('--help') || args.includes('-h');
const isVersion = args.includes('--version') || args.includes('-v') || args.includes('version');
const isServer = args.includes('--server') || args.includes('-s');

// Auto-detect MCP server mode: when no args provided or running non-interactively
const isMcpServerMode = isServer || (args.length === 0 && !process.stdout.isTTY);

// Tool commands
const commands = [
  'context',
  'hints',
  'summary',
  'frontend',
  'debug',
  'grep',
  'compare',
  'embeddings',
  'ambiance_auto_detect_index',
  'ambiance_index_project',
  'ambiance_reset_indexes',
  'ambiance_start_watching',
  'ambiance_stop_watching',
  'ambiance_get_indexing_status',
];
const isToolCommand = args.length > 0 && commands.includes(args[0]);

// Parse global options
function parseGlobalOptions(args: string[]): { options: GlobalOptions; remaining: string[] } {
  const options: GlobalOptions = {};
  const remaining: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      if (arg === '--project-path' && i + 1 < args.length) {
        options.projectPath = args[++i];
      } else if (arg === '--format' && i + 1 < args.length) {
        options.format = args[++i];
      } else if (arg === '--output' && i + 1 < args.length) {
        options.output = args[++i];
      } else if (arg === '--exclude-patterns' && i + 1 < args.length) {
        options.excludePatterns = args[++i]
          .split(',')
          .map(s => s.trim())
          .filter(s => s.length > 0);
      } else if (arg === '--help' || arg === '-h') {
        options.help = true;
      } else if (arg === '--verbose' || arg === '-v') {
        options.verbose = true;
      } else {
        // Unrecognized arguments starting with -- should go to remaining for tool-specific parsing
        remaining.push(arg);
      }
    } else if (!arg.startsWith('-')) {
      remaining.push(arg);
    }
  }

  return { options, remaining };
}

const { options: globalOptions, remaining } = parseGlobalOptions(args);

/**
 * Display help information
 */
function showHelp(options: { expanded?: boolean } = {}): void {
  const expanded = options.expanded === true;
  console.log('🤖 Ambiance MCP Server');
  console.log('======================');
  console.log('');
  console.log('Intelligent code context and analysis for modern IDEs');
  console.log('Use as an MCP tool in your IDE or directly from the command line');
  console.log('');
  console.log('📖 Documentation & Setup:');
  console.log('  https://github.com/sbarron/AmbianceMCP');
  console.log('');
  console.log('🚀 Quick Start:');
  console.log('  1. Install: npm install -g @jackjackstudios/ambiance-mcp');
  console.log(
    '  2. Create Embeddings (Recommended): Navigate to your project and generate local embeddings'
  );
  console.log('     cd /path/to/your/project');
  console.log('     ambiance-mcp embeddings create');
  console.log('     (Enables semantic search and improves context analysis. Takes 2-10 minutes)');
  console.log('  3. Add to your MCP configuration (Cursor/Claude/other IDEs):');
  console.log('');
  console.log('     Windows:');
  console.log('     "ambiance": {');
  console.log('       "command": "cmd",');
  console.log('       "args": [');
  console.log('         "/c",');
  console.log('         "npx",');
  console.log('         "-y",');
  console.log('         "@jackjackstudios/ambiance-mcp@latest"');
  console.log('       ],');
  console.log('       "env": {');
  console.log('         "WORKSPACE_FOLDER": "C:\\\\DevelopmentDirectory\\\\YourProject",');
  console.log('         "USE_LOCAL_EMBEDDINGS": "true",');
  console.log('         "LOCAL_EMBEDDING_MODEL": "all-MiniLM-L6-v2"');
  console.log('       }');
  console.log('     }');
  console.log('');
  console.log('     macOS/Linux:');
  console.log('     "ambiance": {');
  console.log('       "command": "npx",');
  console.log('       "args": [');
  console.log('         "-y",');
  console.log('         "@jackjackstudios/ambiance-mcp@latest"');
  console.log('       ],');
  console.log('       "env": {');
  console.log('         "WORKSPACE_FOLDER": "/path/to/your/project",');
  console.log('         "USE_LOCAL_EMBEDDINGS": "true",');
  console.log('         "LOCAL_EMBEDDING_MODEL": "all-MiniLM-L6-v2"');
  console.log('       }');
  console.log('     }');
  console.log('');
  console.log('💡 Features:');
  console.log('  • 60-80% token reduction through semantic compaction');
  console.log('  • Multi-language support (TypeScript, JavaScript, Python, Go, Rust, C/C++, Java)');
  console.log('  • Automatic local embeddings (generated on first tool use)');
  console.log('  • Incremental file updates (3-min debounced watching)');
  console.log('  • AI enhancement with OpenAI integration');
  console.log('  • Cloud features for GitHub repository analysis');
  console.log('');
  console.log('🔧 Configuration:');
  console.log('  Required:');
  console.log('  • WORKSPACE_FOLDER: Path to your project directory');
  console.log('');
  console.log('  Optional (for AI features):');
  console.log('  • OPENAI_API_KEY: Your OpenAI API key');
  console.log(
    '  • OPENAI_BASE_URL: Custom OpenAI API endpoint (default: https://api.openai.com/v1)'
  );
  console.log('');
  console.log('  Optional (for cloud features):');
  console.log('  • AMBIANCE_API_KEY: Your Ambiance cloud API key');
  console.log('');
  console.log('  Optional (for local embeddings):');
  console.log('  • USE_LOCAL_EMBEDDINGS: "true" to enable local embeddings (default: true)');
  console.log('  • LOCAL_EMBEDDING_MODEL: Model for local embeddings (default: all-MiniLM-L6-v2)');
  console.log('  • SKIP_OPENAI_PROBE: "true" to skip OpenAI connectivity test');
  console.log('  • SKIP_AMBIANCE_PROBE: "true" to skip Ambiance API health check');
  console.log('');
  console.log('  🤖 Embedding Behavior:');
  console.log('  • First use: Auto-generates in background (non-blocking)');
  console.log('  • File changes: Auto-updates via 3-minute debounced watching');
  console.log('  • Manual control: Use manage_embeddings tool for workspace setup');
  console.log('');
  console.log('📦 Package Information:');
  console.log(`  Version: ${packageJson.version}`);
  console.log(`  License: ${packageJson.license}`);
  console.log(`  Repository: ${packageJson.repository.url}`);
  console.log('');
  console.log('Usage:');
  console.log('  ambiance-mcp [options]');
  console.log('  ambiance-mcp <tool> [tool-options] [global-options]');
  console.log('');
  console.log('Options:');
  console.log('  --help, -h          Show this help message');
  console.log('  --expanded, -E      Include environment variable defaults in help output');
  console.log('  --env-help          Shortcut for --help --expanded');
  console.log('  --version, -v       Show version information');
  console.log('  --server, -s        Start MCP server (default mode)');
  console.log('');
  console.log('Tools:');
  console.log('  context             Semantic code compaction and context generation');
  console.log('  hints               Project structure analysis and navigation hints');
  console.log('  summary             Individual file analysis and symbol extraction');
  console.log('  frontend            Frontend code pattern analysis');
  console.log('  debug               Debug context analysis from error logs');
  console.log('  grep                AST-based structural code search');
  console.log(
    '  embeddings          Embedding management and workspace configuration (status, create, update, recent_files, check_stale, find_duplicates, cleanup_duplicates)'
  );
  console.log(
    '                      find_duplicates: Find files with multiple embedding generations (stale data)'
  );
  console.log(
    '                      cleanup_duplicates: Remove old embedding generations, keep only latest'
  );
  console.log('');
  console.log('Indexing Tools (CLI-only):');
  console.log('  ambiance_auto_detect_index    Auto-detect and index current project');
  console.log('  ambiance_index_project        Index a specific project path');
  console.log('  ambiance_reset_indexes        Reset/delete project indexes');
  console.log('  ambiance_start_watching       Start file watching for changes');
  console.log('  ambiance_stop_watching        Stop file watching');
  console.log('  ambiance_get_indexing_status  Get indexing session status');
  console.log('');
  console.log('Global Options:');
  console.log('  --project-path <path>  Project directory path');
  console.log('  --format <format>      Output format (json, structured, compact)');
  console.log('  --output <file>        Write output to file');
  console.log('  --verbose, -v          Enable verbose output');
  console.log('');
  console.log('Tool-Specific Options:');
  console.log('  context:');
  console.log('    --query <text>       Query for semantic analysis');
  console.log('    --task-type <type>   Analysis type (understand, debug, trace, spec, test)');
  console.log('    --max-tokens <num>   Maximum tokens in output (default: 3000)');
  console.log('    --max-similar-chunks <num>  Max similar code chunks to include (default: 20)');
  console.log('    --exclude-patterns <patterns>  Patterns to exclude (e.g., "*.md,docs/**")');
  console.log('');
  console.log('  hints:');
  console.log('    --max-files <num>    Maximum files to analyze (default: 100)');
  console.log('    --folder-path <path> Specific folder to analyze');
  console.log('    --include-content    Include detailed file content analysis');
  console.log('    --use-ai             Enable AI-powered insights (requires OPENAI_API_KEY)');
  console.log('    --exclude-patterns <patterns>  Patterns to exclude (e.g., "*.test.js,docs/**")');
  console.log('');
  console.log('  summary:');
  console.log('    --include-symbols    Include detailed symbol information');
  console.log('    --max-symbols <num>  Maximum symbols to return (default: 20)');
  console.log('');
  console.log('  frontend:');
  console.log('    --include-content    Include detailed file content analysis');
  console.log('    --subtree <path>     Frontend directory to analyze (default: web/app)');
  console.log('    --max-files <num>    Maximum files to analyze (default: 2000)');
  console.log('');
  console.log('  debug:');
  console.log('    --max-matches <num>  Maximum matches to return (default: 20)');
  console.log('');
  console.log('  grep:');
  console.log('    --language <lang>    Programming language (auto-detected if not provided)');
  console.log('    --output-mode <mode> Output mode (content, files_with_matches, count)');
  console.log('');
  console.log('  embeddings:');
  console.log('    --auto-generate      Auto-generate embeddings after workspace setup');
  console.log('    --auto-fix           Automatically attempt repairs during operations');
  console.log('    --batch-size <num>   Files to process per batch (default: 10)');
  console.log('    --files <files>      Specific files to update (for update action)');
  console.log(
    '    --limit <num>        Maximum files to return (for recent_files action, default: 20)'
  );
  console.log('    --auto-update        Automatically update stale files (for check_stale action)');
  console.log('');
  console.log('Examples:');
  console.log('  # Semantic code compaction with custom options');
  console.log(
    '  ambiance-mcp context --query "How does authentication work?" --max-tokens 2000 --task-type understand'
  );
  console.log('');
  console.log('  # Project analysis with JSON output and AI insights');
  console.log(
    '  ambiance-mcp hints --format json --project-path /path/to/project --use-ai true --max-files 1000'
  );
  console.log('');
  console.log('  # File analysis with symbols and structured output');
  console.log(
    '  ambiance-mcp summary src/index.ts --include-symbols true --max-symbols 50 --format structured'
  );
  console.log('');
  console.log('  # Frontend pattern analysis for specific directory');
  console.log(
    '  ambiance-mcp frontend --include-content true --subtree src/components --max-files 500'
  );
  console.log('');
  console.log('  # Debug context analysis from error logs');
  console.log(
    '  ambiance-mcp debug "TypeError: Cannot read property \'map\' of undefined" --max-matches 10'
  );
  console.log('');
  console.log('  # AST-based structural code search');
  console.log(
    '  ambiance-mcp grep "function $NAME($ARGS)" --language typescript --output-mode content'
  );
  console.log('');
  console.log('  # Embedding management and status monitoring');
  console.log('  ambiance-mcp embeddings status --project-path /my/workspace');
  console.log('  ambiance-mcp embeddings create --project-path /my/workspace --auto-fix true');
  console.log(
    '  ambiance-mcp embeddings update --project-path /my/workspace --files "src/index.ts"'
  );
  console.log('  ambiance-mcp embeddings recent_files --project-path /my/workspace --limit 10');
  console.log(
    '  ambiance-mcp embeddings check_stale --project-path /my/workspace --auto-update true'
  );
  console.log('  ambiance-mcp embeddings find_duplicates --project-path /my/workspace');
  console.log('  ambiance-mcp embeddings cleanup_duplicates --project-path /my/workspace');
  console.log('');
  console.log('  # Manual project indexing (CLI-only tools)');
  console.log('  ambiance-mcp ambiance_start_watching --path /my/project');
  console.log('  ambiance-mcp ambiance_auto_detect_index');
  console.log('  ambiance-mcp ambiance_get_indexing_status');
  console.log('');
  console.log('  # Save output to file with verbose logging');
  console.log('  ambiance-mcp hints --format json --output project-analysis.json --verbose');
  console.log('');
  console.log('For detailed setup instructions, visit:');
  console.log('https://github.com/sbarron/AmbianceMCP#readme');
  console.log('');

  if (expanded) {
    console.log('Environment configuration details:');
    console.log('');
    showEnvironmentHelp();
  } else {
    console.log('Tip: Run `ambiance-mcp --help --expanded` to see environment defaults.');
    console.log('');
  }
}

function showEnvironmentHelp(): void {
  console.log('Environment Variables');
  console.log('---------------------');
  console.log('Defaults apply when a variable is unset.');
  console.log('');

  for (const category of ENVIRONMENT_VARIABLES) {
    console.log(`${category.title}:`);
    if (category.summary) {
      console.log(`  ${category.summary}`);
    }
    for (const envVar of category.vars) {
      console.log(`  - ${envVar.name}`);
      console.log(`      Default: ${envVar.defaultValue}`);
      console.log(`      ${envVar.description}`);
    }
    console.log('');
  }
}

/**
 * Display version information
 */
function showVersion(): void {
  console.log(`Ambiance MCP Server v${packageJson.version}`);
}

/**
 * Start the MCP server
 */
async function startServer(): Promise<void> {
  try {
    // Import the MCP server dynamically to avoid loading it when just showing help
    const { AmbianceMCPServer } = await import('./index.js');
    const server = new AmbianceMCPServer();
    await server.start();
    // Keep the server running (this won't return until interrupted)
  } catch (error) {
    console.error(
      '❌ Failed to start MCP server:',
      error instanceof Error ? error.message : String(error)
    );
    process.exit(1);
  }
}
// Tool execution functions
async function executeToolCommand(
  command: string,
  toolArgs: string[],
  globalOptions: GlobalOptions
): Promise<void> {
  try {
    let result: unknown;

    switch (command) {
      case 'context':
        result = await handleSemanticCompact({
          query: toolArgs.find(arg => !arg.startsWith('--')) || 'Analyze this project',
          projectPath: globalOptions.projectPath || detectProjectPath(),
          format: globalOptions.format || 'structured',
          ...parseToolSpecificArgs(toolArgs, [
            'query',
            'taskType',
            'maxTokens',
            'maxSimilarChunks',
            'excludePatterns',
          ]),
        });
        break;

      case 'hints':
        result = await handleProjectHints({
          projectPath: globalOptions.projectPath || detectProjectPath(),
          format: globalOptions.format || 'compact',
          ...parseToolSpecificArgs(toolArgs, [
            'maxFiles',
            'folderPath',
            'includeContent',
            'useAI',
            'excludePatterns',
          ]),
        });
        break;

      case 'summary': {
        const filePath = toolArgs.find(arg => !arg.startsWith('--'));
        if (!filePath) {
          console.error('Error: filePath is required for summary command');
          process.exit(1);
        }
        result = await handleFileSummary({
          filePath,
          format: globalOptions.format || 'structured',
          ...parseToolSpecificArgs(toolArgs, ['includeSymbols', 'maxSymbols']),
        });
        break;
      }

      case 'frontend':
        result = await handleFrontendInsights({
          projectPath: globalOptions.projectPath || detectProjectPath(),
          format: globalOptions.format || 'structured',
          ...parseToolSpecificArgs(toolArgs, ['includeContent', 'subtree', 'maxFiles']),
        });
        break;

      case 'debug': {
        const logText = toolArgs.find(arg => !arg.startsWith('--'));
        if (!logText) {
          console.error('Error: logText is required for debug command');
          process.exit(1);
        }
        result = await handleLocalDebugContext({
          logText,
          projectPath: globalOptions.projectPath || detectProjectPath(),
          format: globalOptions.format || 'structured',
          ...parseToolSpecificArgs(toolArgs, ['maxMatches']),
        });
        break;
      }

      case 'grep': {
        const pattern = toolArgs.find(arg => !arg.startsWith('--'));
        if (!pattern) {
          console.error('Error: pattern is required for grep command');
          process.exit(1);
        }
        result = await handleAstGrep({
          pattern,
          projectPath: globalOptions.projectPath || detectProjectPath(),
          ...parseToolSpecificArgs(toolArgs, ['language', 'outputMode']),
        });
        break;
      }

      case 'compare': {
        const parsed = parseToolSpecificArgs(toolArgs, [
          'prompt',
          'models',
          'system',
          'temperature',
          'maxTokens',
        ]);

        const positionalArgs: string[] = [];
        for (let i = 0; i < toolArgs.length; i++) {
          const arg = toolArgs[i];
          if (arg.startsWith('--')) {
            if (i + 1 < toolArgs.length && !toolArgs[i + 1].startsWith('--')) {
              i += 1; // Skip the value paired with this flag
            }
            continue;
          }
          positionalArgs.push(arg);
        }

        const promptCandidate =
          (typeof parsed.prompt === 'string' && parsed.prompt.length > 0
            ? parsed.prompt
            : undefined) || positionalArgs[positionalArgs.length - 1];

        if (!promptCandidate) {
          console.error('Error: prompt is required for compare command');
          process.exit(1);
        }

        let modelsInput: string | undefined;
        if (typeof parsed.models === 'string') {
          modelsInput = parsed.models;
        } else if (Array.isArray(parsed.models)) {
          modelsInput = parsed.models.join(',');
        } else if (parsed.models === true) {
          modelsInput = '';
        }

        const envModels = process.env.AI_COMPARE_MODELS?.trim();
        if (!modelsInput || modelsInput.trim().length === 0) {
          modelsInput =
            (envModels && envModels.length > 0 ? envModels : DEFAULT_COMPARE_MODELS) ?? '';
        }

        let modelSpecs: ModelTargetSpec[];
        try {
          modelSpecs = parseModelSpecsInput(modelsInput);
        } catch (parseError) {
          console.error(
            'Error parsing models:',
            parseError instanceof Error ? parseError.message : String(parseError)
          );
          process.exit(1);
        }

        if (modelSpecs.length === 0) {
          console.error('Error: at least one model must be provided (e.g. openai:gpt-5)');
          process.exit(1);
        }

        const { runMultiModelComparison, formatComparisonResultMarkdown } = await import(
          './tools/aiTools/multiModelCompare'
        );

        const comparison = await runMultiModelComparison({
          prompt: promptCandidate,
          systemPrompt: typeof parsed.system === 'string' ? parsed.system : undefined,
          temperature: typeof parsed.temperature === 'number' ? parsed.temperature : undefined,
          maxTokens: typeof parsed.maxTokens === 'number' ? parsed.maxTokens : undefined,
          models: modelSpecs,
        });

        if (globalOptions.format === 'json') {
          result = comparison;
        } else {
          result = formatComparisonResultMarkdown(comparison);
        }

        break;
      }

      case 'embeddings': {
        const action = toolArgs.find(arg => !arg.startsWith('--')) || 'status';
        let projectIdentifier: string | undefined;

        // Extract projectIdentifier for actions that need it as a positional argument
        if (action === 'project_details' || action === 'delete_project') {
          const actionIndex = toolArgs.indexOf(action);
          if (
            actionIndex !== -1 &&
            actionIndex + 1 < toolArgs.length &&
            !toolArgs[actionIndex + 1].startsWith('--')
          ) {
            projectIdentifier = toolArgs[actionIndex + 1];
            toolArgs.splice(actionIndex + 1, 1); // Remove the positional argument from toolArgs
          }
        }

        // Special handling for create action - require confirmation
        if (action === 'create') {
          const projectPath = globalOptions.projectPath || process.cwd();

          // Wait a moment for initialization messages to complete, then show clear confirmation
          await new Promise(resolve => setTimeout(resolve, 100));

          // Get project file count for better time estimation
          let fileCount = 'unknown';
          let estimatedTime = '2-10 minutes';
          try {
            const { globby } = await import('globby');

            const files = await globby(
              [
                '**/*.{ts,tsx,js,jsx,py,go,rs,java,cpp,c,h,hpp,cs,rb,php,swift,kt,scala,clj,hs,ml,r,sql,sh,bash,zsh,md}',
              ],
              {
                cwd: projectPath,
                ignore: ['node_modules/**', 'dist/**', 'build/**', '.git/**'],
                onlyFiles: true,
              }
            );

            fileCount = files.length.toString();
            estimatedTime = estimateEmbeddingTime(files.length);
          } catch {
            // Use default estimate if file counting fails
            estimatedTime = '2-10 minutes';
          }

          console.log('\n' + '='.repeat(70));
          console.log('🚨 EMBEDDING CREATION CONFIRMATION');
          console.log('='.repeat(70));
          console.log(`📁 Project: ${projectPath}`);
          console.log(`📊 Files to Process: ${fileCount} code files`);
          console.log('🔧 Action: Create/Regenerate embeddings for the entire project');
          console.log(`⏱️  Estimated Time: ${estimatedTime}`);
          console.log('💾 Storage: Embeddings will be stored locally in ~/.ambiance/');
          console.log('🔄 Process: Will analyze all code files and generate vector embeddings');
          console.log('📈 Progress: Can be monitored with "ambiance-mcp embeddings status"');
          console.log('='.repeat(70));
          console.log('⚠️  This operation cannot be easily undone.');
          console.log('');

          // Enhanced confirmation prompt with better UX
          const readline = require('readline');
          const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
          });

          const confirmation = await new Promise<string>(resolve => {
            rl.question('❓ Do you want to continue? (y/N): ', (answer: string) => {
              rl.close();
              resolve(answer.toLowerCase().trim());
            });
          });

          console.log(''); // Add spacing

          if (!['y', 'yes'].includes(confirmation)) {
            console.log('✅ Embedding creation cancelled by user.');
            process.exit(0);
          }

          console.log(
            `🚀 Starting embedding creation process (${fileCount} files, ~${estimatedTime})...\n`
          );
        }

        const parsedArgs = parseToolSpecificArgs(toolArgs, [
          'autoGenerate',
          'autoFix',
          'batchSize',
          'projectIdentifier',
          'excludePatterns',
          'maxFiles',
          'allowHiddenFolders',
          'confirmDeletion',
          'includeStats',
          'checkIntegrity',
          'force',
          'maxFixTime',
          'format',
          'files',
          'limit',
          'autoUpdate',
        ]);

        // Merge global options if not already parsed
        const mergedArgs: ToolArgMap = { ...parsedArgs };
        if (
          mergedArgs.excludePatterns === undefined &&
          globalOptions.excludePatterns !== undefined
        ) {
          mergedArgs.excludePatterns = globalOptions.excludePatterns;
        }

        // Special handling for check_stale - show project path and confirm if autoUpdate
        if (action === 'check_stale') {
          const projectPath = globalOptions.projectPath || detectProjectPath();

          // Always show which project is being checked
          console.log(`\n🔍 Checking stale files in: ${projectPath}`);

          // Require confirmation for autoUpdate
          if (parsedArgs.autoUpdate) {
            console.log('\n' + '='.repeat(70));
            console.log('🔄 STALE FILE AUTO-UPDATE CONFIRMATION');
            console.log('='.repeat(70));
            console.log(`📁 Project: ${projectPath}`);
            console.log('🔍 Action: Check for stale files and auto-update embeddings');
            console.log('💡 Process: Will update embeddings for files modified since last index');
            console.log('💾 Storage: Updated embeddings stored in ~/.ambiance/');
            console.log('='.repeat(70));
            console.log('');

            const readline = require('readline');
            const rl = readline.createInterface({
              input: process.stdin,
              output: process.stdout,
            });

            const confirmation = await new Promise<string>(resolve => {
              rl.question('❓ Continue with auto-update? (y/N): ', (answer: string) => {
                rl.close();
                resolve(answer.toLowerCase().trim());
              });
            });

            console.log('');

            if (!['y', 'yes'].includes(confirmation)) {
              console.log('✅ Auto-update cancelled by user.');
              // Run check without auto-update
              mergedArgs.autoUpdate = false;
            }
          }
        }

        result = await handleManageEmbeddings({
          action,
          projectPath: globalOptions.projectPath || detectProjectPath(),
          projectIdentifier,
          ...mergedArgs,
        });
        break;
      }

      case 'ambiance_auto_detect_index':
      case 'ambiance_index_project':
      case 'ambiance_reset_indexes':
      case 'ambiance_start_watching':
      case 'ambiance_stop_watching':
      case 'ambiance_get_indexing_status': {
        // Handle ambiance tools
        const { ambianceHandlers } = await import('./tools/ambianceTools');
        const handler = ambianceHandlers[command];
        if (!handler) {
          console.error(`Handler not found for ambiance tool: ${command}`);
          process.exit(1);
        }

        result = await handler({
          path: globalOptions.projectPath || detectProjectPath(),
          ...parseToolSpecificArgs(toolArgs, ['path', 'force', 'skipCloud', 'pattern']),
        });
        break;
      }

      default:
        console.error(`Unknown tool command: ${command}`);
        process.exit(1);
    }

    // Handle output
    const output = formatToolOutput(result, globalOptions);
    if (globalOptions.output) {
      require('fs').writeFileSync(globalOptions.output, output);
      console.log(`Output written to ${globalOptions.output}`);
    } else {
      console.log(output);
    }
  } catch (error) {
    console.error(
      `Error executing ${command} command:`,
      error instanceof Error ? error.message : String(error)
    );
    process.exit(1);
  }
}

const MODEL_PROVIDER_ALIASES: Record<string, ProviderType> = {
  openai: 'openai',
  default: 'openai',
  qwen: 'qwen',
  aliyun: 'qwen',
  azure: 'azure',
  anthropic: 'anthropic',
  claude: 'anthropic',
  together: 'together',
  openrouter: 'openrouter',
  router: 'openrouter',
  xai: 'grok',
  grok: 'grok',
  groq: 'groq',
  custom: 'custom',
};

const DEFAULT_COMPARE_MODELS = 'openai:gpt-5,openai:gpt-4o';

function parseModelSpecsInput(input: string): ModelTargetSpec[] {
  return input
    .split(',')
    .map(spec => spec.trim())
    .filter(spec => spec.length > 0)
    .map(parseSingleModelSpec);
}

function parseSingleModelSpec(rawSpec: string): ModelTargetSpec {
  let working = rawSpec;
  let label: string | undefined;

  const labelIndex = working.indexOf('=');
  if (labelIndex !== -1) {
    label = working.slice(labelIndex + 1).trim();
    working = working.slice(0, labelIndex);
  }

  let providerToken: string | undefined;
  let modelToken: string;
  let baseUrl: string | undefined;

  const colonIndex = working.indexOf(':');
  if (colonIndex !== -1) {
    providerToken = working.slice(0, colonIndex).trim();
    modelToken = working.slice(colonIndex + 1).trim();
  } else {
    modelToken = working.trim();
  }

  if (!modelToken) {
    throw new Error(`Invalid model specification: "${rawSpec}"`);
  }

  if (providerToken) {
    const atIndex = providerToken.indexOf('@');
    if (atIndex !== -1) {
      baseUrl = providerToken.slice(atIndex + 1).trim();
      providerToken = providerToken.slice(0, atIndex).trim();
    }
  }

  const providerAlias = providerToken ? providerToken.toLowerCase() : undefined;
  const provider: ProviderType =
    (providerAlias && MODEL_PROVIDER_ALIASES[providerAlias]) || 'openai';

  if (providerAlias && !MODEL_PROVIDER_ALIASES[providerAlias]) {
    throw new Error(`Unknown provider alias "${providerToken}" in "${rawSpec}"`);
  }

  return {
    provider,
    model: modelToken,
    label: label || `${provider}:${modelToken}`,
    baseUrl,
  };
}

function parseToolSpecificArgs(args: string[], allowedKeys: string[]): ToolArgMap {
  const parsed: ToolArgMap = {};
  const arrayKeys = new Set(['excludepatterns', 'files']); // Keys parsed as arrays (after normalization)

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.replace('--', '').replace(/-/g, '').toLowerCase();
      const matchedKey = allowedKeys.find(
        allowed => allowed.replace(/-/g, '').toLowerCase() === key
      );
      if (matchedKey) {
        if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
          const value = args[++i];
          // Handle array parameters (comma-separated)
          if (arrayKeys.has(key)) {
            parsed[matchedKey] = value
              .split(',')
              .map(s => s.trim())
              .filter(s => s.length > 0);
          }
          // Try to parse as number or boolean
          else if (value === 'true') parsed[matchedKey] = true;
          else if (value === 'false') parsed[matchedKey] = false;
          else if (!Number.isNaN(Number(value))) parsed[matchedKey] = Number(value);
          else parsed[matchedKey] = value;
        } else {
          parsed[matchedKey] = true;
        }
      }
    }
  }

  return parsed;
}

function formatToolOutput(result: unknown, options: GlobalOptions): string {
  if (options.format === 'json') {
    return JSON.stringify(result ?? null, null, 2);
  }

  if (typeof result === 'string') {
    return result;
  }

  if (typeof result === 'object' && result !== null) {
    const typedResult = result as ToolResultObject;
    if (typedResult.success) {
      if (typeof typedResult.content === 'string') {
        return typedResult.content;
      }
      if (typeof typedResult.summary === 'string') {
        return typedResult.summary;
      }
    }

    return JSON.stringify(typedResult, null, 2);
  }

  if (result === undefined || result === null) {
    return '';
  }

  return String(result);
}

// Main CLI logic
async function main() {
  if (isHelp) {
    showHelp({ expanded: wantsExpandedHelp });
    process.exit(0);
  } else if (isVersion) {
    showVersion();
    process.exit(0);
  } else if (isMcpServerMode) {
    // Start MCP server - this will run indefinitely until interrupted
    await startServer();
  } else if (isToolCommand && remaining.length > 0) {
    // Execute tool command
    const command = remaining[0];
    const toolArgs = remaining.slice(1);
    await executeToolCommand(command, toolArgs, globalOptions);
  } else {
    // Fallback to help for unrecognized arguments
    console.log('Unrecognized arguments. Use --help for usage information.\n');
    showHelp();
    process.exit(1);
  }
}

// Run main function
main().catch(error => {
  console.error('CLI Error:', error);
  process.exit(1);
});
