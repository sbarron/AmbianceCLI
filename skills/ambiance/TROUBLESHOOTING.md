# Ambiance Troubleshooting Guide for Agents

This guide helps agents diagnose and resolve common issues when using the Ambiance CLI.

## Quick Diagnostic Flow

```
1. Run `ambiance doctor --json`
   ├─ success: false → See [Installation Issues](#installation-issues)
   └─ success: true → run `ambiance embeddings status --json --project-path ./`
      ├─ stats.totalChunks is 0/missing → See [Embeddings Not Initialized](#embeddings-not-initialized)
      ├─ coverage.coveragePercent is low → See [Stale Embeddings](#stale-embeddings)
      └─ Status healthy → See [Command-Specific Issues](#command-specific-issues)
```

## Installation Issues

### Symptom: `ambiance: command not found`

**Cause**: CLI not installed or not in PATH

**Resolution**:
```bash
# Check if installed globally
npm list -g ambiance-cli

# Install if missing
npm install -g ambiance-cli

# Verify installation
ambiance --version
```

### Symptom: `doctor` command fails with module errors

**Cause**: Incomplete installation or corrupted node_modules

**Resolution**:
```bash
# Reinstall CLI
npm uninstall -g ambiance-cli
npm install -g ambiance-cli

# Clear npm cache if needed
npm cache clean --force
```

## Embeddings Issues

### Embeddings Not Initialized

**Symptom**:
```json
{
  "error": "Embeddings not initialized for project",
  "fallback": "Using basic text search"
}
```

**Impact**: `context` and `debug` commands return less accurate results

**Resolution**:
```bash
# Create embeddings for the project
ambiance embeddings create --json --project-path ./ --force true

# Verify creation
ambiance embeddings status --json --project-path ./
```

**Expected output**:
```json
{
  "command": "embeddings",
  "success": true,
  "stats": {
    "totalChunks": 1234
  },
  "coverage": {
    "coveragePercent": 80.0
  }
}
```

**Agent pattern**:
```javascript
// Auto-initialize embeddings if needed
function ensureEmbeddings(projectPath) {
  const status = runAmbiance(['embeddings', 'status', '--project-path', projectPath]);
  const hasEmbeddings = (status.stats?.totalChunks || 0) > 0;

  if (!hasEmbeddings) {
    console.log('Initializing embeddings (this may take a few minutes)...');
    runAmbiance(['embeddings', 'create', '--project-path', projectPath, '--force', 'true']);
  }
}
```

### Stale Embeddings

**Symptom**:
```json
{
  "initialized": true,
  "stale": true,
  "staleSince": "2026-01-15T10:00:00Z"
}
```

**Cause**: Code files have been modified since embeddings were last generated

**Impact**: `context` and `debug` may miss recent code changes

**Resolution**:
```bash
# Update embeddings with recent changes
ambiance embeddings update --json --project-path ./
```

**When to update**:
- After significant code changes
- Before important context queries
- If `embeddings status` reports low coverage
- Periodically during long sessions

### Embedding Creation Fails

**Symptom**: `embeddings create` exits with error

**Common causes**:

1. **Insufficient disk space**:
   ```json
   {"error": "ENOSPC: no space left on device"}
   ```
   **Resolution**: Free up disk space (embeddings use ~50-200MB per project)

2. **Permission errors**:
   ```json
   {"error": "EACCES: permission denied"}
   ```
   **Resolution**: Check write permissions on `.ambiance/` directory

3. **Large codebase timeout**:
   ```json
   {"error": "Operation timeout"}
   ```
   **Resolution**: Break into smaller scopes or increase timeout

## Command-Specific Issues

### `context` Returns Empty Results

**Symptom**:
```json
{
  "query": "authentication",
  "relevantFiles": [],
  "suggestions": ["Try broader search terms"]
}
```

**Possible causes and resolutions**:

1. **Query too specific**:
   - **Resolution**: Use broader terms
   - Example: "JWT token validation" → "authentication" or "auth"

2. **Typo in query**:
   - **Resolution**: Check spelling of technical terms
   - Common issues: "authentification", "authorisation"

3. **Code doesn't exist**:
   - **Resolution**: Use `hints` to verify project structure
   - Confirm the feature exists in the codebase

4. **Embeddings not initialized**:
   - **Resolution**: See [Embeddings Not Initialized](#embeddings-not-initialized)

**Fallback pattern**:
```javascript
// Try progressively broader queries
const queries = [
  'JWT token validation in middleware',  // Specific
  'token validation',                    // Medium
  'authentication'                       // Broad
];

for (const query of queries) {
  const result = runAmbiance(['context', query, '--json', '--project-path', './']);
  if (result.relevantFiles.length > 0) {
    return result;
  }
}

// If all fail, use grep for pattern matching
return runAmbiance([
  'grep',
  'function $NAME($ARGS) { $BODY }',
  '--json',
  '--project-path',
  './',
  '--file-pattern',
  'src/auth/**/*.ts'
]);
```

### `debug` Doesn't Extract File/Line Info

**Symptom**:
```json
{
  "parsedError": {},
  "likelyFiles": []
}
```

**Cause**: Log text doesn't contain parseable file references

**Resolution**: Ensure log includes stack trace or file:line references

**Good log formats**:
- `at Object.<anonymous> (auth.ts:42:15)`
- `Error in src/auth/middleware.ts:42`
- `TypeError: ... at validateToken (src/auth.ts:42)`

**Bad log formats**:
- `Error: Something went wrong` (no file reference)
- `Failed to authenticate user` (no stack trace)

**Agent pattern**:
```javascript
// If debug fails, fall back to context with error keywords
function analyzeError(errorLog) {
  const debugResult = runAmbiance(['debug', errorLog, '--json', '--project-path', './']);

  if (debugResult.likelyFiles.length === 0) {
    // Extract keywords from error message
    const keywords = extractKeywords(errorLog); // e.g., "token", "undefined"
    return runAmbiance(['context', keywords.join(' '), '--json', '--project-path', './']);
  }

  return debugResult;
}
```

### `grep` Returns Too Many Results

**Symptom**: Hundreds or thousands of matches

**Cause**: Pattern too broad

**Resolution**: Make pattern more specific

**Examples**:

| Too Broad | Better |
|-----------|--------|
| `$FUNC($ARGS)` | `function validateToken($ARGS) { $BODY }` |
| `class $NAME` | `class $NAME extends BaseController` |
| `import $X` | `import { $IMPORT } from 'express'` |

**Agent pattern**:
```javascript
// If too many results, add constraints
function findWithConstraints(basePattern, maxResults = 50) {
  let result = runAmbiance(['grep', basePattern, '--json', '--project-path', './']);

  if (result.totalMatches > maxResults) {
    // Add file path constraint
    result = runAmbiance([
      'grep',
      basePattern,
      '--json',
      '--project-path',
      './',
      '--file-pattern',
      'src/auth/**/*.ts'
    ]);
  }

  return result;
}
```

### `hints` Shows Unexpected Project Type

**Symptom**: `projectType: "unknown"` or incorrect framework

**Cause**: Atypical project structure or missing key files

**Impact**: Reduced hint quality

**Resolution**: Check for key files manually

**Agent pattern**:
```javascript
function validateProjectType(hints) {
  if (hints.projectType === 'unknown') {
    // Manual detection
    const hasPackageJson = fileExists('package.json');
    const hasTsConfig = fileExists('tsconfig.json');
    const hasSrcDir = dirExists('src');

    // Provide manual context to user
    return {
      ...hints,
      manualDetection: {
        packageJson: hasPackageJson,
        typescript: hasTsConfig,
        structuredSource: hasSrcDir
      }
    };
  }
  return hints;
}
```

## Performance Issues

### Commands Are Slow

**Symptom**: Commands take > 10 seconds to complete

**Common causes**:

1. **Large codebase with high `--max-files`**:
   - **Resolution**: Reduce `--max-files` to 50-100
   - Use `--subtree` to limit scope

2. **Stale embeddings triggering regeneration**:
   - **Resolution**: Run `embeddings update` explicitly
   - Check `embeddings status` coverage and chunk counts

3. **First run after installation**:
   - **Expected**: Initial embedding creation is slow
   - **Resolution**: Wait for completion, subsequent runs are fast

**Optimization pattern**:
```javascript
// Use incremental specificity
function getContextFast(query) {
  // Start with limited scope
  let result = runAmbiance([
    'context', query,
    '--json',
    '--project-path', './',
    '--max-tokens', '2000',
    '--max-files', '50'
  ]);

  // If insufficient, expand
  if (result.relevantFiles.length < 3) {
    result = runAmbiance([
      'context', query,
      '--json',
      '--project-path', './',
      '--max-tokens', '5000',
      '--max-files', '150'
    ]);
  }

  return result;
}
```

## Project Path Issues

### Auto-Detection Fails

**Symptom**: Error messages reference wrong directory

**Cause**: Ambiguous workspace structure (monorepo, nested projects)

**Resolution**: Always use explicit `--project-path`

**Agent pattern**:
```javascript
// Never rely on auto-detection for agents
const PROJECT_PATH = process.env.WORKSPACE_FOLDER || process.cwd();

function runAmbianceWithPath(command, args) {
  return runAmbiance([command, ...args, '--project-path', PROJECT_PATH]);
}
```

### Relative vs Absolute Paths

**Issue**: Inconsistent behavior with relative paths

**Best practice**: Use absolute paths or `./` for current directory

**Examples**:
```bash
# Good
ambiance context "auth" --json --project-path ./
ambiance context "auth" --json --project-path /absolute/path/to/project

# Avoid
ambiance context "auth" --json --project-path ../other-project
```

## JSON Parsing Issues

### Invalid JSON Output

**Symptom**: `JSON.parse()` throws error

**Cause**: Error messages or warnings printed to stdout

**Resolution**: Parse stderr separately and check exit code

**Robust parsing pattern**:
```javascript
function runAmbianceSafe(args) {
  const res = spawnSync('ambiance', [...args, '--json'], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe']  // Separate stdout/stderr
  });

  // Check exit code first
  if (res.status !== 0) {
    // Try parsing stdout as JSON error
    try {
      const errorJson = JSON.parse(res.stdout);
      throw new Error(errorJson.error || 'Command failed');
    } catch {
      // Fall back to raw stderr
      throw new Error(res.stderr || res.stdout || 'Unknown error');
    }
  }

  // Parse successful output
  try {
    return JSON.parse(res.stdout);
  } catch (e) {
    throw new Error(`Invalid JSON output: ${res.stdout}`);
  }
}
```

## Recovery Patterns

### Cascading Fallback Strategy

When a command fails, use this fallback hierarchy:

```javascript
function getCodeContext(query, projectPath) {
  try {
    // 1. Try semantic context (best)
    return runAmbiance(['context', query, '--json', '--project-path', projectPath]);
  } catch (e) {
    if (e.message.includes('Embeddings not initialized')) {
      try {
        // 2. Initialize and retry
        runAmbiance(['embeddings', 'create', '--json', '--project-path', projectPath]);
        return runAmbiance(['context', query, '--json', '--project-path', projectPath]);
      } catch {
        // 3. Fall through to next fallback
      }
    }
  }

  try {
    // 4. Try AST grep if embeddings fail
    const pattern = queryToPattern(query); // Convert query to AST pattern
    return runAmbiance(['grep', pattern, '--json', '--project-path', projectPath]);
  } catch {
    // 5. Fall through
  }

  // 6. Last resort: just get hints
  return runAmbiance(['hints', '--json', '--project-path', projectPath]);
}
```

### Health Check Before Operations

```javascript
// Run at start of agent session
function checkEnvironment(projectPath) {
  const doctor = runAmbiance(['doctor', '--json']);
  const status = runAmbiance(['embeddings', 'status', '--json', '--project-path', projectPath]);
  const hasEmbeddings = (status.stats?.totalChunks || 0) > 0;
  const coveragePercent = status.coverage?.coveragePercent || 0;

  const issues = [];

  if (!doctor.success) {
    issues.push('CLI environment unhealthy');
  }

  if (!hasEmbeddings) {
    issues.push('Embeddings not initialized');
    runAmbiance(['embeddings', 'create', '--json', '--project-path', projectPath, '--force', 'true']);
  } else if (coveragePercent < 60) {
    issues.push('Embeddings coverage is low');
    runAmbiance(['embeddings', 'update', '--json', '--project-path', projectPath]);
  }

  return {
    ready: issues.length === 0,
    issues,
    doctor,
    status
  };
}
```

## Getting Help

If issues persist after following this guide:

1. **Verify CLI version**:
   ```bash
   ambiance --version
   ```

2. **Collect diagnostic info**:
   ```bash
   ambiance doctor --json > doctor-output.json
   ambiance embeddings status --json --project-path ./ > embeddings-status.json
   ```

3. **Check for known issues**: See project issue tracker

4. **Minimal reproduction**: Try command on a small test project to isolate issue

## Common Agent Anti-Patterns to Avoid

### Don't: Assume embeddings exist
```javascript
// BAD
const context = runAmbiance(['context', 'auth', '--json']);
```

### Do: Check and initialize
```javascript
// GOOD
ensureEmbeddings('./');
const context = runAmbiance(['context', 'auth', '--json', '--project-path', './']);
```

### Don't: Ignore exit codes
```javascript
// BAD
const result = JSON.parse(spawnSync('ambiance', ['context', query, '--json']).stdout);
```

### Do: Handle errors properly
```javascript
// GOOD
const res = spawnSync('ambiance', ['context', query, '--json']);
if (res.status !== 0) throw new Error(res.stderr);
const result = JSON.parse(res.stdout);
```

### Don't: Use vague queries
```javascript
// BAD
const context = runAmbiance(['context', 'code', '--json']);
```

### Do: Use specific, semantic queries
```javascript
// GOOD
const context = runAmbiance(['context', 'user authentication and session management', '--json']);
```

### Don't: Hardcode project path assumptions
```javascript
// BAD
const context = runAmbiance(['context', 'auth', '--json', '--project-path', '/src']);
```

### Do: Use environment-aware paths
```javascript
// GOOD
const projectPath = process.env.WORKSPACE_FOLDER || process.cwd();
const context = runAmbiance(['context', 'auth', '--json', '--project-path', projectPath]);
```
