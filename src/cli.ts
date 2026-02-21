#!/usr/bin/env node

/**
 * Ambiance CLI
 *
 * CLI-first local code context and analysis.
 * MCP server mode is not supported in this entrypoint (compatibility is handled elsewhere).
 */

import type { ProviderType } from './core/openaiService';
import type { ModelTargetSpec } from './tools/aiTools/multiModelCompare';
import type { ManageEmbeddingsAction } from './tools/localTools/embeddingManagement';

import * as fs from 'fs';
import * as path from 'path';

function loadPackageJson(): any {
  const candidates = [
    path.resolve(__dirname, '..', '..', 'package.json'),
    path.resolve(__dirname, '..', 'package.json'),
  ];

  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {
      // try next
    }
  }

  return { version: 'unknown', license: 'unknown', repository: { url: 'unknown' } };
}

const packageJson = loadPackageJson();

/**
 * Detect the appropriate project path for CLI operations
 */
function detectProjectPath(): string {
  // First check if WORKSPACE_FOLDER is set
  if (process.env.WORKSPACE_FOLDER) {
    return process.env.WORKSPACE_FOLDER;
  }

  // Use intelligent workspace detection
  // Lazy-load to avoid heavy import-time side effects for --help/--version
  const { detectWorkspaceDirectory } = require('./tools/utils/pathUtils');
  const detected = detectWorkspaceDirectory();
  if (detected && detected !== process.cwd()) {
    if (process.env.AMBIANCE_QUIET !== 'true') {
      console.error(`Auto-detected project directory: ${detected}`);
    }
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

type OptionValue = string | number | boolean | string[] | undefined;

interface GlobalOptions {
  projectPath?: string;
  format?: string;
  json?: boolean;
  output?: string;
  excludePatterns?: string[];
  help?: boolean;
  verbose?: boolean;
  quiet?: boolean;
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
    summary: 'Local embedding engine with automatic generation and staleness checking.',
    vars: [
      {
        name: 'USE_LOCAL_EMBEDDINGS',
        defaultValue: 'true',
        description: 'Enables local embeddings (auto-generated on first tool use).',
      },
      {
        name: 'EMBEDDING_AUTO_SYNC',
        defaultValue: 'true (when USE_LOCAL_EMBEDDINGS=true)',
        description: 'Automatically check and update stale embeddings on context calls.',
      },
      {
        name: 'EMBEDDING_AUTO_SYNC_THRESHOLD_MS',
        defaultValue: '600000 (10 minutes)',
        description: 'Time threshold (ms) before embeddings are considered stale.',
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

const EXIT_CODES = {
  OK: 0,
  RUNTIME_ERROR: 1,
  USAGE_ERROR: 2,
} as const;

// Global options
const wantsExpandedHelp =
  args.includes('--expanded') || args.includes('--env-help') || args.includes('-E');
const isHelp = args.includes('--help') || args.includes('-h');
const isVersion = args.includes('--version') || args.includes('-V') || args.includes('version');
const requestedServer = args.includes('--server') || args.includes('-s');

// Tool commands
const commands = [
  'context',
  'hints',
  'summary',
  'manifest',
  'frontend',
  'debug',
  'grep',
  'compare',
  'doctor',
  'skill',
  'migrate',
  'packs',
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
    if (arg === '-v') {
      options.verbose = true;
      continue;
    }
    if (arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '-E') {
      options.expanded = true;
      continue;
    }

    if (arg.startsWith('--')) {
      if (arg === '--project-path' && i + 1 < args.length) {
        options.projectPath = args[++i];
      } else if (arg === '--format' && i + 1 < args.length) {
        options.format = args[++i];
      } else if (arg === '--json') {
        options.json = true;
      } else if (arg === '--output' && i + 1 < args.length) {
        options.output = args[++i];
      } else if (arg === '--embeddings') {
        options.useEmbeddings = true;
      } else if (arg === '--no-embeddings') {
        options.useEmbeddings = false;
      } else if (arg === '--exclude-patterns' && i + 1 < args.length) {
        options.excludePatterns = args[++i]
          .split(',')
          .map(s => s.trim())
          .filter(s => s.length > 0);
      } else if (arg === '--exclude' && i + 1 < args.length) {
        options.excludePatterns = args[++i]
          .split(',')
          .map(s => s.trim())
          .filter(s => s.length > 0);
      } else if (arg === '--help' || arg === '-h') {
        options.help = true;
      } else if (arg === '--quiet') {
        options.quiet = true;
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

function isJsonMode(options: GlobalOptions): boolean {
  return (
    options.json === true ||
    (typeof options.format === 'string' && options.format.toLowerCase() === 'json')
  );
}

function resolveToolFormat(options: GlobalOptions, fallback: string): string {
  if (typeof options.format !== 'string') {
    return fallback;
  }

  if (options.format.toLowerCase() === 'json') {
    return fallback;
  }

  return options.format;
}

// Strict JSON/quiet mode: keep stdout/stderr clean for machine parsing.
if (isJsonMode(globalOptions) || globalOptions.quiet) {
  process.env.LOG_LEVEL = 'silent';
  process.env.AMBIANCE_QUIET = 'true';
}

if (typeof globalOptions.useEmbeddings === 'boolean') {
  process.env.USE_LOCAL_EMBEDDINGS = globalOptions.useEmbeddings ? 'true' : 'false';
}

function exitWithError(args: {
  command?: string;
  message: string;
  options: GlobalOptions;
  exitCode: number;
}): never {
  const { command, message, options, exitCode } = args;

  if (isJsonMode(options)) {
    console.log(
      JSON.stringify(
        {
          success: false,
          command,
          error: message,
          exitCode,
        },
        null,
        2
      )
    );
  } else {
    console.error(message);
  }

  process.exit(exitCode);
}

/**
 * Display help information
 */
function showHelp(options: { expanded?: boolean } = {}): void {
  const expanded = options.expanded === true;
  console.log('Ambiance CLI');
  console.log('===========');
  console.log('');
  console.log('Local code context and analysis (CLI-first).');
  console.log('');
  console.log('Usage:');
  console.log('  ambiance [options] <command> [command-options]');
  console.log('');
  console.log('Options:');
  console.log('  --help, -h             Show this help message');
  console.log('  --expanded, -E         Include environment variable defaults in help output');
  console.log('  --env-help             Shortcut for --help --expanded');
  console.log('  --version, -V          Show version information');
  console.log('  --quiet                Suppress non-essential stderr logging');
  console.log('');
  console.log('Commands:');
  console.log('  context                Semantic code compaction and context generation');
  console.log('  hints                  Project structure analysis and navigation hints');
  console.log('  summary                Individual file analysis and symbol extraction');
  console.log('  manifest               Project-wide function/method listing for navigation');
  console.log('  frontend               Frontend code pattern analysis');
  console.log('  debug                  Debug context analysis from error logs');
  console.log('  grep                   AST-based structural code search');
  console.log('  compare                Multi-model response comparison');
  console.log(
    '  packs                  Context pack workflows (create/list/get/delete/template/ui)'
  );
  console.log('  embeddings             Embedding management and workspace configuration');
  console.log('  doctor                 Environment/readiness diagnostics');
  console.log('  skill                  Agent skill helpers (verify/list/workflow/recipe)');
  console.log('  migrate                Migration helpers (MCP -> CLI)');
  console.log('');
  console.log('Global Options:');
  console.log('  --project-path <path>  Project directory path');
  console.log(
    '  --format <format>      Command format where supported (e.g. enhanced, structured, compact)'
  );
  console.log('  --json                 Output machine-readable JSON envelope');
  console.log('  --output <file>        Write output to file');
  console.log('  --exclude-patterns <a,b,c>  Additional glob exclusions for supporting commands');
  console.log('  --exclude <a,b,c>      Alias for --exclude-patterns');
  console.log('  --embeddings           Force USE_LOCAL_EMBEDDINGS=true for this run');
  console.log('  --no-embeddings        Force USE_LOCAL_EMBEDDINGS=false for this run');
  console.log('  --verbose, -v          Enable verbose output');
  console.log('  --quiet                Suppress non-essential stderr logging');
  console.log('');
  console.log('Examples:');
  console.log('  ambiance context --query "How does authentication work?" --max-tokens 2000');
  console.log('  ambiance hints --json --project-path /path/to/project --max-files 200');
  console.log('  ambiance packs create --name "arch" --query "Architecture overview" --json');
  console.log('  ambiance doctor --json');
  console.log('  ambiance skill verify --json');
  console.log('  ambiance migrate mcp-map --json');
  console.log('');
  console.log('Package:');
  console.log(`  Version: ${packageJson.version}`);
  console.log(`  License: ${packageJson.license}`);
  console.log(`  Repository: ${packageJson.repository.url}`);
  const baseSkillDir = findSkillBaseDirForCli();
  if (baseSkillDir) {
    console.log(`  Skill location: ${baseSkillDir}`);
  }
  console.log('');

  if (expanded) {
    console.log('Environment configuration details:');
    console.log('');
    showEnvironmentHelp();
  } else {
    console.log('Tip: Run `ambiance --help --expanded` to see environment defaults.');
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
  console.log(`Ambiance CLI v${packageJson.version}`);
}

function showCommandHelp(command: string): void {
  const common = [
    'Common flags:',
    '  --json                 Output machine-readable JSON envelope',
    '  --project-path <path>  Explicit project path (recommended)',
    '  --format <format>      Command format where supported',
    '  --exclude-patterns <a,b,c>  Additional path exclusions',
    '  --exclude <a,b,c>      Alias for --exclude-patterns',
  ];

  const blocks: Record<string, string[]> = {
    context: [
      'ambiance context',
      '---------------',
      'Generate semantic project context for a query.',
      '',
      'Usage:',
      '  ambiance context "<query>" [--json] [--project-path <path>] [--max-tokens <n>] [--task-type <type>] [--auto-sync]',
      '',
      ...common,
      '  --max-tokens <n>       Token budget for context assembly',
      '  --task-type <type>     Context focus (implement | review | understand)',
      '  --max-similar-chunks <n>',
      '  --auto-sync            Check/update stale embeddings before generating context',
      '  --auto-sync-batch-size <n>',
      '  --exclude-patterns a,b,c',
      '',
      'Examples:',
      '  ambiance context "authentication flow" --json --project-path ./ --max-tokens 2400',
      '  ambiance context "auth middleware" --json --project-path ./ --auto-sync',
      '  ambiance context --query "request lifecycle" --json --task-type review',
    ],
    hints: [
      'ambiance hints',
      '-------------',
      'Analyze project structure and return navigation hints.',
      '',
      'Usage:',
      '  ambiance hints [--json] [--project-path <path>] [--max-files <n>] [--folder-path <path>]',
      '',
      ...common,
      '  --max-files <n>        Maximum files to inspect',
      '  --folder-path <path>   Restrict analysis to a folder',
      '  --include-content <bool>',
      '  --use-ai <bool>',
    ],
    summary: [
      'ambiance summary',
      '---------------',
      'Summarize one file with AST-aware symbol extraction.',
      '',
      'Usage:',
      '  ambiance summary <filePath> [--json] [--include-symbols <bool>] [--max-symbols <n>]',
      '',
      ...common,
      '  --include-symbols <bool>',
      '  --max-symbols <n>',
    ],
    manifest: [
      'ambiance manifest',
      '----------------',
      'Generate project-wide function/method listing for navigation and orientation.',
      '',
      'Usage:',
      '  ambiance manifest [--json] [--project-path <path>] [options]',
      '',
      ...common,
      '  --file-pattern <glob>      Filter files by glob pattern',
      '  --exports-only             Show only exported symbols',
      '  --include-types            Include type definitions (default: true)',
      '  --include-classes          Include class definitions (default: true)',
      '  --include-interfaces       Include interface definitions (default: true)',
      '  --max-files <n>            Maximum files to process (default: 200)',
      '  --group-by-folder          Group files by folder',
      '  --sort-by <field>          Sort symbols (name|line|kind|file)',
      '  --include-lines            Show line numbers',
      '',
      'Format options:',
      '  compact (default)          File with indented function list',
      '  tree                       Grouped by symbol kind',
      '  flat                       One line per symbol (grep-friendly)',
      '  json                       Machine-readable JSON',
      '',
      'Examples:',
      '  ambiance manifest --json --project-path ./',
      '  ambiance manifest --exports-only --format flat',
      '  ambiance manifest --file-pattern "src/**/*.ts" --include-lines',
    ],
    debug: [
      'ambiance debug',
      '-------------',
      'Parse error logs and surface likely files/symbol matches.',
      '',
      'Usage:',
      '  ambiance debug "<logText>" [--json] [--project-path <path>] [--max-matches <n>]',
      '',
      ...common,
      '  --max-matches <n>',
    ],
    grep: [
      'ambiance grep',
      '------------',
      'AST structural code search.',
      '',
      'Usage:',
      '  ambiance grep "<pattern>" [--json] [--project-path <path>] [--language <lang>]',
      '  ambiance grep --rule-path <file> [--json] [--project-path <path>] [--language <lang>]',
      '',
      ...common,
      '  --language <lang>      typescript | javascript | python | ...',
      '  --file-pattern <glob>  Narrow search scope (recommended while iterating patterns)',
      '  --max-matches <n>      Limit returned matches (default: 100)',
      '  --rule-path <file>     Use an ast-grep rule file instead of --pattern',
      '  --rule-yaml <yaml>     Inline ast-grep rule (YAML/JSON text)',
      '  --rule-json <json>     Inline ast-grep rule object as JSON string',
      '  --include-context <bool>',
      '  --context-lines <n>',
      '  --output-mode <mode>',
      '',
      'Pattern examples:',
      '  function $NAME($ARGS) { $BODY }',
      '  import $NAME from "$MODULE"',
      '  const $NAME = ($ARGS) => $BODY',
      '  def ',
      '  class $NAME:',
      '',
      'Common pattern mistakes:',
      '  Do not use regex: /foo.*/, a|b, .*',
      '  Do not use overly-ambiguous fragments: function $FUNC',
      '',
      'PowerShell tip:',
      "  Use single quotes to prevent $ expansion, e.g. 'function $NAME($ARGS) { $BODY }'",
    ],
    frontend: [
      'ambiance frontend',
      '----------------',
      'Analyze frontend routes, components, and design/system risks.',
      '',
      'Usage:',
      '  ambiance frontend [--json] [--project-path <path>] [--subtree <path>] [--max-files <n>]',
      '',
      ...common,
      '  --subtree <path>',
      '  --max-files <n>',
      '  --include-content <bool>',
    ],
    compare: [
      'ambiance compare',
      '---------------',
      'Run a prompt across multiple models/providers and compare responses.',
      '',
      'Usage:',
      '  ambiance compare --prompt "<text>" [--json] [--models "<provider:model,...>"]',
      '',
      ...common,
      '  --prompt <text>         Required',
      '  --models <specs>        e.g. "openai:gpt-5,openai:gpt-4o"',
      '  --system <text>',
      '  --temperature <n>',
      '  --max-tokens <n>',
    ],
    embeddings: [
      'ambiance embeddings',
      '------------------',
      'Workspace and embeddings lifecycle management.',
      '',
      'Usage:',
      '  ambiance embeddings <action> [--json] [--project-path <path>]',
      '',
      'Actions:',
      '  status | create | update | validate | check_stale | set_workspace | list_projects | ...',
      '',
      ...common,
      '  --force true            Required for non-interactive embeddings create in JSON mode',
      '',
      'Examples:',
      '  ambiance embeddings status --json --project-path ./',
      '  ambiance embeddings create --json --project-path ./ --force true',
    ],
    packs: [
      'ambiance packs',
      '-------------',
      'Manage reusable context packs.',
      '',
      'Usage:',
      '  ambiance packs <create|list|get|delete|template|ui> [--json]',
      '',
      ...common,
      '  create flags: --name <name> --query <query> [--task-type <type>]',
      '  get/delete: pass ID as positional arg or --id <id>',
    ],
    doctor: [
      'ambiance doctor',
      '--------------',
      'Check runtime/dependency readiness.',
      '',
      'Usage:',
      '  ambiance doctor [--json]',
    ],
    skill: [
      'ambiance skill',
      '-------------',
      'Skill metadata and workflow/recipe introspection.',
      '',
      'Usage:',
      '  ambiance skill verify [--json]',
      '  ambiance skill list [--json]',
      '  ambiance skill workflow <name> [--json]',
      '  ambiance skill recipe <name> [--json]',
      '  ambiance skill install [--target <path>] [--dry-run]',
      '',
      '  By default, install copies the skill into known AI provider directories',
      '  (e.g., ~/.claude, ~/.gemini, ~/.antigravity, ~/.codex, ~/.cursor).',
      '',
      'Examples:',
      '  ambiance skill workflow understand --json',
      '  ambiance skill recipe context --json',
      '  ambiance skill install --dry-run',
    ],
    migrate: [
      'ambiance migrate',
      '---------------',
      'MCP-to-CLI migration helpers.',
      '',
      'Usage:',
      '  ambiance migrate mcp-map [--json]',
    ],
  };

  const lines = blocks[command];
  if (!lines) {
    showHelp();
    return;
  }

  console.log(lines.join('\n'));

  const recipeBackedCommands = new Set([
    'context',
    'debug',
    'doctor',
    'embeddings',
    'frontend',
    'grep',
    'hints',
    'packs',
    'summary',
  ]);

  if (recipeBackedCommands.has(command)) {
    console.log('');
    const recipeName = command === 'embeddings' ? 'embeddings-status' : command;
    console.log(`Recipe details: ambiance skill recipe ${recipeName} --json`);
  }

  if (command === 'context' || command === 'debug' || command === 'hints') {
    console.log(
      'Workflow details: ambiance skill workflow <understand|debug|implement|review> --json'
    );
  }
}

function findSkillBaseDirForCli(): string | undefined {
  const envOverride = process.env.AMBIANCE_SKILLS_DIR?.trim();
  if (envOverride) {
    try {
      if (fs.existsSync(envOverride) && fs.statSync(envOverride).isDirectory()) {
        return envOverride;
      }
    } catch {
      // ignore and continue
    }
  }

  const candidates = [
    path.resolve(__dirname, '..', '..', 'skills', 'ambiance'),
    path.resolve(__dirname, '..', 'skills', 'ambiance'),
    path.resolve(process.cwd(), 'skills', 'ambiance'),
  ];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
        return candidate;
      }
    } catch {
      // ignore and continue
    }
  }

  return undefined;
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
      case 'context': {
        const { handleSemanticCompact } = await import('./runtime/context/semanticCompact');

        const allowedKeys = [
          'query',
          'taskType',
          'maxTokens',
          'maxSimilarChunks',
          'autoSync',
          'autoSyncBatchSize',
          'excludePatterns',
        ];
        const positionalArgs = extractPositionalArgs(toolArgs, allowedKeys);
        const parsed = parseToolSpecificArgs(toolArgs, allowedKeys);
        const query =
          typeof parsed.query === 'string' && parsed.query.trim().length > 0
            ? parsed.query
            : positionalArgs[0] || 'Analyze this project';

        const { query: _query, ...parsedArgs } = parsed;
        result = await handleSemanticCompact({
          query,
          projectPath: globalOptions.projectPath || detectProjectPath(),
          format: resolveToolFormat(globalOptions, 'structured'),
          ...parsedArgs,
        });
        break;
      }

      case 'hints': {
        const { handleProjectHints } = await import('./runtime/hints/projectHints');

        const allowedKeys = [
          'maxFiles',
          'folderPath',
          'includeContent',
          'useAI',
          'excludePatterns',
        ];
        const parsedArgs = parseToolSpecificArgs(toolArgs, allowedKeys);
        result = await handleProjectHints({
          projectPath: globalOptions.projectPath || detectProjectPath(),
          format: resolveToolFormat(globalOptions, 'compact'),
          ...parsedArgs,
        });
        break;
      }

      case 'summary': {
        const { handleFileSummary } = await import('./runtime/summary/fileSummary');

        const allowedKeys = ['includeSymbols', 'maxSymbols'];
        const positionalArgs = extractPositionalArgs(toolArgs, allowedKeys);
        const filePath = positionalArgs[0];
        if (!filePath) {
          exitWithError({
            command: 'summary',
            message: 'filePath is required for summary command',
            options: globalOptions,
            exitCode: EXIT_CODES.USAGE_ERROR,
          });
        }

        const parsedArgs = parseToolSpecificArgs(toolArgs, allowedKeys);
        result = await handleFileSummary({
          filePath,
          format: resolveToolFormat(globalOptions, 'structured'),
          ...parsedArgs,
        });
        break;
      }

      case 'manifest': {
        const { handleProjectManifest } = await import('./runtime/manifest/projectManifest');

        const allowedKeys = [
          'filePattern',
          'exportsOnly',
          'includeTypes',
          'includeClasses',
          'includeInterfaces',
          'maxFiles',
          'groupByFolder',
          'sortBy',
          'includeLines',
          'excludePatterns',
        ];
        const parsedArgs = parseToolSpecificArgs(toolArgs, allowedKeys);

        result = await handleProjectManifest({
          projectPath: globalOptions.projectPath || detectProjectPath(),
          format: resolveToolFormat(globalOptions, 'compact') as
            | 'compact'
            | 'tree'
            | 'json'
            | 'flat',
          ...parsedArgs,
        });
        break;
      }

      case 'frontend': {
        const { handleFrontendInsights } = await import('./runtime/frontend/frontendInsights');

        const allowedKeys = ['includeContent', 'subtree', 'maxFiles'];
        const parsedArgs = parseToolSpecificArgs(toolArgs, allowedKeys);
        result = await handleFrontendInsights({
          projectPath: globalOptions.projectPath || detectProjectPath(),
          format: resolveToolFormat(globalOptions, 'structured'),
          ...parsedArgs,
        });
        break;
      }

      case 'debug': {
        const { handleLocalDebugContext } = await import('./runtime/debug/localDebugContext');

        const allowedKeys = ['maxMatches'];
        const positionalArgs = extractPositionalArgs(toolArgs, allowedKeys);
        const logText = positionalArgs[0];
        if (!logText) {
          exitWithError({
            command: 'debug',
            message: 'logText is required for debug command',
            options: globalOptions,
            exitCode: EXIT_CODES.USAGE_ERROR,
          });
        }

        const parsedArgs = parseToolSpecificArgs(toolArgs, allowedKeys);
        result = await handleLocalDebugContext({
          logText,
          projectPath: globalOptions.projectPath || detectProjectPath(),
          format: resolveToolFormat(globalOptions, 'structured'),
          ...parsedArgs,
        });
        break;
      }

      case 'grep': {
        const { handleAstGrep } = await import('./runtime/grep/astGrep');

        const allowedKeys = [
          'pattern',
          'language',
          'outputMode',
          'filePattern',
          'maxMatches',
          'rulePath',
          'ruleYaml',
          'ruleJson',
          'includeContext',
          'contextLines',
          'respectGitignore',
          'excludePatterns',
        ];
        const unknownFlags = findUnknownToolFlags(toolArgs, allowedKeys);
        if (unknownFlags.length > 0) {
          exitWithError({
            command: 'grep',
            message:
              `Unknown grep option(s): ${unknownFlags.join(', ')}. ` +
              'Run "ambiance grep --help" for supported flags.',
            options: globalOptions,
            exitCode: EXIT_CODES.USAGE_ERROR,
          });
        }

        const positionalArgs = extractPositionalArgs(toolArgs, allowedKeys);
        const parsedArgs = parseToolSpecificArgs(toolArgs, allowedKeys);

        if (typeof parsedArgs.ruleJson === 'string') {
          try {
            parsedArgs.ruleJson = JSON.parse(parsedArgs.ruleJson);
          } catch (error) {
            exitWithError({
              command: 'grep',
              message:
                'Invalid JSON provided to --rule-json. Example: --rule-json "{\\"id\\":\\"x\\",\\"rule\\":{\\"pattern\\":\\"function $NAME($ARGS) { $BODY }\\"}}"',
              options: globalOptions,
              exitCode: EXIT_CODES.USAGE_ERROR,
            });
          }
        }

        const hasRuleInput = !!(parsedArgs.rulePath || parsedArgs.ruleYaml || parsedArgs.ruleJson);
        const pattern =
          typeof parsedArgs.pattern === 'string' && parsedArgs.pattern.trim().length > 0
            ? parsedArgs.pattern
            : positionalArgs[0];
        if (!pattern && !hasRuleInput) {
          exitWithError({
            command: 'grep',
            message:
              'pattern is required unless a rule input is provided. Example: ambiance grep "function $NAME($ARGS) { $BODY }" --language ts',
            options: globalOptions,
            exitCode: EXIT_CODES.USAGE_ERROR,
          });
        }

        if (
          parsedArgs.excludePatterns === undefined &&
          globalOptions.excludePatterns !== undefined
        ) {
          parsedArgs.excludePatterns = globalOptions.excludePatterns;
        }

        const grepArgs: Record<string, unknown> = {
          projectPath: globalOptions.projectPath || detectProjectPath(),
          ...parsedArgs,
        };
        if (pattern) {
          grepArgs.pattern = pattern;
        }

        result = await handleAstGrep(grepArgs);
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
          exitWithError({
            command: 'compare',
            message: 'prompt is required for compare command',
            options: globalOptions,
            exitCode: EXIT_CODES.USAGE_ERROR,
          });
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
          exitWithError({
            command: 'compare',
            message: `Error parsing models: ${
              parseError instanceof Error ? parseError.message : String(parseError)
            }`,
            options: globalOptions,
            exitCode: EXIT_CODES.USAGE_ERROR,
          });
        }

        if (modelSpecs.length === 0) {
          exitWithError({
            command: 'compare',
            message: 'at least one model must be provided (e.g. openai:gpt-5)',
            options: globalOptions,
            exitCode: EXIT_CODES.USAGE_ERROR,
          });
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

        if (isJsonMode(globalOptions)) {
          result = comparison;
        } else {
          result = formatComparisonResultMarkdown(comparison);
        }

        break;
      }

      case 'doctor': {
        const { runDoctor } = await import('./runtime/doctor');
        result = await runDoctor({
          detectedProjectPath: globalOptions.projectPath || detectProjectPath(),
        });
        break;
      }

      case 'skill': {
        const positional = toolArgs.filter(arg => !arg.startsWith('--'));
        const subcommand = positional[0] || 'verify';
        const subArg = positional[1];

        if (toolArgs.includes('--help') || toolArgs.includes('-h')) {
          showCommandHelp('skill');
          process.exit(EXIT_CODES.OK);
        }

        if (subcommand === 'list' || subcommand === 'workflow' || subcommand === 'recipe') {
          const baseDir = findSkillBaseDirForCli();
          if (!baseDir) {
            exitWithError({
              command: 'skill',
              message: 'skills/ambiance directory not found',
              options: globalOptions,
              exitCode: EXIT_CODES.RUNTIME_ERROR,
            });
          }

          const workflowsDir = path.join(baseDir, 'workflows');
          const recipesDir = path.join(baseDir, 'recipes');
          const workflowFiles =
            fs.existsSync(workflowsDir) && fs.statSync(workflowsDir).isDirectory()
              ? fs
                  .readdirSync(workflowsDir)
                  .filter(f => f.endsWith('.json'))
                  .sort()
              : [];
          const recipeFiles =
            fs.existsSync(recipesDir) && fs.statSync(recipesDir).isDirectory()
              ? fs
                  .readdirSync(recipesDir)
                  .filter(f => f.endsWith('.json'))
                  .sort()
              : [];

          if (subcommand === 'list') {
            result = {
              success: true,
              timestamp: new Date().toISOString(),
              baseDir,
              workflows: workflowFiles.map(f => f.replace(/\.json$/i, '')),
              recipes: recipeFiles.map(f => f.replace(/\.json$/i, '')),
            };
            break;
          }

          if (!subArg) {
            exitWithError({
              command: 'skill',
              message: `skill ${subcommand} requires a name argument`,
              options: globalOptions,
              exitCode: EXIT_CODES.USAGE_ERROR,
            });
          }

          const fileName = subArg.endsWith('.json') ? subArg : `${subArg}.json`;
          const targetDir = subcommand === 'workflow' ? workflowsDir : recipesDir;
          const targetPath = path.join(targetDir, fileName);
          if (!fs.existsSync(targetPath)) {
            exitWithError({
              command: 'skill',
              message: `${subcommand} "${subArg}" not found`,
              options: globalOptions,
              exitCode: EXIT_CODES.USAGE_ERROR,
            });
          }

          const parsed = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
          result = {
            success: true,
            timestamp: new Date().toISOString(),
            type: subcommand,
            name: subArg,
            path: targetPath,
            definition: parsed,
          };
          break;
        }

        if (subcommand === 'install') {
          const baseDir = findSkillBaseDirForCli();
          if (!baseDir) {
            exitWithError({
              command: 'skill',
              message: 'skills/ambiance directory not found (cannot install)',
              options: globalOptions,
              exitCode: EXIT_CODES.RUNTIME_ERROR,
            });
          }

          const parsed = parseToolSpecificArgs(toolArgs, ['target', 'dryRun']);
          const targetDir = typeof parsed.target === 'string' ? parsed.target : undefined;
          const dryRun = parsed.dryRun === true;

          const { runSkillInstall } = await import('./runtime/skill/install');

          try {
            const report = await runSkillInstall({
              sourceDir: baseDir,
              targetDir,
              dryRun,
            });
            result = report;
          } catch (e) {
            exitWithError({
              command: 'skill',
              message: `Install failed: ${e instanceof Error ? e.message : String(e)}`,
              options: globalOptions,
              exitCode: EXIT_CODES.RUNTIME_ERROR,
            });
          }

          break;
        }

        if (subcommand !== 'verify') {
          exitWithError({
            command: 'skill',
            message: `Unknown skill subcommand: ${subcommand} (supported: verify, list, workflow, recipe, install)`,
            options: globalOptions,
            exitCode: EXIT_CODES.USAGE_ERROR,
          });
        }

        const { runSkillVerify } = await import('./runtime/skill/verify');
        const report = await runSkillVerify({
          detectedProjectPath: globalOptions.projectPath || detectProjectPath(),
          availableCommands: commands,
        });
        result = report;

        if (!report.success) {
          process.exitCode = EXIT_CODES.RUNTIME_ERROR;
        }

        break;
      }

      case 'migrate': {
        const subcommand = toolArgs.find(arg => !arg.startsWith('--')) || 'mcp-map';

        if (subcommand !== 'mcp-map') {
          exitWithError({
            command: 'migrate',
            message: `Unknown migrate subcommand: ${subcommand} (supported: mcp-map)`,
            options: globalOptions,
            exitCode: EXIT_CODES.USAGE_ERROR,
          });
        }

        const { getMcpToolMigrationMap } = await import('./runtime/migrate/mcpToolMap');
        result = {
          success: true,
          timestamp: new Date().toISOString(),
          map: getMcpToolMigrationMap(),
        };
        break;
      }

      case 'packs': {
        const positionalArgs = toolArgs.filter(arg => !arg.startsWith('--'));
        const subcommand = positionalArgs[0] || 'list';
        const identifier = positionalArgs[1];

        const parsed = parseToolSpecificArgs(toolArgs, [
          'name',
          'query',
          'taskType',
          'maxTokens',
          'useEmbeddings',
          'excludePatterns',
          'notes',
          'packsDir',
          'id',
        ]);

        const projectPath = globalOptions.projectPath || detectProjectPath();
        const packsDir = typeof parsed.packsDir === 'string' ? parsed.packsDir : undefined;
        const resolvedIdentifier =
          (typeof parsed.id === 'string' && parsed.id.length > 0 ? parsed.id : undefined) ||
          identifier;

        const {
          createContextPack,
          deleteContextPack,
          getContextPack,
          getContextPackTemplate,
          listContextPacks,
          resolvePacksDir,
        } = await import('./runtime/packs');

        if (subcommand === 'template') {
          const template = getContextPackTemplate();
          result = {
            success: true,
            timestamp: new Date().toISOString(),
            template,
          };
          break;
        }

        if (subcommand === 'list') {
          const listed = listContextPacks({ projectPath, packsDir });
          result = {
            success: true,
            timestamp: new Date().toISOString(),
            packsDir: listed.packsDir,
            packs: listed.packs,
            content:
              listed.packs.length === 0
                ? `No context packs found in ${listed.packsDir}`
                : `Found ${listed.packs.length} context pack(s) in ${listed.packsDir}`,
          };
          break;
        }

        if (subcommand === 'get') {
          if (!resolvedIdentifier) {
            exitWithError({
              command: 'packs',
              message: 'packs get requires an identifier (id or name)',
              options: globalOptions,
              exitCode: EXIT_CODES.USAGE_ERROR,
            });
          }

          const fetched = getContextPack({ identifier: resolvedIdentifier, projectPath, packsDir });
          result = {
            success: true,
            timestamp: new Date().toISOString(),
            packsDir: fetched.packsDir,
            pack: fetched.pack,
          };
          break;
        }

        if (subcommand === 'delete') {
          if (!resolvedIdentifier) {
            exitWithError({
              command: 'packs',
              message: 'packs delete requires an identifier (id or name)',
              options: globalOptions,
              exitCode: EXIT_CODES.USAGE_ERROR,
            });
          }

          const deleted = deleteContextPack({
            identifier: resolvedIdentifier,
            projectPath,
            packsDir,
          });
          result = {
            success: deleted.deleted,
            timestamp: new Date().toISOString(),
            packsDir: deleted.packsDir,
            deleted: deleted.deleted,
            filePath: deleted.filePath,
            content: deleted.deleted
              ? `Deleted context pack: ${resolvedIdentifier}`
              : `Context pack not found: ${resolvedIdentifier}`,
          };

          if (!deleted.deleted) {
            process.exitCode = EXIT_CODES.USAGE_ERROR;
          }

          break;
        }

        if (subcommand === 'create') {
          const name = typeof parsed.name === 'string' ? parsed.name : undefined;
          const query = typeof parsed.query === 'string' ? parsed.query : undefined;
          if (!name || !query) {
            exitWithError({
              command: 'packs',
              message: 'packs create requires --name and --query',
              options: globalOptions,
              exitCode: EXIT_CODES.USAGE_ERROR,
            });
          }

          const created = createContextPack({
            name,
            query,
            projectPath,
            packsDir,
            taskType: typeof parsed.taskType === 'string' ? parsed.taskType : undefined,
            maxTokens: typeof parsed.maxTokens === 'number' ? parsed.maxTokens : undefined,
            useEmbeddings:
              typeof parsed.useEmbeddings === 'boolean' ? parsed.useEmbeddings : undefined,
            excludePatterns: Array.isArray(parsed.excludePatterns)
              ? parsed.excludePatterns
              : undefined,
            notes: typeof parsed.notes === 'string' ? parsed.notes : undefined,
          });

          result = {
            success: true,
            timestamp: new Date().toISOString(),
            packsDir: resolvePacksDir({ projectPath, packsDir }),
            pack: created.pack,
            filePath: created.filePath,
            content: `Created context pack "${created.pack.name}" (${created.pack.id})`,
          };
          break;
        }

        if (subcommand === 'ui') {
          if (isJsonMode(globalOptions) || !process.stdout.isTTY) {
            exitWithError({
              command: 'packs',
              message:
                'packs ui requires an interactive TTY (re-run without --format json or --json)',
              options: globalOptions,
              exitCode: EXIT_CODES.USAGE_ERROR,
            });
          }

          const readline = require('readline');
          const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

          const ask = (q: string) =>
            new Promise<string>(resolve => rl.question(q, (answer: string) => resolve(answer)));

          const name = (await ask('Pack name: ')).trim();
          const query = (await ask('Query: ')).trim();
          const taskType = (await ask('Task type (optional, default "understand"): ')).trim();
          rl.close();

          if (!name || !query) {
            exitWithError({
              command: 'packs',
              message: 'packs ui requires a non-empty name and query',
              options: globalOptions,
              exitCode: EXIT_CODES.USAGE_ERROR,
            });
          }

          const created = createContextPack({
            name,
            query,
            projectPath,
            packsDir,
            taskType: taskType.length > 0 ? taskType : 'understand',
          });

          result = {
            success: true,
            timestamp: new Date().toISOString(),
            packsDir: resolvePacksDir({ projectPath, packsDir }),
            pack: created.pack,
            filePath: created.filePath,
            content: `Created context pack "${created.pack.name}" (${created.pack.id}) at ${created.filePath}`,
          };
          break;
        }

        exitWithError({
          command: 'packs',
          message: `Unknown packs subcommand: ${subcommand} (supported: create, list, get, delete, template, ui)`,
          options: globalOptions,
          exitCode: EXIT_CODES.USAGE_ERROR,
        });

        break;
      }

      case 'embeddings': {
        if (process.env.USE_LOCAL_EMBEDDINGS === undefined) {
          process.env.USE_LOCAL_EMBEDDINGS = 'true';
        }

        const { handleManageEmbeddings } = await import('./tools/localTools/embeddingManagement');
        const action = (toolArgs.find(arg => !arg.startsWith('--')) ||
          'status') as ManageEmbeddingsAction;
        let projectIdentifier: string | undefined;

        const promptArgs = parseToolSpecificArgs(toolArgs, ['autoUpdate', 'force']);
        const skipConfirmation = promptArgs.force === true;

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
        if (action === 'create' && !skipConfirmation) {
          if (isJsonMode(globalOptions) || !process.stdout.isTTY) {
            exitWithError({
              command: 'embeddings',
              message:
                'embeddings create requires interactive confirmation (re-run without --format json, or pass --force true to skip confirmation)',
              options: globalOptions,
              exitCode: EXIT_CODES.USAGE_ERROR,
            });
          }

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
                '**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts,py,go,rs,java,cpp,c,cc,cxx,h,hpp,hh,hxx,cs,rb,php,swift,kt,kts,scala,clj,hs,lhs,ml,r,sql,sh,bash,zsh,ex,exs,lua,md,mdx,json,yaml,yml,xml,html,htm,css,scss,sass,less,astro,vue,svelte}',
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
          console.log('📈 Progress: Can be monitored with "ambiance embeddings status"');
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

          if (!isJsonMode(globalOptions)) {
            // Always show which project is being checked
            console.log(`\n🔍 Checking stale files in: ${projectPath}`);
          }

          // Require confirmation for autoUpdate
          if (parsedArgs.autoUpdate) {
            if (isJsonMode(globalOptions) || !process.stdout.isTTY) {
              exitWithError({
                command: 'embeddings',
                message:
                  'embeddings check_stale --auto-update requires interactive confirmation (re-run without --format json, or omit --auto-update)',
                options: globalOptions,
                exitCode: EXIT_CODES.USAGE_ERROR,
              });
            }

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
        console.error(
          'Note: ambiance_* commands are compatibility-only (MCP adapter) and may be removed in a future release.'
        );

        // Handle ambiance tools
        const { ambianceHandlers } = await import('./tools/ambianceTools');
        const handler = ambianceHandlers[command];
        if (!handler) {
          exitWithError({
            command,
            message: `Handler not found for command: ${command}`,
            options: globalOptions,
            exitCode: EXIT_CODES.USAGE_ERROR,
          });
        }

        result = await handler({
          path: globalOptions.projectPath || detectProjectPath(),
          ...parseToolSpecificArgs(toolArgs, ['path', 'force', 'skipCloud', 'pattern']),
        });
        break;
      }

      default:
        exitWithError({
          command,
          message: `Unknown command: ${command}`,
          options: globalOptions,
          exitCode: EXIT_CODES.USAGE_ERROR,
        });
    }

    if (isJsonMode(globalOptions)) {
      result = normalizeJsonResult(command, result);

      if (typeof result === 'object' && result !== null && !Array.isArray(result)) {
        const exitCode = (result as any).exitCode;
        if (typeof exitCode === 'number' && Number.isFinite(exitCode) && exitCode !== 0) {
          process.exitCode = exitCode;
        }
      }
    }

    // Handle output
    const output = formatToolOutput(result, globalOptions);
    if (globalOptions.output) {
      require('fs').writeFileSync(globalOptions.output, output);
      console.error(`Output written to ${globalOptions.output}`);
    } else {
      console.log(output);
    }
  } catch (error) {
    exitWithError({
      command,
      message: `Error executing ${command} command: ${
        error instanceof Error ? error.message : String(error)
      }`,
      options: globalOptions,
      exitCode: EXIT_CODES.RUNTIME_ERROR,
    });
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

const TOOL_OPTION_ALIASES: Record<string, string> = {
  exclude: 'excludepatterns',
};

function normalizeToolOptionKey(rawKey: string): string {
  const normalized = rawKey.replace(/^-+/, '').replace(/-/g, '').toLowerCase();
  return TOOL_OPTION_ALIASES[normalized] || normalized;
}

function findUnknownToolFlags(args: string[], allowedKeys: string[]): string[] {
  const allowed = new Set(allowedKeys.map(key => normalizeToolOptionKey(key)));
  const unknown = new Set<string>();

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('--')) continue;

    const keyToken = arg.slice(2);
    const key = keyToken.includes('=') ? keyToken.split('=')[0] : keyToken;
    const normalized = normalizeToolOptionKey(key);
    const hasValue =
      !keyToken.includes('=') && i + 1 < args.length && !args[i + 1].startsWith('--');

    if (!allowed.has(normalized)) {
      unknown.add(`--${key}`);
    }
    if (hasValue) {
      i += 1;
    }
  }

  return Array.from(unknown);
}

function parseToolSpecificArgs(args: string[], allowedKeys: string[]): ToolArgMap {
  const parsed: ToolArgMap = {};
  const arrayKeys = new Set(['excludepatterns', 'files']); // Keys parsed as arrays (after normalization)

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const rawKey = arg.replace('--', '');
      const key = normalizeToolOptionKey(rawKey);
      const matchedKey = allowedKeys.find(allowed => normalizeToolOptionKey(allowed) === key);
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

function extractPositionalArgs(args: string[], allowedKeys: string[]): string[] {
  const allowed = new Set(allowedKeys.map(key => normalizeToolOptionKey(key)));
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg.startsWith('--')) {
      const key = normalizeToolOptionKey(arg.replace('--', ''));

      const isRecognized = allowed.has(key);
      const hasValue = i + 1 < args.length && !args[i + 1].startsWith('--');

      // Skip recognized flags and their values.
      // For unknown flags, also skip a following value (best-effort to avoid mis-parsing).
      if (isRecognized && hasValue) {
        i += 1;
      } else if (!isRecognized && hasValue) {
        i += 1;
      }

      continue;
    }

    positional.push(arg);
  }

  return positional;
}

function normalizeJsonResult(command: string, result: unknown): unknown {
  if (typeof result !== 'object' || result === null || Array.isArray(result)) {
    return {
      success: true,
      command,
      exitCode: EXIT_CODES.OK,
      result,
    };
  }

  const record = result as Record<string, unknown>;
  const hasSuccess = Object.prototype.hasOwnProperty.call(record, 'success');
  const hasError = typeof record.error === 'string' && record.error.trim().length > 0;
  const success = hasSuccess ? Boolean(record.success) : !hasError;

  const hasExitCode =
    Object.prototype.hasOwnProperty.call(record, 'exitCode') &&
    typeof record.exitCode === 'number' &&
    Number.isFinite(record.exitCode);

  const exitCode = hasExitCode
    ? Number(record.exitCode)
    : success
      ? EXIT_CODES.OK
      : EXIT_CODES.RUNTIME_ERROR;

  return {
    ...(hasSuccess ? {} : { success }),
    ...(Object.prototype.hasOwnProperty.call(record, 'command') ? {} : { command }),
    ...(hasExitCode ? {} : { exitCode }),
    ...record,
  };
}

function formatToolOutput(result: unknown, options: GlobalOptions): string {
  if (isJsonMode(options)) {
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
  if (isToolCommand && isHelp) {
    showCommandHelp(args[0]);
    process.exit(0);
  } else if (isHelp) {
    showHelp({ expanded: wantsExpandedHelp });
    process.exit(0);
  } else if (isVersion) {
    showVersion();
    process.exit(0);
  } else if (requestedServer) {
    exitWithError({
      message:
        'MCP server mode has been removed from this package. Use CLI commands (try `ambiance --help`).',
      options: globalOptions,
      exitCode: EXIT_CODES.USAGE_ERROR,
    });
  } else if (isToolCommand && remaining.length > 0) {
    // Execute tool command
    const command = remaining[0];
    const toolArgs = remaining.slice(1);
    await executeToolCommand(command, toolArgs, globalOptions);
  } else {
    // Fallback to help for unrecognized arguments
    if (isJsonMode(globalOptions)) {
      exitWithError({
        message: 'Unrecognized arguments. Use --help for usage information.',
        options: globalOptions,
        exitCode: EXIT_CODES.USAGE_ERROR,
      });
    }

    console.log('Unrecognized arguments. Use --help for usage information.\n');
    showHelp();
    process.exit(EXIT_CODES.USAGE_ERROR);
  }
}

// Run main function
main().catch(error => {
  console.error('CLI Error:', error);
  process.exit(1);
});
