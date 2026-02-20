# Ambiance Agent Skill

Versioned skill templates for CLI-first agent workflows.

## Documentation for Agents

**New to Ambiance?** Start here:
- [AGENT_GUIDE.md](./AGENT_GUIDE.md) - Quick decision-making reference for agents
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) - Error diagnosis and recovery patterns

**Machine-readable source of truth (recommended for agents):**
- `ambiance skill list --json`
- `ambiance skill workflow <name> --json`
- `ambiance skill recipe <name> --json`

**CLI help discovery (quickest way to inspect command flags):**
- `ambiance --help`
- `ambiance --help --expanded`
- `ambiance <command> --help` (examples: `ambiance context --help`, `ambiance embeddings --help`)

**This document** provides comprehensive command reference, output schemas, and workflow examples.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Reference for Agents](#quick-reference-for-agents)
- [Command Reference](#command-reference)
- [Parameter Guidelines](#parameter-guidelines)
- [Complete Workflow Examples](#complete-workflow-examples)
- [Error Handling](#error-handling)
- [Output Schemas](#output-schemas)
- [Integration Examples](#integration-examples)

## Prerequisites

Before using semantic commands (`context`, `debug`), ensure the environment is ready:

```bash
# 1. Verify CLI installation and environment
ambiance doctor --json

# 2. Check embedding status for the project
ambiance embeddings status --json --project-path ./

# 3. Create embeddings if needed (first-time setup, non-interactive)
ambiance embeddings create --json --project-path ./ --force true

# 4. Validate skill templates
ambiance skill verify --json
```

**Important**: Without embeddings, `context` and `debug` commands will fall back to basic text search with reduced accuracy. Use `embeddings status` to check index readiness before semantic retrieval.

## Quick Reference for Agents

| Task | Command | When to Use | Requires Embeddings |
|------|---------|------------|---------------------|
| Check environment | `doctor` | First run, troubleshooting | No |
| Project overview | `hints` | First time in codebase, navigation | No |
| Understand specific code | `context "<query>"` | Semantic code search, feature understanding | Yes (recommended) |
| Navigate to exact locations | `context "<query>" --format index` | Get file:line jump targets and next actions | Yes (recommended) |
| Debug an error | `debug "<log>"` | Extract context from error logs | Yes (recommended) |
| Find AST structures | `grep "<pattern>"` | Structural/capture-based search after index navigation | No |
| Fill exact text details | native `rg -n "<term>"` | String-level verification in files selected by index/grep | No |
| Analyze frontend | `frontend` | UI component analysis | No |
| Single file summary | `summary <file>` | Quick file overview | No |
| Manage embeddings | `embeddings <action>` | Setup, maintenance, status checks | N/A |
| Context packs | `packs <action>` | Save/load reusable context | No |

## Search Routing Policy

Use this order for agent search decisions (embedding-enabled):

1. `context --format index` first for jump targets and file prioritization.
2. `grep` second for AST shape/captures.
3. Native text search third: `rg -n "<term>" <path>` (fallback: `grep -R`) to fill exact details.

Fallback when embeddings/index are unavailable: start with native lexical search.

## Query Strategy: Semantic Anchor Clustering

For embedding retrieval, use query strings that look like likely code/docs terms rather than conversational questions.

- Prefer keyword-dense anchors over prose questions.
- Include project-specific symbols and library names when known.
- Combine domain intent + technical identifiers.

Examples:
- Conversational (weak): `What is the status of roadmap progress?`
- Anchor cluster (strong): `roadmap milestones implementation status PHASE2 TODO`
- Anchored with symbols (strong): `Supabase session middleware jwt validateToken cosineSimilarity`

## Index Hygiene

Use this maintenance order:

1. Status check first for deep investigations:
   `ambiance embeddings status --json --project-path ./`
2. Prefer incremental freshness for day-to-day work:
   `ambiance context "<query>" --json --project-path ./ --auto-sync`
   or `ambiance embeddings update --json --project-path ./`
3. Full rebuild only when needed:
   use `ambiance embeddings create --json --project-path ./ --force true` for migration/incompatible-model/corruption scenarios.

## Command Reference

### `doctor` - Environment Diagnostics

**Purpose**: Verify CLI installation, environment variables, and project readiness.

**Usage**:
```bash
ambiance doctor --json
```

**Output Schema**:
```json
{
  "success": true,
  "timestamp": "2026-02-06T22:56:22.919Z",
  "node": {
    "version": "v22.12.0",
    "platform": "win32",
    "arch": "x64"
  },
  "workspace": {
    "detectedProjectPath": "C:\\path\\to\\project"
  },
  "embeddings": {
    "useLocalEmbeddings": "true",
    "sqliteBindings": {
      "available": true
    }
  },
  "dependencies": {
    "treeSitter": { "available": true },
    "transformers": { "available": true }
  }
}
```

### `hints` - Project Structure Analysis

**Purpose**: Get high-level project structure, key files, and navigation hints.

**Usage**:
```bash
ambiance hints --json --project-path ./ --max-files 50
```

**Output Schema**:
```json
{
  "projectType": "typescript-node",
  "entryPoints": ["src/index.ts", "src/cli.ts"],
  "keyDirectories": {
    "source": "src/",
    "tests": "tests/",
    "config": "./"
  },
  "technologies": ["typescript", "jest", "node"],
  "fileCount": 234,
  "hints": [
    "Main entry point: src/index.ts",
    "CLI entry point: src/cli.ts",
    "Test files in tests/ directory"
  ]
}
```

**When to use**:
- First time exploring a codebase
- User asks "what does this project do?"
- Before diving into specific features
- To understand project organization

### `context` - Semantic Code Context

**Purpose**: Generate compact, semantically relevant code context for a query.

**Usage**:
```bash
ambiance context "authentication flow" --json --project-path ./ --max-tokens 2000
```

**Output Schema**:
```json
{
  "query": "authentication flow",
  "summary": "Authentication is handled through JWT tokens with middleware validation...",
  "relevantFiles": [
    {
      "path": "src/auth/middleware.ts",
      "relevance": 0.95,
      "snippet": "export function validateToken(req, res, next) {...}",
      "lineRange": [12, 45]
    }
  ],
  "totalTokens": 1847,
  "truncated": false
}
```

**When to use**:
- User asks about a specific feature or concept
- Need to understand how something works
- Preparing to implement changes
- Reviewing related code

**Task types**:
- Default: General understanding
- `--task-type implement`: Focus on implementation details
- `--task-type review`: Focus on architecture and patterns

**Output formats**:
- `--format json` (default): Semantic compression for LLM context
- `--format index`: Code navigation with jump points (see below)

#### Index Format (`--format index`)

The index format transforms `context` into a code navigation tool, returning structured jump points instead of compressed summaries.

**Usage**:
```bash
ambiance context "authentication" --format index --project-path ./ --max-tokens 2000
```

**Output Schema**:
```json
{
  "jumpTargets": [
    {
      "file": "C:\\path\\to\\src\\auth.ts",
      "symbol": "validateToken",
      "start": 42,
      "end": 89,
      "role": "interface",
      "confidence": 0.9,
      "relevance": 0.85,
      "why": ["export name matches: validateToken"],
      "snippet": "export function validateToken(req, res, next) {\n  const token = req.headers.authorization;\n  ..."
    }
  ],
  "byFile": {
    "src/auth.ts": [
      {"symbol": "validateToken", "start": 42, "confidence": 0.9, ...}
    ],
    "src/middleware.ts": [
      {"symbol": "authMiddleware", "start": 12, "confidence": 0.8, ...}
    ]
  },
  "answerDraft": "Authentication uses JWT tokens with validateToken function...",
  "nextActions": {
    "mode": "code_lookup",
    "openFiles": ["src/auth.ts:42-89", "src/middleware.ts:12-34"],
    "checks": ["find src/ -name \"*.md\" | head -5"]
  },
  "evidence": [
    "validateToken @ src/auth.ts:42",
    "parseToken @ src/utils.ts:15"
  ],
  "metadata": {
    "filesScanned": 278,
    "symbolsConsidered": 20,
    "bundleTokens": 1958,
    "processingTimeMs": 1027,
    "roleDistribution": {
      "interface": 5,
      "operation": 14,
      "dependency": 1
    }
  }
}
```

**Key fields**:
- `jumpTargets`: Array of code locations with precise file:line ranges
  - `role`: `interface` (exports, 90% confidence), `operation` (calls, 70%), or `dependency` (imports, 80%)
  - `confidence`: Score from 0.0 to 1.0 indicating match quality (AST-based)
  - `relevance`: Score from 0.0 to 1.0 indicating query importance (semantic-based)
  - `snippet`: Code preview (5-10 lines) extracted from the file
  - `why`: Explanation of why this location matched
- `byFile`: Jump targets grouped by file path (easier navigation)
- `nextActions.openFiles`: Top 3-5 files to examine next
- `evidence`: Quick reference list of symbol@file:line
- `metadata.roleDistribution`: Count of results by role (interface/operation/dependency)

**When to use index format**:
- IDE integration (jump to definition)
- Agent workflows needing precise code locations
- Building code navigation UIs
- Confidence-based result filtering
- Need actionable "next steps"
- Choosing where to run native `rg` or manual file inspection before AST searches

**When to use JSON format**:
- Minimize token usage for LLM prompts
- Need compressed code summaries
- Want compression statistics
- Building context for code generation

**Example workflows**:

```javascript
// 1. Filter by both confidence AND relevance for best results
const index = runAmbiance(['context', 'auth', '--format', 'index', '--project-path', './']);

const bestResults = index.jumpTargets.filter(
  t => t.confidence >= 0.85 && t.relevance >= 0.7
);

// 2. Navigate by file (open one file, jump to multiple symbols)
Object.entries(index.byFile).forEach(([file, targets]) => {
  console.log(`${file}: ${targets.length} symbols`);
  targets.forEach(t => console.log(`  - ${t.symbol} at line ${t.start}`));
});

// 3. Preview code before opening
const topTarget = index.jumpTargets[0];
console.log(`Preview:\n${topTarget.snippet}`);
if (isRelevant(topTarget.snippet)) {
  openInEditor(topTarget.file, topTarget.start);
}

// 4. Check result composition
const { interface, operation, dependency } = index.metadata.roleDistribution;
console.log(`Found ${interface} definitions, ${operation} usages, ${dependency} imports`);
```

### `debug` - Debug Context Extraction

**Purpose**: Extract likely root causes and related code from error logs.

**Usage**:
```bash
ambiance debug "TypeError: Cannot read property 'token' of undefined at auth.ts:42" \
  --json --project-path ./
```

**Output Schema**:
```json
{
  "parsedError": {
    "type": "TypeError",
    "message": "Cannot read property 'token' of undefined",
    "file": "auth.ts",
    "line": 42
  },
  "likelyFiles": [
    "src/auth.ts",
    "src/middleware/jwt.ts"
  ],
  "relatedFunctions": [
    "validateToken",
    "parseAuthHeader"
  ],
  "context": {
    "files": [
      {
        "path": "src/auth.ts",
        "relevantLines": [[38, 50]],
        "snippet": "..."
      }
    ]
  },
  "suggestions": [
    "Check if parseAuthHeader returns null",
    "Add null check before accessing token property"
  ]
}
```

**When to use**:
- User reports an error or exception
- Stack traces need interpretation
- Need to find related error-handling code

### `grep` - AST-Based Structural Search

**Purpose**: Find code patterns using Abstract Syntax Tree matching.

**Usage**:
```bash
ambiance grep "function \$NAME(\$ARGS) { \$BODY }" \
  --json --project-path ./ --language typescript

# Rule-mode (file)
ambiance grep --rule-path ./rules/no-console.yml \
  --json --project-path ./ --language typescript

# Rule-mode (inline JSON)
ambiance grep --rule-json '{"id":"no-console","language":"typescript","rule":{"pattern":"console.$METHOD($ARGS)"}}' \
  --json --project-path . --file-pattern "src/**/*.ts"
```

```powershell
# PowerShell: prefer single quotes so $ metavariables are not expanded
ambiance grep 'function $NAME($ARGS) { $BODY }' --json --project-path . --language typescript
```

**Output Schema**:
```json
{
  "pattern": "function $NAME($ARGS) { $BODY }",
  "language": "typescript",
  "matches": [
    {
      "file": "src/utils.ts",
      "line": 15,
      "match": "function parseToken(header: string) { return header.split(' ')[1]; }",
      "captures": {
        "NAME": "parseToken",
        "ARGS": "header: string",
        "BODY": "return header.split(' ')[1];"
      }
    }
  ],
  "totalMatches": 23,
  "engineUsed": "ast-grep",
  "degraded": false
}
```

**When to use**:
- Find all functions/classes matching a pattern
- Locate specific code structures
- Refactoring analysis
- Not recommended as first-pass text search in embedding-enabled sessions; run after index navigation

### `frontend` - Frontend Pattern Analysis

**Purpose**: Analyze frontend code patterns, components, and UI structure.

**Usage**:
```bash
ambiance frontend --json --project-path ./
```

**When to use**:
- Understanding React/Vue/Angular component structure
- UI-related queries
- Frontend architecture review

### `summary` - Single File Summary

**Purpose**: Get AST-based summary of a single file.

**Usage**:
```bash
ambiance summary src/auth.ts --json
```

**Output Schema**:
```json
{
  "file": "src/auth.ts",
  "language": "typescript",
  "exports": ["validateToken", "parseAuthHeader", "AuthMiddleware"],
  "imports": ["jsonwebtoken", "express"],
  "functions": [
    {
      "name": "validateToken",
      "line": 12,
      "parameters": ["req", "res", "next"],
      "async": false
    }
  ],
  "classes": [],
  "interfaces": ["AuthRequest"],
  "complexity": "medium"
}
```

**When to use**:
- Quick overview of a specific file
- Understanding file exports/API surface
- Checking dependencies

### `embeddings` - Embedding Management

**Purpose**: Manage semantic embeddings for the project.

**Actions**:
- `status`: Check embedding status
- `create`: Generate embeddings for the project
- `update`: Refresh stale embeddings
- `validate`: Verify embedding integrity

**Usage**:
```bash
# Check status
ambiance embeddings status --json --project-path ./

# Create embeddings
ambiance embeddings create --json --project-path ./ --force true

# Update stale embeddings
ambiance embeddings update --json --project-path ./
```

**Status Output Schema**:
```json
{
  "command": "embeddings",
  "exitCode": 0,
  "success": true,
  "projectId": "86bc5cbe7850",
  "projectPath": "C:\\path\\to\\project",
  "stats": {
    "totalChunks": 3000,
    "totalFiles": 183,
    "lastUpdated": "2026-02-12T13:25:19.000Z"
  },
  "coverage": {
    "embeddedFiles": 184,
    "indexableFiles": 241,
    "coveragePercent": 76.35
  }
}
```

### `packs` - Context Pack Workflows

**Purpose**: Create, manage, and reuse context packs for common scenarios.

**Actions**: `create`, `list`, `get`, `delete`, `template`, `ui`

**Usage**:
```bash
# Create a context pack
ambiance packs create --name "auth-system" --json

# List available packs
ambiance packs list --json

# Get a specific pack
ambiance packs get --name "auth-system" --json
```

## Parameter Guidelines

### `--max-tokens`

Controls the maximum size of returned context. Choose based on use case:

- **2000**: Quick context for small changes, bug fixes
- **3000-5000**: Comprehensive feature understanding
- **8000-10000**: Deep architectural analysis, major refactoring
- **15000+**: Broad system overview (use sparingly)

**Trade-off**: Higher values = more complete context but slower processing and higher LLM costs.

### `--max-files`

Controls breadth of file discovery. Choose based on scope:

- **50**: Focused feature area, single module
- **100**: Subsystem or related modules
- **200**: Broad architectural survey
- **500+**: Entire codebase (use for project-wide analysis)

**Trade-off**: Higher values = broader coverage but slower processing.

### `--project-path`

Explicitly specify the project directory:

- **Recommended**: Always use explicit `--project-path` for deterministic results
- **Auto-detection**: CLI will attempt to detect workspace root if omitted
- **Environment variable**: Set `WORKSPACE_FOLDER` for default path

```bash
# Explicit (recommended for agents)
ambiance context "auth" --json --project-path /path/to/project

# Auto-detect (may print detection message to stderr)
ambiance context "auth" --json
```

### `--task-type`

Influences context selection and summarization:

- **Default/omitted**: Balanced context for general understanding
- **`implement`**: Focus on implementation details, function signatures, patterns
- **`review`**: Focus on architecture, design patterns, testing coverage

## Complete Workflow Examples

### Example 1: Understanding a New Codebase

**Scenario**: User asks "How does authentication work in this project?"

```bash
# Step 1: Get project overview
ambiance hints --json --project-path ./

# Example output:
# {
#   "projectType": "typescript-express",
#   "keyDirectories": {"source": "src/", "tests": "tests/"},
#   "hints": ["Authentication middleware in src/auth/"]
# }

# Step 2: Get semantic context for authentication
ambiance context "authentication and authorization" \
  --json --project-path ./ --max-tokens 3000

# Example output:
# {
#   "summary": "Authentication uses JWT tokens with Express middleware...",
#   "relevantFiles": [
#     {"path": "src/auth/middleware.ts", "relevance": 0.95, ...},
#     {"path": "src/auth/jwt.ts", "relevance": 0.89, ...}
#   ]
# }
```

**Agent response**: "The project uses JWT-based authentication implemented in `src/auth/middleware.ts:12-45`. The middleware validates tokens and attaches user data to requests..."

### Example 2: Debugging an Error

**Scenario**: User reports "Getting 'undefined is not a function' in production logs"

```bash
# Step 1: Extract context from error log
ambiance debug "TypeError: undefined is not a function at processRequest (api.ts:142)" \
  --json --project-path ./

# Example output:
# {
#   "parsedError": {"file": "api.ts", "line": 142},
#   "likelyFiles": ["src/api.ts", "src/middleware/validator.ts"],
#   "relatedFunctions": ["processRequest", "validateInput"],
#   "suggestions": ["Check if validateInput is imported correctly"]
# }

# Step 2: Get detailed context for the problematic area
ambiance context "processRequest function and related validation" \
  --json --project-path ./ --max-tokens 2000

# Example output shows the function definition and reveals the issue
```

**Agent response**: "The error occurs at `src/api.ts:142` in the `processRequest` function. The issue is that `validateInput` is conditionally imported and may be undefined when..."

### Example 3: Implementing a New Feature

**Scenario**: User asks "Add rate limiting to the API"

```bash
# Step 1: Understand current middleware structure
ambiance hints --json --project-path ./

# Step 2: Get implementation-focused context
ambiance context "middleware and request handling" \
  --json --project-path ./ --max-tokens 3000 --task-type implement

# Example output:
# {
#   "relevantFiles": [
#     {"path": "src/middleware/index.ts", "snippet": "app.use(cors())...", ...},
#     {"path": "src/app.ts", "snippet": "Middleware registration", ...}
#   ]
# }

# Step 3: Find existing middleware patterns
ambiance grep "app.use(\$MIDDLEWARE)" --json --project-path ./ --language typescript

# Example output shows all middleware registration points
```

**Agent response**: "I'll add rate limiting middleware similar to the existing CORS middleware at `src/middleware/index.ts:8`. Here's the implementation..."

### Example 4: Code Review

**Scenario**: User asks "Review the authentication implementation for security issues"

```bash
# Step 1: Get review-focused context
ambiance context "authentication security validation error handling" \
  --json --project-path ./ --max-tokens 5000 --task-type review

# Step 2: Find all authentication-related functions
ambiance grep "function \$NAME(\$ARGS) { \$BODY }" \
  --json --project-path ./ --language typescript | \
  # (filter for auth-related files)

# Step 3: Check frontend integration if applicable
ambiance frontend --json --project-path ./
```

**Agent response**: "Security review of authentication implementation:
1. JWT secret is hardcoded in `src/auth/config.ts:5` - should use environment variable
2. No rate limiting on login endpoint `src/routes/auth.ts:12`
3. Tokens don't expire (missing exp claim in `src/auth/jwt.ts:23`)..."

## Error Handling

### Exit Codes

- **0**: Success
- **1**: Runtime error
- **2**: Usage error (invalid arguments, unsupported command combinations)

### Common Error Scenarios

#### Embeddings Not Initialized

```bash
ambiance context "auth" --json --project-path ./
```

**Error**:
```json
{
  "error": "Embeddings not initialized for project",
  "suggestion": "Run: ambiance embeddings create --json --project-path ./ --force true",
  "fallback": "Using basic text search (results may be less accurate)"
}
```

**Resolution**: Run `ambiance embeddings create --json --project-path ./ --force true`

#### Invalid Project Path

```bash
ambiance hints --json --project-path /invalid/path
```

**Error**:
```json
{
  "error": "Project path does not exist or is not accessible",
  "path": "/invalid/path"
}
```

**Resolution**: Verify path exists or use `--project-path ./` for current directory

#### Empty Results

```bash
ambiance context "nonexistent feature" --json --project-path ./
```

**Output**:
```json
{
  "query": "nonexistent feature",
  "summary": "No relevant code found for this query",
  "relevantFiles": [],
  "totalTokens": 0,
  "suggestions": [
    "Try broader search terms",
    "Check if embeddings are up to date",
    "Verify spelling of technical terms"
  ]
}
```

**Agent action**: Rephrase query, try `hints` for project overview, or use `grep` with patterns

#### Stale Embeddings

```bash
ambiance embeddings status --json --project-path ./
```

**Output**:
```json
{
  "command": "embeddings",
  "success": true,
  "stats": {
    "totalChunks": 0
  },
  "coverage": {
    "coveragePercent": 42.0
  },
  "suggestion": "Run: ambiance embeddings update --json --project-path ./"
}
```

**Resolution**: Run `ambiance embeddings update --json --project-path ./`

### Error Handling Pattern for Agents

```javascript
function runAmbianceWithFallback(args) {
  const res = spawnSync('ambiance', [...args, '--json'], { encoding: 'utf8' });

  if (res.status !== 0) {
    const errorOutput = res.stdout || res.stderr;

    try {
      const errorJson = JSON.parse(errorOutput);

      // Check for embeddings error
      if (errorJson.error?.includes('Embeddings not initialized')) {
        console.log('Creating embeddings...');
        spawnSync('ambiance', ['embeddings', 'create', '--json', '--project-path', './', '--force', 'true']);
        // Retry original command
        return runAmbianceWithFallback(args);
      }

      throw new Error(errorJson.error || errorOutput);
    } catch {
      throw new Error(errorOutput);
    }
  }

  return JSON.parse(res.stdout);
}
```

## Output Schemas

All commands with `--json` flag return structured JSON. See [Command Reference](#command-reference) for detailed schemas per command.

### Common Fields

JSON outputs generally include:
- `success`: Boolean indicating command success (may be omitted if `true`)
- `error`: String describing error (only present on failure)
- `warnings`: Array of non-fatal warnings (optional)
- `command`: Top-level command name in JSON envelope mode
- `exitCode`: Numeric CLI exit code in JSON envelope mode

## Integration Examples

### Basic Shell Integration

```bash
# Store output in variable
HINTS=$(ambiance hints --json --project-path ./)
echo "$HINTS" | jq '.projectType'

# Pipe to jq for processing
ambiance context "authentication" --json --project-path ./ | \
  jq -r '.relevantFiles[].path'

# Check exit code
if ambiance doctor --json > /dev/null 2>&1; then
  echo "Environment ready"
else
  echo "Setup required"
fi
```

### Node.js Integration

```javascript
import { spawnSync } from 'node:child_process';

function runAmbiance(args) {
  const res = spawnSync('ambiance', [...args, '--json'], { encoding: 'utf8' });
  if (res.status !== 0) throw new Error(res.stdout || res.stderr);
  return JSON.parse(res.stdout);
}

// Check environment
const status = runAmbiance(['embeddings', 'status', '--project-path', process.cwd()]);
const hasEmbeddings = Boolean(status.stats?.totalChunks > 0);
if (!hasEmbeddings) {
  console.log('Initializing embeddings...');
  runAmbiance(['embeddings', 'create', '--project-path', process.cwd(), '--force', 'true']);
}

// Get project hints
const hints = runAmbiance(['hints', '--project-path', process.cwd(), '--max-files', '50']);
console.log(`Project type: ${hints.projectType}`);

// Query for context
const context = runAmbiance([
  'context',
  'authentication flow',
  '--project-path',
  process.cwd(),
  '--max-tokens',
  '2000',
]);

console.log(`Found ${context.relevantFiles.length} relevant files`);
context.relevantFiles.forEach(file => {
  console.log(`- ${file.path} (relevance: ${file.relevance})`);
});
```

### Python Integration

```python
import subprocess
import json
import sys

def run_ambiance(args):
    result = subprocess.run(
        ['ambiance'] + args + ['--json'],
        capture_output=True,
        text=True
    )

    if result.returncode != 0:
        raise Exception(result.stdout or result.stderr)

    return json.loads(result.stdout)

# Check embedding readiness
status = run_ambiance(['embeddings', 'status', '--project-path', '.'])
has_embeddings = status.get('stats', {}).get('totalChunks', 0) > 0
print(f"Embeddings ready: {has_embeddings}")

# Get context
context = run_ambiance([
    'context',
    'error handling',
    '--project-path',
    '.',
    '--max-tokens',
    '3000'
])

for file in context['relevantFiles']:
    print(f"{file['path']}: {file['relevance']}")
```

## Included Workflows

Pre-configured workflow templates in `skills/ambiance/workflows/*.json`:

- **`understand`**: `hints` → `context` (general understanding)
- **`debug`**: `debug` (error analysis)
- **`implement`**: `hints` → `context --task-type implement` (implementation prep)
- **`review`**: `context --task-type review` (code review)

## Validation

Before relying on skill templates in production:

```bash
ambiance skill verify --json
```

Expected output:
```json
{
  "command": "skill",
  "exitCode": 0,
  "success": true,
  "timestamp": "2026-02-06T22:56:22.923Z",
  "doctor": {
    "success": true,
    "timestamp": "2026-02-06T22:56:22.919Z"
  },
  "skills": {
    "workflows": ["debug.json", "implement.json", "review.json", "understand.json"],
    "recipes": ["context.json", "debug.json", "doctor.json", "embeddings-status.json"]
  }
}
```

## MCP Migration Bridge

For MCP-hosted agents that still reference legacy tool names:

```bash
ambiance migrate mcp-map --json
```

This command returns the canonical MCP-tool → CLI-command mapping. See `MIGRATION.md` for full migration guide.
