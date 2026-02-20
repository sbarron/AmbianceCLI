/**
 * @fileOverview: AST-Grep integration for structural code search and transformation
 * @module: AstGrep
 * @keyFunctions:
 *   - astGrepTool: MCP tool definition for ast-grep integration
 *   - handleAstGrep: Tool handler for executing ast-grep queries
 *   - executeAstGrep: Core function to run ast-grep commands
 *   - parseAstGrepOutput: Parse and structure ast-grep JSON output
 * @dependencies:
 *   - @ast-grep/cli: Command-line interface for ast-grep
 *   - child_process: Node.js process spawning for CLI execution
 * @context: Provides agents with direct access to ast-grep's powerful structural search capabilities
 */

import { spawn } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { validateAndResolvePath } from '../utils/pathUtils';
import { logger } from '../../utils/logger';
import { loadIgnorePatterns } from '../../local/projectIdentifier';

export interface AstGrepMatch {
  file: string;
  range: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
  text: string;
  variables?: Record<string, string>;
}

export interface AstGrepResult {
  matches: AstGrepMatch[];
  totalMatches: number;
  executionTime: number;
  pattern: string;
  language?: string;
  engineUsed?: 'ast-grep' | 'text-fallback';
  degraded?: boolean;
  fallbackReason?: string;
  error?: string;
}

/**
 * MCP Tool definition for ast-grep structural search
 */
export const astGrepTool = {
  name: 'ast_grep_search',
  description: `🔍 AST-Grep structural code search tool

Performs powerful structural code search using ast-grep's pattern matching capabilities.
Unlike text-based search, this matches syntactical AST node structures.

**Key Features:**
- Structural pattern matching (not just text)
- Multi-language support (JS, TS, Python, Go, Rust, etc.)
- Wildcard variables ($VAR, $FUNC, $ARGS)
- Precise code location information
- Fast Rust-based execution with performance optimizations
- Comprehensive pattern validation with helpful error messages
- 120-second timeout for very large projects
- Automatic respect for .gitignore files (no manual exclusions needed)

**Pattern Syntax:**
- Use $ + UPPERCASE for wildcards: $FUNC, $VAR, $ARGS
- Patterns look like real code: 'function $NAME($ARGS) { $BODY }'
- Match specific constructs: 'new $CLASS($ARGS)'
- Valid characters: (), {}, [], "", '', numbers, operators, keywords
- NOT regex: do NOT use '|', '.*', '.+', '/pattern/', or escapes like '\\(' or '\\{'.

**Common Mistakes to Avoid:**
❌ Don't use: 'function $FUNC' (ambiguous, multiple AST interpretations)
❌ Don't use: 'export $TYPE' (ambiguous, multiple AST interpretations)
❌ Don't use: '$NAME' (too generic, matches everything)
❌ Don't use: /pattern/ (regex syntax not supported)

**✅ Good Patterns:**
- 'function $NAME($ARGS) { $BODY }' (complete function structure)
- 'export const $NAME = $VALUE' (exported constant)
- 'import $NAME from "$MODULE"' (import statement)
- 'new $CLASS($ARGS)' (constructor call)
- 'def ' (Python function definitions)
- 'class $NAME:' (Python class)
- 'await $PROMISE' inside 'for ($COND) { $BODY }' (relational patterns)

**Examples:**
- Find all functions: 'function $NAME($ARGS) { $BODY }'
- Find all exports: 'export const $NAME = $VALUE'
- Find imports: 'import $NAME from "$MODULE"'
- Find class instantiation: 'new $CLASS($ARGS)'
- Find method calls: '$OBJ.$METHOD($ARGS)'
- Find async functions: 'async function $NAME($ARGS) { $BODY }'
- Find arrow functions: 'const $NAME = ($ARGS) => $BODY'
- Find React components: 'export function $NAME($PROPS) { return $JSX }'
- Find Python function definitions: 'def '
- Find Python classes: 'class $NAME:'

**Advanced Usage:**
- Use $$$ for zero or more arguments: 'console.log($$$ARGS)'
- Use relational rules: 'await $PROMISE' inside 'for ($COND) { $BODY }'
- Use multiple searches for OR conditions (alternation not supported)

**Direct CLI Usage (for agents with command line access):**
Agents with command line access can run ast-grep directly:

# Basic usage
npx ast-grep --pattern "function $NAME($ARGS) { $BODY }" --lang ts

# Python function definitions
npx ast-grep --pattern "def " --lang py

# Python classes
npx ast-grep --pattern "class $NAME:" --lang py

# With file filtering (recommended for large projects)
npx ast-grep --pattern "def " --lang py src/**/*.py

# JSON output
npx ast-grep --pattern "class $NAME:" --lang py --json=stream

# Full documentation
npx ast-grep --help

# Note: ast-grep respects .gitignore files automatically - no --exclude-dir flags needed

**Use Cases:**
- Code refactoring and migration
- Finding specific patterns across codebase
- Security auditing for dangerous patterns
- Architecture analysis and dependency tracking
- Finding unused imports or exports
- API usage analysis

**Performance Optimizations for Large Projects:**
- 120-second timeout for very large projects
- Automatically respects .gitignore files for exclusions
- For additional exclusions, configure .gitignore in your project

**Tips for Large Projects (like D:\\Dev\\SWE-agent):**
- Use filePattern to search specific directories: "src/**/*.py"
- Add large directories to .gitignore: node_modules/, tests/, docs/, etc.
- Consider CLI usage for better performance: npx ast-grep --pattern "import json" --lang py src/**/*.py
`,
  inputSchema: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description:
          'AST pattern, not regex. Use $UPPERCASE wildcards. Examples: "$FUNC($ARGS)", "new $CLASS($ARGS)", "import $NAME from "express""',
      },
      rulePath: {
        type: 'string',
        description:
          'Path to an ast-grep rule file (YAML/JSON). When provided, rule mode is used instead of pattern.',
      },
      ruleYaml: {
        type: 'string',
        description:
          'Inline ast-grep rule content in YAML (JSON is also valid YAML). Will be written to a temp file and used with --rule.',
      },
      ruleJson: {
        type: 'object',
        description:
          'Inline ast-grep rule object (JSON). Optionally validated against local schemas and written to a temp file for --rule.',
      },
      projectPath: {
        type: 'string',
        description:
          'Project directory path to search in. Can be absolute or relative to workspace.',
      },
      language: {
        type: 'string',
        description:
          'Programming language (auto-detected if not provided). Supported: js, ts, py, go, rs, java, c, cpp',
        enum: [
          'js',
          'ts',
          'tsx',
          'jsx',
          'py',
          'go',
          'rs',
          'java',
          'c',
          'cpp',
          'php',
          'rb',
          'kt',
          'swift',
        ],
      },
      filePattern: {
        type: 'string',
        description:
          'Specific directory or file path to search within the project (e.g., "src", "lib", "*.py", "src/**/*.ts"). **RECOMMENDED for large projects** - if not provided, searches entire project respecting .gitignore. Use wildcards like "src/**/*.py" to search recursively in specific directories. This can dramatically improve performance on large codebases.',
      },
      maxMatches: {
        type: 'number',
        description: 'Maximum number of matches to return (default: 100)',
        default: 100,
        minimum: 1,
        maximum: 1000,
      },
      includeContext: {
        type: 'boolean',
        description: 'Include surrounding context lines for each match (default: true)',
        default: true,
      },
      contextLines: {
        type: 'number',
        description: 'Number of context lines to include around matches (default: 3)',
        default: 3,
        minimum: 0,
        maximum: 10,
      },
      respectGitignore: {
        type: 'boolean',
        description: 'Respect .gitignore files and other ignore patterns (default: true)',
        default: true,
      },
      excludePatterns: {
        type: 'array',
        description: 'Additional patterns to exclude from search (e.g., ["test/**", "docs/**"])',
        items: { type: 'string' },
      },
    },
    required: ['projectPath'],
  },
};

// Comprehensive pattern validation for ast-grep
interface PatternValidationResult {
  isValid: boolean;
  error?: string;
  suggestions?: string[];
  warning?: string;
}

const AST_GREP_GENERAL_EXAMPLES = [
  'function $NAME($ARGS) { $BODY }',
  'export const $NAME = $VALUE',
  'import $NAME from "$MODULE"',
  'const $NAME = ($ARGS) => $BODY',
  'new $CLASS($ARGS)',
];

const AST_GREP_LANGUAGE_EXAMPLES: Record<string, string[]> = {
  ts: ['interface $NAME { $BODY }', 'type $NAME = $VALUE'],
  tsx: ['export function $NAME($PROPS) { return $JSX }'],
  js: ['module.exports = $VALUE', '$OBJ.$METHOD($ARGS)'],
  jsx: ['export function $NAME($PROPS) { return $JSX }'],
  py: ['def ', 'class $NAME:'],
  go: ['func $NAME($ARGS) $RET { $BODY }'],
  rs: ['fn $NAME($ARGS) -> $RET { $BODY }'],
  java: ['class $NAME { $BODY }'],
  c: ['$RET $NAME($ARGS) { $BODY }'],
  cpp: ['class $NAME { $BODY }'],
  php: ['function $NAME($ARGS) { $BODY }'],
  rb: ['def $NAME', 'class $NAME'],
  kt: ['fun $NAME($ARGS): $RET { $BODY }'],
  swift: ['func $NAME($ARGS) -> $RET { $BODY }'],
};

function normalizeLanguageKey(language?: string): string | undefined {
  const raw = (language || '').trim().toLowerCase();
  if (!raw) return undefined;
  if (raw === 'typescript') return 'ts';
  if (raw === 'javascript') return 'js';
  if (raw === 'python') return 'py';
  if (raw === 'rust') return 'rs';
  return raw;
}

function getAstGrepPatternExamples(language?: string): string[] {
  const langKey = normalizeLanguageKey(language);
  const langExamples = langKey ? AST_GREP_LANGUAGE_EXAMPLES[langKey] || [] : [];
  return [...AST_GREP_GENERAL_EXAMPLES, ...langExamples].slice(0, 8);
}

function buildPatternValidationMessage(
  pattern: string,
  validation: PatternValidationResult,
  language?: string
): string {
  const suggestions = validation.suggestions || [];
  const examples = getAstGrepPatternExamples(language);
  const lines: string[] = [
    validation.error || 'Invalid AST pattern.',
    `Pattern: ${pattern}`,
    '',
    'Suggestions:',
    ...(suggestions.length > 0
      ? suggestions.map(s => `- ${s}`)
      : ['- Use a complete code-shaped AST pattern, not regex syntax.']),
    '',
    'Working examples:',
    ...examples.map(e => `- ${e}`),
    '',
    'Tip: Add --file-pattern "src/**/*.ts" while iterating to validate patterns quickly.',
  ];

  if (validation.warning) {
    lines.splice(2, 0, `Warning: ${validation.warning}`);
  }

  return lines.join('\n');
}

function maybeEnhanceAstGrepErrorMessage(
  errorMessage: string,
  pattern?: string,
  language?: string
): string {
  const parseLikeFailure =
    /syntaxerror|parse|unexpected|invalid pattern|cannot parse|sg: parse/i.test(errorMessage) &&
    /ast-grep|pattern|rule|code/i.test(errorMessage);

  if (!parseLikeFailure) {
    return errorMessage;
  }

  const examples = getAstGrepPatternExamples(language);
  const lines = [
    errorMessage,
    '',
    'Pattern parse guidance:',
    '- AST patterns are code snippets, not regex.',
    '- Avoid /regex/, | alternation, and .* wildcards.',
    '- Prefer complete forms like function/class/import statements.',
    '',
    'Try one of these patterns:',
    ...examples.map(e => `- ${e}`),
  ];

  if (typeof pattern === 'string' && pattern.trim().length > 0) {
    lines.splice(2, 0, `Pattern: ${pattern}`);
  }

  return lines.join('\n');
}

export function validateAstGrepPattern(pattern: string): PatternValidationResult {
  const trimmedPattern = pattern.trim();

  // Empty pattern check
  if (!trimmedPattern) {
    return {
      isValid: false,
      error:
        'Pattern cannot be empty. Use valid patterns like "function $NAME($ARGS) { $BODY }" or "def " for Python functions',
      suggestions: [
        'function $NAME($ARGS) { $BODY }',
        'import $NAME from "$MODULE"',
        'new $CLASS($ARGS)',
        'const $VAR = $VALUE',
        'def  (Python function definitions)',
        'class $NAME: (Python classes)',
      ],
    };
  }

  // Regex literal syntax check (/pattern/flags)
  if (/^\s*\/.+\/[gimsuy]*\s*$/i.test(trimmedPattern)) {
    return {
      isValid: false,
      error: 'Regex literal syntax (/pattern/flags) is not supported in AST patterns',
      suggestions: [
        'Use structural patterns instead of regex',
        'For multiple patterns, run separate searches',
        'Example: "import $NAME from \\"express\\"" instead of /import.*express/',
      ],
    };
  }

  // Alternation operator check
  if (trimmedPattern.includes('|')) {
    return {
      isValid: false,
      error: 'Alternation operator (|) is not supported in basic AST patterns',
      suggestions: [
        'Run separate searches for each pattern instead',
        'Example: search "import $NAME from \\"express\\"" and "const $NAME = require(\\"express\\")" separately',
      ],
    };
  }

  // Regex wildcards check
  if (
    trimmedPattern.includes('.*') ||
    trimmedPattern.includes('.+') ||
    trimmedPattern.includes('.*')
  ) {
    return {
      isValid: false,
      error: 'Regex wildcards (.*, .+, etc.) are not supported in AST patterns',
      suggestions: [
        'Use structural wildcards like $NAME, $ARGS instead',
        'Example: "function $NAME($ARGS) { $BODY }" matches any function',
      ],
    };
  }

  // Check for problematic Python patterns that don't work in ast-grep
  if (
    trimmedPattern.includes('def $NAME($ARGS):') ||
    trimmedPattern.includes('def $name($args):') ||
    (trimmedPattern.startsWith('def ') &&
      trimmedPattern.includes('$') &&
      trimmedPattern.includes(':'))
  ) {
    return {
      isValid: false,
      error:
        'Complex Python function definition patterns with metavariables may not work correctly in ast-grep',
      suggestions: [
        'Use simple patterns: "def " for function definitions',
        'Example: "def " instead of "def $NAME($ARGS):"',
      ],
    };
  }

  // Regex escape sequences check
  if (/\\([(){}\[\].+?^$])/g.test(trimmedPattern)) {
    return {
      isValid: false,
      error: 'Regex escape sequences (\\(escaped chars\\)) are not needed in AST patterns',
      suggestions: [
        'Remove backslashes - AST patterns use structural matching, not text matching',
        'Example: "function $NAME($ARGS)" instead of "function \\$NAME(\\$ARGS)"',
      ],
    };
  }

  // Regex groups/lookahead check
  if (trimmedPattern.includes('(?') || trimmedPattern.includes('?:')) {
    return {
      isValid: false,
      error: 'Regex groups and lookahead are not supported in AST patterns',
      suggestions: [
        'Use structural patterns with multiple searches instead',
        'Example: search "await $PROMISE" inside "for ($COND) { $BODY }"',
      ],
    };
  }

  // Check for ambiguous patterns that ast-grep can't parse
  const ambiguousPatterns = [
    /^export\s+\$[A-Z_]+$/,
    /^import\s+\$[A-Z_]+$/,
    /^function\s+\$[A-Z_]+$/,
    /^class\s+\$[A-Z_]+$/,
    /^\$[A-Z_]+\s*$/,
    /^export\s+default\s+\$[A-Z_]+$/,
  ];

  for (const ambiguousPattern of ambiguousPatterns) {
    if (ambiguousPattern.test(trimmedPattern)) {
      return {
        isValid: false,
        error: 'Pattern "' + trimmedPattern + '" is ambiguous and cannot be parsed by ast-grep',
        suggestions: [
          'Add more context to make the pattern unambiguous',
          'Example: "export const $NAME = $VALUE" instead of "export $TYPE"',
          'Example: "function $NAME($ARGS) { $BODY }" instead of "function $FUNC"',
        ],
      };
    }
  }

  // Check for patterns that are too generic and likely won't match anything useful
  const tooGenericPatterns = [
    /^\$[A-Z_]+$/,
    /^export\s+\$[A-Z_]+$/,
    /^import\s+\$[A-Z_]+$/,
    /^function\s+\$[A-Z_]+$/,
  ];

  let warning: string | undefined;
  for (const genericPattern of tooGenericPatterns) {
    if (genericPattern.test(trimmedPattern)) {
      warning =
        'Pattern "' +
        trimmedPattern +
        '" is very generic and may not match expected code structures';
      break;
    }
  }

  // Check for patterns missing metavariables when they should have them
  const patternsNeedingMetavariables = [
    {
      regex: /^export\s+(const|let|var|function|class|interface|type)\s+[^$]/,
      suggestion: 'Use metavariables like $NAME for the exported identifier',
    },
    { regex: /^function\s+[^$]/, suggestion: 'Use $NAME for the function name' },
    {
      regex: /^class\s+[^$]/,
      suggestion: 'Use $NAME for the class name and $BASE for inheritance',
    },
    { regex: /^import\s+[^$]/, suggestion: 'Use $NAME for the imported identifier' },
  ];

  const suggestions: string[] = [];
  for (const patternCheck of patternsNeedingMetavariables) {
    if (patternCheck.regex.test(trimmedPattern)) {
      suggestions.push(patternCheck.suggestion);
    }
  }

  return {
    isValid: true,
    suggestions: suggestions.length > 0 ? suggestions : undefined,
    warning,
  };
}

/**
 * Handle ast-grep search requests
 */
export async function handleAstGrep(args: any): Promise<AstGrepResult> {
  const startTime = Date.now();

  try {
    // Support rule-based execution path in addition to pattern
    const hasRuleInput = !!(args.rulePath || args.ruleYaml || args.ruleJson);
    let pattern: string | undefined;
    let ruleFilePath: string | undefined;
    let tempRule: string | null = null;
    const languageToUse = args.language || inferLanguageFromArgs(args);

    if (hasRuleInput) {
      const prepared = await prepareRuleFile(args);
      ruleFilePath = prepared.ruleFilePath;
      tempRule = prepared.isTemporary ? prepared.ruleFilePath : null;

      if (prepared.validationErrors && prepared.validationErrors.length > 0) {
        const message =
          'Rule schema validation failed:\n' +
          prepared.validationErrors.map((m: string) => '• ' + m).join('\n');
        throw new Error(message);
      }
    } else {
      // Early validation: comprehensive pattern validation
      if (typeof args.pattern !== 'string' || !args.pattern.trim()) {
        throw new Error(
          'Pattern is required and must be an AST snippet. Example: function $NAME($ARGS) { $BODY }'
        );
      }

      pattern = String(args.pattern);
      const validation = validateAstGrepPattern(pattern);

      if (!validation.isValid) {
        throw new Error(buildPatternValidationMessage(pattern, validation, languageToUse));
      }

      // Log warnings for potentially problematic patterns
      if (validation.warning) {
        logger.warn('⚠️ Potentially problematic AST pattern', {
          pattern,
          warning: validation.warning,
          suggestions: validation.suggestions,
        });
      }

      // Log suggestions for improvement
      if (validation.suggestions && validation.suggestions.length > 0) {
        logger.info('💡 Pattern suggestions available', {
          pattern,
          suggestions: validation.suggestions,
        });
      }
    }

    logger.info('🔍 Executing ast-grep search', {
      mode: hasRuleInput ? 'rule' : 'pattern',
      pattern,
      ruleFilePath,
      projectPath: args.projectPath,
      language: languageToUse,
      filePattern: args.filePattern,
    });

    // Validate and resolve the project path
    const projectPath = await validateAndResolvePath(args.projectPath);

    // Execute ast-grep command
    const result = await executeAstGrep({
      pattern,
      ruleFilePath,
      projectPath,
      language: languageToUse,
      filePattern: args.filePattern,
      maxMatches: args.maxMatches || 100,
      includeContext: args.includeContext !== false,
      contextLines: args.contextLines || 3,
      respectGitignore: args.respectGitignore !== false,
      excludePatterns: args.excludePatterns,
    });

    const executionTime = Date.now() - startTime;

    logger.info('✅ ast-grep search completed', {
      matches: result.matches.length,
      executionTime,
    });

    // Clean up temp rule if created
    if (tempRule) {
      try {
        await fs.unlink(tempRule);
      } catch (error) {
        logger.debug('Failed to delete temporary ast-grep rule file', {
          ruleFile: tempRule,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      ...result,
      executionTime,
      pattern: pattern ?? '(rule)',
      language: languageToUse,
    };
  } catch (error) {
    const executionTime = Date.now() - startTime;
    const rawErrorMessage = error instanceof Error ? error.message : String(error);
    const errorMessage = maybeEnhanceAstGrepErrorMessage(
      rawErrorMessage,
      typeof args?.pattern === 'string' ? String(args.pattern) : undefined,
      typeof args?.language === 'string' ? String(args.language) : undefined
    );

    const canFallback =
      typeof args?.pattern === 'string' &&
      args.pattern.trim().length > 0 &&
      /spawn|ast-grep|EPERM/i.test(rawErrorMessage);

    if (canFallback) {
      try {
        const fallback = await executeRipgrepFallback({
          pattern: String(args.pattern),
          projectPath: String(args.projectPath || process.cwd()),
          maxMatches: Number(args.maxMatches || 100),
          language: args.language,
        });
        return {
          ...fallback,
          executionTime,
          pattern: String(args.pattern),
          language: args.language,
          engineUsed: 'text-fallback',
          degraded: true,
          fallbackReason: rawErrorMessage,
        };
      } catch (fallbackError) {
        logger.warn('Text fallback after ast-grep failure also failed', {
          error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
        });
      }
    }

    logger.error('❌ ast-grep search failed', {
      error: rawErrorMessage,
      enhancedError: errorMessage !== rawErrorMessage ? errorMessage : undefined,
      pattern: args.pattern,
      executionTime,
    });

    return {
      matches: [],
      totalMatches: 0,
      executionTime,
      pattern: args?.pattern,
      language: args.language,
      engineUsed: 'ast-grep',
      degraded: false,
      error: errorMessage,
    };
  }
}

async function executeRipgrepFallback(options: {
  pattern: string;
  projectPath: string;
  maxMatches: number;
  language?: string;
}): Promise<AstGrepResult> {
  const literal = extractFallbackLiteral(options.pattern);
  if (!literal) {
    throw new Error('Unable to derive fallback literal from AST pattern');
  }

  const glob = languageToGlob(options.language);
  const args = [
    '--line-number',
    '--column',
    '--no-heading',
    '--smart-case',
    '--max-count',
    String(options.maxMatches),
  ];
  if (glob) {
    args.push('--glob', glob);
  }
  args.push(literal, options.projectPath);

  let result: { stdout: string; stderr: string; code: number | null };
  try {
    result = await new Promise<{ stdout: string; stderr: string; code: number | null }>(
      (resolve, reject) => {
        const child = spawn('rg', args, {
          cwd: options.projectPath,
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: false,
        });

        let stdout = '';
        let stderr = '';
        child.stdout?.on('data', d => (stdout += d.toString()));
        child.stderr?.on('data', d => (stderr += d.toString()));
        child.on('error', reject);
        child.on('close', code => resolve({ stdout, stderr, code }));
      }
    );
  } catch {
    return executeInProcessTextFallback(options, literal);
  }

  // rg returns code 1 when no matches; that's not an error for search.
  if (result.code !== 0 && result.code !== 1) {
    return executeInProcessTextFallback(options, literal);
  }

  const lines = result.stdout.split(/\r?\n/).filter(Boolean);
  const matches: AstGrepMatch[] = lines.slice(0, options.maxMatches).map(line => {
    const m = line.match(/^(.*?):(\d+):(\d+):(.*)$/);
    const file = m?.[1] || 'unknown';
    const lineNo = Number(m?.[2] || 1);
    const colNo = Number(m?.[3] || 1);
    const text = m?.[4] || line;
    return {
      file,
      range: {
        start: { line: lineNo, column: Math.max(0, colNo - 1) },
        end: { line: lineNo, column: Math.max(0, colNo - 1 + text.length) },
      },
      text,
    };
  });

  return {
    matches,
    totalMatches: matches.length,
    executionTime: 0,
    pattern: options.pattern,
    language: options.language,
    engineUsed: 'text-fallback',
    degraded: true,
  };
}

async function executeInProcessTextFallback(
  options: { pattern: string; projectPath: string; maxMatches: number; language?: string },
  literal: string
): Promise<AstGrepResult> {
  const files = await fs.readdir(options.projectPath, { recursive: true } as any).catch(() => []);
  const exts = languageToExtensions(options.language);
  const matches: AstGrepMatch[] = [];

  for (const rel of files as string[]) {
    if (matches.length >= options.maxMatches) break;
    const full = path.join(options.projectPath, rel);
    if (
      /[\\/]node_modules[\\/]|[\\/]dist[\\/]|[\\/]build[\\/]|[\\/]coverage[\\/]|[\\/]\\.git[\\/]/i.test(
        full
      )
    ) {
      continue;
    }
    if (exts && !exts.some(ext => full.toLowerCase().endsWith(ext))) continue;

    let content = '';
    try {
      const stat = await fs.stat(full);
      if (!stat.isFile() || stat.size > 512_000) continue;
      content = await fs.readFile(full, 'utf8');
    } catch {
      continue;
    }

    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length && matches.length < options.maxMatches; i++) {
      const idx = lines[i].toLowerCase().indexOf(literal.toLowerCase());
      if (idx !== -1) {
        matches.push({
          file: full,
          range: {
            start: { line: i + 1, column: idx },
            end: { line: i + 1, column: idx + literal.length },
          },
          text: lines[i],
        });
      }
    }
  }

  return {
    matches,
    totalMatches: matches.length,
    executionTime: 0,
    pattern: options.pattern,
    language: options.language,
    engineUsed: 'text-fallback',
    degraded: true,
  };
}

function extractFallbackLiteral(pattern: string): string | undefined {
  const cleaned = pattern
    .replace(/\$+[A-Z_]+/g, ' ')
    .replace(/[^a-zA-Z0-9_./-]+/g, ' ')
    .trim();
  if (!cleaned) return undefined;
  const allTokens = cleaned.split(/\s+/).filter(t => t.length >= 2);
  const tokens = allTokens.filter(
    t =>
      t.length >= 3 &&
      !/^(function|class|const|let|var|import|export|async|await|new|return)$/i.test(t)
  );
  if (tokens.length === 0) {
    if (allTokens.length === 0) return undefined;
    return allTokens.sort((a, b) => b.length - a.length)[0];
  }
  return tokens.sort((a, b) => b.length - a.length)[0];
}

function languageToGlob(language?: string): string | undefined {
  const lang = (language || '').toLowerCase();
  if (lang === 'ts' || lang === 'typescript' || lang === 'tsx') return '*.{ts,tsx}';
  if (lang === 'js' || lang === 'javascript' || lang === 'jsx') return '*.{js,jsx,mjs,cjs}';
  if (lang === 'py' || lang === 'python') return '*.py';
  if (lang === 'go') return '*.go';
  if (lang === 'rs' || lang === 'rust') return '*.rs';
  if (lang === 'java') return '*.java';
  if (lang === 'c') return '*.c';
  if (lang === 'cpp') return '*.cpp';
  return undefined;
}

function languageToExtensions(language?: string): string[] | undefined {
  const lang = (language || '').toLowerCase();
  if (lang === 'ts' || lang === 'typescript' || lang === 'tsx') return ['.ts', '.tsx'];
  if (lang === 'js' || lang === 'javascript' || lang === 'jsx')
    return ['.js', '.jsx', '.mjs', '.cjs'];
  if (lang === 'py' || lang === 'python') return ['.py'];
  if (lang === 'go') return ['.go'];
  if (lang === 'rs' || lang === 'rust') return ['.rs'];
  if (lang === 'java') return ['.java'];
  if (lang === 'c') return ['.c', '.h'];
  if (lang === 'cpp') return ['.cpp', '.cc', '.cxx', '.hpp', '.hh'];
  return undefined;
}

/**
 * Execute ast-grep command with specified options
 */
export async function executeAstGrep(options: {
  pattern?: string;
  ruleFilePath?: string;
  projectPath: string;
  language?: string;
  filePattern?: string;
  maxMatches: number;
  includeContext: boolean;
  contextLines: number;
  respectGitignore?: boolean;
  excludePatterns?: string[];
}): Promise<AstGrepResult> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const cliArgs: string[] = [];

    try {
      // Use rule file if provided; otherwise fall back to pattern
      if (options.ruleFilePath) {
        logger.debug('Using ast-grep rule file', { ruleFilePath: options.ruleFilePath });
        cliArgs.push('--rule', options.ruleFilePath);
      } else {
        const preflightValidation = validateAstGrepPattern(options.pattern || '');
        if (!preflightValidation.isValid) {
          throw new Error(
            buildPatternValidationMessage(
              options.pattern || '',
              preflightValidation,
              options.language
            )
          );
        }

        logger.debug('Adding pattern to args', {
          pattern: options.pattern,
          patternType: typeof options.pattern,
          patternLength: (options.pattern || '').length,
        });

        // Double-check the pattern before adding to args
        if (!options.pattern || options.pattern.trim() === '') {
          throw new Error('Pattern is empty or undefined');
        }

        logger.debug('Adding pattern to ast-grep arguments', {
          pattern: options.pattern,
          patternLength: options.pattern.length,
        });
        cliArgs.push('--pattern', options.pattern);
      }

      if (options.language) {
        cliArgs.push('--lang', options.language);
      }

      cliArgs.push('--json=stream');

      if (options.includeContext && options.contextLines > 0) {
        cliArgs.push('--context', options.contextLines.toString());
      }

      if (options.respectGitignore === false) {
        cliArgs.push('--no-ignore', 'vcs');
      }

      if (options.filePattern) {
        cliArgs.push(options.filePattern);
      } else {
        // Note: ast-grep respects .gitignore files by default, which provides most exclusions
        // For additional exclusions, users should configure .gitignore in their project
        cliArgs.push('.');
        logger.debug(
          'Using default .gitignore-based exclusions (ast-grep does not support --exclude-dir flags)'
        );
      }

      logger.info('Executing ast-grep search', {
        pattern: options.pattern,
        ruleFilePath: options.ruleFilePath,
        language: options.language,
        projectPath: options.projectPath,
        maxMatches: options.maxMatches,
        filePattern: options.filePattern || 'all files (with exclusions)',
        cwd: options.projectPath,
      });

      // Debug: Check if project path exists and is accessible
      try {
        const fs = require('fs');
        const path = require('path');
        const stats = fs.statSync(options.projectPath);
        logger.debug('Project path exists', {
          path: options.projectPath,
          isDirectory: stats.isDirectory(),
          readable: true,
          size: stats.size,
        });
      } catch (error) {
        logger.error('Project path does not exist or is not accessible', {
          path: options.projectPath,
          error: error instanceof Error ? error.message : String(error),
        });
        throw new Error('Project path does not exist or is not accessible: ' + options.projectPath);
      }

      logger.debug('ast-grep command details', {
        command: 'npx ast-grep',
        args: cliArgs,
        cwd: options.projectPath,
        fullCommand: 'npx ast-grep ' + cliArgs.join(' '),
      });

      // Log the command being executed
      const fullCommand = 'npx ast-grep ' + cliArgs.join(' ');
      logger.debug('Executing ast-grep command:', { command: fullCommand });

      let astGrep: ReturnType<typeof spawn> | null = null;
      let executionMethod = 'unknown';

      const localBinary = findLocalAstGrepBinary();
      if (localBinary) {
        try {
          const useShell = process.platform === 'win32' && localBinary.endsWith('.cmd');
          astGrep = spawn(localBinary, cliArgs, {
            cwd: options.projectPath,
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: useShell,
          });
          executionMethod = 'local-binary';
          logger.debug('Using local ast-grep binary', { binary: localBinary, useShell });
        } catch (localBinaryError) {
          logger.debug('Failed to spawn local binary, falling back to npx', {
            error:
              localBinaryError instanceof Error
                ? localBinaryError.message
                : String(localBinaryError),
          });
        }
      }

      if (!astGrep) {
        const approaches = [
          {
            name: 'cmd-npx',
            command: 'cmd',
            args: ['/c', 'npx', 'ast-grep', ...cliArgs],
            options: { shell: false },
          },
          {
            name: 'powershell-npx',
            command: 'powershell',
            args: [
              '-Command',
              'npx ast-grep ' +
                cliArgs
                  .map(a => (a.startsWith('--') || a === '.' ? a : `'${a.replace(/'/g, "''")}'`))
                  .join(' '),
            ],
            options: { shell: false },
          },
          {
            name: 'direct-npx',
            command: 'npx',
            args: ['ast-grep', ...cliArgs],
            options: { shell: false },
          },
        ] as const;

        let lastError: Error | null = null;

        for (const approach of approaches) {
          try {
            logger.debug('Attempting spawn approach', {
              approach: approach.name,
              command: approach.command,
              args: approach.args,
              cwd: options.projectPath,
              pattern: options.pattern,
              language: options.language,
            });

            astGrep = spawn(approach.command, approach.args, {
              cwd: options.projectPath,
              stdio: ['pipe', 'pipe', 'pipe'], // Change to pipe all streams for debugging
              ...approach.options,
              env: process.env,
            });

            executionMethod = approach.name;
            logger.debug('Spawn succeeded', { approach: approach.name });
            break;
          } catch (approachError) {
            lastError =
              approachError instanceof Error ? approachError : new Error(String(approachError));
            logger.debug('Spawn approach failed', {
              approach: approach.name,
              error: lastError.message,
              code: (lastError as any).code,
              shell: approach.options.shell,
            });
          }
        }

        if (!astGrep) {
          logger.error('All spawn approaches failed', {
            approaches: approaches.map(a => a.name),
            lastError: lastError?.message,
            cwd: options.projectPath,
            nodeVersion: process.version,
          });
          throw new Error(
            'All spawn approaches failed: ' + (lastError?.message || 'Unknown error')
          );
        }
      }

      if (!astGrep) {
        throw new Error('Failed to spawn ast-grep: no process handle available.');
      }

      let stdout = '';
      let stderr = '';

      astGrep.stdout?.on('data', data => {
        stdout += data.toString();
      });

      astGrep.stderr?.on('data', data => {
        const chunk = data.toString();
        stderr += chunk;
        // Only log stderr chunks that contain actual error information
        if (chunk.includes('SyntaxError') || chunk.includes('Error') || chunk.includes('error')) {
          logger.debug('ast-grep stderr:', chunk.substring(0, 200));
        }
      });

      astGrep.on('close', code => {
        clearInterval(activityInterval);
        logger.debug('ast-grep process closed', {
          code,
          executionMethod,
          success: code === 0,
          executionTime: Date.now() - startTime,
        });

        if (code !== 0 && code !== null) {
          reject(
            new Error(
              'ast-grep exited with code ' + code + ': ' + (stderr || 'No error message provided')
            )
          );
          return;
        }

        try {
          let matches = parseAstGrepOutput(stdout, options.maxMatches);

          if (options.excludePatterns && options.excludePatterns.length > 0) {
            matches = filterMatchesByExcludePatterns(
              matches,
              options.excludePatterns,
              options.projectPath
            );
          }

          resolve({
            ...matches,
            executionTime: Date.now() - startTime,
            pattern: options.pattern || (options.ruleFilePath ? '(rule)' : ''),
            language: options.language,
            engineUsed: 'ast-grep',
            degraded: false,
          });
        } catch (parseError) {
          reject(
            new Error(
              'Failed to parse ast-grep output: ' +
                (parseError instanceof Error ? parseError.message : String(parseError))
            )
          );
        }
      });

      // Add debugging for process activity
      let lastActivity = Date.now();
      const activityInterval = setInterval(() => {
        const now = Date.now();
        const timeSinceLastActivity = now - lastActivity;
        if (timeSinceLastActivity > 5000) {
          // Log every 5 seconds of inactivity
          logger.debug('ast-grep process still running', {
            executionTime: now - startTime,
            timeSinceLastActivity,
            executionMethod,
            cwd: options.projectPath,
          });
        }
      }, 5000);

      astGrep.stdout?.on('data', (data: Buffer) => {
        lastActivity = Date.now();
        const chunk = data.toString();
        stdout += chunk;
        if (chunk.includes('\n')) {
          logger.debug('ast-grep stdout chunk', {
            chunkLength: chunk.length,
            totalStdoutLength: stdout.length,
            executionTime: Date.now() - startTime,
          });
        }
      });

      astGrep.stderr?.on('data', (data: Buffer) => {
        lastActivity = Date.now();
        const chunk = data.toString();
        stderr += chunk;
        if (chunk.includes('\n')) {
          logger.debug('ast-grep stderr chunk', {
            chunkLength: chunk.length,
            totalStderrLength: stderr.length,
            executionTime: Date.now() - startTime,
          });
        }
      });

      astGrep.on('error', processError => {
        clearInterval(activityInterval);
        logger.error('ast-grep process error', {
          error: processError.message,
          code: (processError as any).code,
          stack: processError.stack?.substring(0, 300),
          executionMethod,
          cwd: options.projectPath,
          platform: process.platform,
          nodeVersion: process.version,
          path: process.env.PATH?.substring(0, 200),
        });
        reject(
          new Error(
            'Failed to spawn ast-grep (' +
              executionMethod +
              '): ' +
              processError.message +
              ' (code: ' +
              (processError as any).code +
              '). Make sure @ast-grep/cli is installed and accessible.'
          )
        );
      });

      setTimeout(() => {
        clearInterval(activityInterval);
        if (astGrep) {
          astGrep.kill();
        }
        reject(
          new Error(
            'ast-grep search timed out after 30 seconds. For large projects, consider using filePattern to search specific directories (e.g., "src/**/*.py") or excludePatterns to exclude large directories.'
          )
        );
      }, 30000);
    } catch (error) {
      logger.error('Failed to execute ast-grep', {
        error: error instanceof Error ? error.message : String(error),
        cwd: options.projectPath,
        platform: process.platform,
      });
      reject(
        new Error(
          'Failed to execute ast-grep: ' + (error instanceof Error ? error.message : String(error))
        )
      );
    }
  });
}

/**
 * Parse ast-grep JSON output into structured matches
 */
function parseAstGrepOutput(
  output: string,
  maxMatches: number
): { matches: AstGrepMatch[]; totalMatches: number } {
  if (!output.trim()) {
    return { matches: [], totalMatches: 0 };
  }

  try {
    // ast-grep outputs one JSON object per line for each match
    const lines = output
      .trim()
      .split('\n')
      .filter(line => line.trim());
    const allMatches: AstGrepMatch[] = [];
    let totalParsedMatches = 0;

    for (const line of lines) {
      try {
        const match = JSON.parse(line);

        // Convert ast-grep format to our format
        const astGrepMatch: AstGrepMatch = {
          file: match.file || match.path || 'unknown',
          range: {
            start: {
              line: match.range?.start?.line || match.start?.line || 1,
              column: match.range?.start?.column || match.start?.column || 0,
            },
            end: {
              line: match.range?.end?.line || match.end?.line || 1,
              column: match.range?.end?.column || match.end?.column || 0,
            },
          },
          text: match.text || match.content || '',
          variables: match.variables || match.env || {},
        };

        totalParsedMatches += 1;
        if (allMatches.length < maxMatches) {
          allMatches.push(astGrepMatch);
        }
      } catch (parseError) {
        logger.debug('Failed to parse ast-grep match line', { line, error: parseError });
        continue;
      }
    }

    return {
      matches: allMatches,
      totalMatches: totalParsedMatches,
    };
  } catch (error) {
    logger.warn('Failed to parse ast-grep output', { error, output: output.substring(0, 200) });
    return { matches: [], totalMatches: 0 };
  }
}

/**
 * Filter matches by additional exclude patterns
 */
function filterMatchesByExcludePatterns(
  matches: { matches: AstGrepMatch[]; totalMatches: number },
  excludePatterns: string[],
  projectPath: string
): { matches: AstGrepMatch[]; totalMatches: number } {
  const filteredMatches = matches.matches.filter(match => {
    const relativePath = path.relative(projectPath, match.file).replace(/\\/g, '/');

    return !excludePatterns.some(pattern => {
      const regex = pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*').replace(/\?/g, '.');
      return new RegExp('^' + regex + '$').test(relativePath);
    });
  });

  return {
    matches: filteredMatches,
    totalMatches: filteredMatches.length,
  };
}

/**
 * Get default ignore patterns for common directories to exclude
 */
function getDefaultExcludePatterns(): string[] {
  return [
    'node_modules/**',
    '.git/**',
    'dist/**',
    'build/**',
    'out/**',
    'target/**',
    '.vscode/**',
    '.idea/**',
    '**/*.min.js',
    '**/*.min.css',
    '**/*.map',
    'coverage/**',
    '.nyc_output/**',
    'tmp/**',
    'temp/**',
  ];
}

export async function isAstGrepAvailable(): Promise<boolean> {
  return new Promise(resolve => {
    // First, try to use the local binary if available
    const localBinary = findLocalAstGrepBinary();
    if (localBinary) {
      // For Windows .cmd files, we need to use shell execution
      const useShell = process.platform === 'win32' && localBinary.endsWith('.cmd');
      const astGrep = spawn(localBinary, ['--version'], {
        stdio: 'ignore',
        shell: useShell,
      });

      astGrep.on('close', code => {
        resolve(code === 0);
      });

      astGrep.on('error', () => {
        // If local binary fails, try npx fallback
        const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
        const fallbackAstGrep = spawn(npxCmd, ['ast-grep', '--version'], {
          stdio: 'ignore',
          shell: false,
        });

        fallbackAstGrep.on('close', code => {
          resolve(code === 0);
        });

        fallbackAstGrep.on('error', () => {
          resolve(false);
        });

        setTimeout(() => {
          fallbackAstGrep.kill();
          resolve(false);
        }, 5000);
      });

      setTimeout(() => {
        astGrep.kill();
        resolve(false);
      }, 5000);
      return;
    }

    // If no local binary, use cmd /c npx approach (consistent with main execution)
    const astGrep = spawn('cmd', ['/c', 'npx', 'ast-grep', '--version'], {
      stdio: 'ignore',
      shell: false,
    });

    astGrep.on('close', code => {
      resolve(code === 0);
    });

    astGrep.on('error', () => {
      resolve(false);
    });

    // Timeout after 5 seconds
    setTimeout(() => {
      astGrep.kill();
      resolve(false);
    }, 5000);
  });
}

// Try to find a locally installed ast-grep binary in node_modules/.bin
function findLocalAstGrepBinary(): string | null {
  try {
    // Check multiple possible locations for the binary
    const possibleLocations = [
      path.join(process.cwd(), 'node_modules', '.bin'),
      path.join(__dirname, '..', '..', '..', 'node_modules', '.bin'),
      path.join(__dirname, '..', '..', 'node_modules', '.bin'),
    ];

    // Try different extensions based on platform
    const extensions = process.platform === 'win32' ? ['.cmd', '.ps1', ''] : [''];

    for (const binDir of possibleLocations) {
      for (const ext of extensions) {
        const exe = 'ast-grep' + ext;
        const full = path.join(binDir, exe);
        if (require('fs').existsSync(full)) {
          logger.debug('Found local ast-grep binary', { path: full });
          return full;
        }
      }
    }

    logger.debug('No local ast-grep binary found');
    return null;
  } catch (error) {
    logger.debug('Error finding local ast-grep binary', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

// Build a shell-safe command string with quoted arguments
function buildShellCommand(cmd: string, args: string[]): string {
  const quote = (s: string) => {
    if (s === '.') return s;
    // Simple quoting; sufficient for our arg shapes (no newlines)
    if (process.platform === 'win32') {
      return '"' + s.replace(/"/g, '\\"') + '"';
    }
    return "'" + s.replace(/'/g, "'\\''") + "'";
  };
  return cmd + ' ' + args.map(a => (a.startsWith('--') ? a : quote(a))).join(' ');
}

// Prepare a rule file based on args (rulePath | ruleYaml | ruleJson).
async function prepareRuleFile(
  args: any
): Promise<{ ruleFilePath: string; isTemporary: boolean; validationErrors?: string[] }> {
  if (args.rulePath && typeof args.rulePath === 'string') {
    return { ruleFilePath: args.rulePath, isTemporary: false };
  }

  if (args.ruleYaml && typeof args.ruleYaml === 'string') {
    const tempPath = await writeTempRuleFile(args.ruleYaml, '.yaml');
    return { ruleFilePath: tempPath, isTemporary: true };
  }

  if (args.ruleJson && typeof args.ruleJson === 'object') {
    const validation = validateRuleJson(args.ruleJson, args.language);
    if (validation && validation.length > 0) {
      return { ruleFilePath: '', isTemporary: true, validationErrors: validation };
    }
    const content = JSON.stringify(args.ruleJson, null, 2);
    const tempPath = await writeTempRuleFile(content, '.json');
    return { ruleFilePath: tempPath, isTemporary: true };
  }

  return {
    ruleFilePath: '',
    isTemporary: true,
    validationErrors: ['No rulePath, ruleYaml, or ruleJson provided'],
  };
}

async function writeTempRuleFile(
  content: string,
  ext: '.yaml' | '.yml' | '.json'
): Promise<string> {
  const tmpDir = require('os').tmpdir();
  const p = require('path');
  const filePath = p.join(
    tmpDir,
    'astgrep-rule-' + Date.now() + Math.random().toString(36).slice(2) + ext
  );
  await fs.writeFile(filePath, content, 'utf-8');
  return filePath;
}

function validateRuleJson(ruleJson: unknown, language?: string): string[] | null {
  try {
    if (!ruleJson || typeof ruleJson !== 'object') {
      return ['Rule JSON must be an object'];
    }

    // Try to use Ajv for full schema validation if available, otherwise minimal checks.
    const ajv = tryLoadAjv();
    const schema = loadSchemaForLanguage(language);
    if (ajv && schema) {
      const validate = ajv.compile(schema);
      const valid = validate(ruleJson);
      if (!valid) {
        const errs = (validate.errors || []).map((e: any) =>
          `${e.instancePath || '(root)'} ${e.message || ''}`.trim()
        );
        return errs.length > 0 ? errs : ['Rule JSON does not conform to schema'];
      }
      return null;
    }

    const errs: string[] = [];
    if (schema && Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (!(key in (ruleJson as any))) {
          errs.push('Missing required field: ' + key);
        }
      }
    }
    return errs.length > 0 ? errs : null;
  } catch {
    return null;
  }
}

function inferLanguageFromArgs(args: any): string | undefined {
  if (typeof args.language === 'string' && args.language.trim()) return args.language;
  const fp = typeof args.filePattern === 'string' ? String(args.filePattern) : '';
  if (/(^|\.)tsx?$/.test(fp) || /\.tsx(\b|$)/i.test(fp)) return 'ts';
  if (/\.jsx(\b|$)/i.test(fp)) return 'js';
  if (/\.py(\b|$)/i.test(fp)) return 'py';
  if (/\.rs(\b|$)/i.test(fp)) return 'rs';
  if (/\.go(\b|$)/i.test(fp)) return 'go';
  if (/\.(c|h)(\b|$)/i.test(fp)) return 'c';
  if (/\.(cpp|cc|cxx|hpp|hh)(\b|$)/i.test(fp)) return 'cpp';
  if (/\.java(\b|$)/i.test(fp)) return 'java';
  if (/\.php(\b|$)/i.test(fp)) return 'php';
  if (/\.(rb|ruby)(\b|$)/i.test(fp)) return 'rb';
  if (/\.kt(\b|$)/i.test(fp)) return 'kt';
  if (/\.swift(\b|$)/i.test(fp)) return 'swift';
  return undefined;
}

function loadSchemaForLanguage(language?: string): any | null {
  try {
    const p = require('path');
    const fsNative = require('fs');
    const base = p.join(__dirname, 'schemas');
    let file = 'rule.json';
    const lang = (language || '').toLowerCase();
    if (lang === 'ts' || lang === 'typescript') file = 'typescript_rule.json';
    else if (lang === 'tsx') file = 'tsx_rule.json';
    else if (lang === 'js' || lang === 'javascript') file = 'javascript_rule.json';
    else if (lang === 'py' || lang === 'python') file = 'python_rule.json';
    const full = p.join(base, file);
    if (!fsNative.existsSync(full)) return null;
    return JSON.parse(fsNative.readFileSync(full, 'utf-8'));
  } catch {
    return null;
  }
}

function tryLoadAjv(): any | null {
  try {
    // Lazy require; Ajv may not be installed in all environments
    // If absent, we fall back to minimal checks

    const Ajv = require('ajv');
    // coerceTypes not needed; draft-2020 supported by Ajv v8+
    return new Ajv({ allErrors: true, strict: false });
  } catch {
    return null;
  }
}
