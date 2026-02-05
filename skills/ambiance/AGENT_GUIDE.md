# Ambiance Agent Quick Reference

Fast decision-making guide for agents using the Ambiance CLI.

## Command Selection Flow

```
User Request
    │
    ├─ "How does X work?" / "Explain Y" → context
    │
    ├─ "What's in this project?" / "Show me around" → hints
    │
    ├─ "Error: ..." / "Why is it failing?" → debug
    │
    ├─ "Find all functions named X" / "Where is pattern Y?" → grep
    │
    ├─ "What's in this file?" → summary
    │
    ├─ "Analyze the UI" / "How are components structured?" → frontend
    │
    └─ "Is everything set up?" → doctor
```

## Command Decision Matrix

| User Intent | Keywords | Command | Typical Params |
|-------------|----------|---------|----------------|
| Understand codebase | "how", "what", "explain", "where" | `context` | `--max-tokens 2000-5000` |
| First exploration | "overview", "structure", "architecture" | `hints` | `--max-files 50-100` |
| Debug error | "error", "failing", "broken", "exception" | `debug` | (error log as query) |
| Find pattern | "find all", "where is", "search for" | `grep` | AST pattern |
| File overview | "what's in [file]", "summary of [file]" | `summary` | (file path) |
| UI analysis | "components", "frontend", "UI", "React" | `frontend` | `--subtree src` |
| Check setup | "ready?", "working?", "installed?" | `doctor` | (no params) |
| Pre-implement | "add feature", "implement", "create" | `hints` → `context --task-type implement` | |
| Code review | "review", "check", "analyze quality" | `context --task-type review` | `--max-tokens 5000+` |

## Workflow Patterns

### Pattern 1: New Codebase Exploration

**Trigger**: User mentions unfamiliar code or asks general questions

```bash
# Step 1: Get overview
ambiance hints --json --project-path ./ --max-files 100

# Step 2: Drill into area of interest (based on hints output)
ambiance context "area-from-hints" --json --project-path ./ --max-tokens 3000
```

**Example**:
```
User: "What does this project do?"

Agent:
  1. hints → "Express API with TypeScript, main entry: src/index.ts"
  2. context "express api routes and middleware" → detailed code context
  3. Respond: "This is an Express API built with TypeScript..."
```

### Pattern 2: Debug Flow

**Trigger**: User reports error, provides stack trace, or says something is "broken"

```bash
# Step 1: Parse error with debug command
ambiance debug "${ERROR_LOG}" --json --project-path ./

# Step 2: If debug identifies files, get detailed context
ambiance context "${IDENTIFIED_AREA}" --json --project-path ./ --max-tokens 2000

# Step 3: If needed, find related patterns
ambiance grep "${PATTERN_FROM_ERROR}" --json --project-path ./
```

**Example**:
```
User: "Getting TypeError: Cannot read property 'id' of undefined at user.ts:42"

Agent:
  1. debug "TypeError: Cannot read property 'id' of undefined at user.ts:42"
     → identifies src/user.ts, src/models/user.ts
  2. context "user model and data access in user.ts"
     → reveals user object can be null
  3. Respond: "The error at user.ts:42 occurs when user is null..."
```

### Pattern 3: Implementation Prep

**Trigger**: User asks to add feature, implement functionality, or make changes

```bash
# Step 1: Understand existing structure
ambiance hints --json --project-path ./ --max-files 50

# Step 2: Get implementation context for related area
ambiance context "${RELATED_FEATURE}" --json --project-path ./ \
  --max-tokens 3000 --task-type implement

# Step 3: Find existing patterns to follow
ambiance grep "${PATTERN_TO_MATCH}" --json --project-path ./
```

**Example**:
```
User: "Add rate limiting to the API"

Agent:
  1. hints → identifies middleware in src/middleware/
  2. context "middleware and request handling" --task-type implement
     → shows existing middleware patterns
  3. grep "app.use($MIDDLEWARE)" → finds all middleware registration
  4. Implement following existing patterns
```

### Pattern 4: Code Review

**Trigger**: User asks to review, check, or analyze code quality

```bash
# Step 1: Get architectural overview
ambiance context "${AREA_TO_REVIEW}" --json --project-path ./ \
  --max-tokens 5000 --task-type review

# Step 2: Check specific patterns
ambiance grep "${SECURITY_PATTERN}" --json --project-path ./

# Step 3: Analyze frontend if applicable
ambiance frontend --json --project-path ./
```

**Example**:
```
User: "Review the authentication implementation"

Agent:
  1. context "authentication security validation" --task-type review
  2. grep "password|secret|token" → find security-sensitive code
  3. Analyze for issues: hardcoded secrets, weak validation, etc.
  4. Provide review with file:line references
```

### Pattern 5: Targeted Search

**Trigger**: User asks specific "where is" or "find all" questions

```bash
# For structural patterns → use grep
ambiance grep "${AST_PATTERN}" --json --project-path ./

# For semantic concepts → use context
ambiance context "${CONCEPT}" --json --project-path ./ --max-tokens 2000
```

**Example**:
```
User: "Find all API endpoints"

Agent (structural search):
  grep "app.get($PATH, $HANDLER)" → finds Express routes
  grep "app.post($PATH, $HANDLER)" → finds POST routes

User: "Where is authentication handled?"

Agent (semantic search):
  context "authentication and authorization logic" → semantic results
```

## Parameter Selection Guide

### `--max-tokens` (for `context`)

```
User Query Complexity → Token Budget

"Quick question" / "What does X do?"           → 2000
"How does feature Y work?"                     → 3000-5000
"Explain the architecture of Z"                → 5000-8000
"Comprehensive review of entire system"        → 10000+
```

**Rule of thumb**: Start with 2000, increase if results are truncated or incomplete.

### `--max-files` (for `hints`)

```
Scope → File Limit

"Main feature area"           → 50
"Subsystem or module"         → 100
"Broad overview"              → 150-200
"Entire large codebase"       → 300+
```

**Rule of thumb**: Use 100 as default, adjust based on project size from `doctor` output.

### `--task-type` (for `context`)

```
User Intent → Task Type

Understanding / Learning                       → (default/omitted)
"Implement" / "Add" / "Create"                → implement
"Review" / "Check" / "Analyze"                → review
```

## Common Query Patterns

### Good Queries (Semantic)

These work well with `context`:

- ✅ "user authentication and session management"
- ✅ "database connection and query handling"
- ✅ "error handling and logging"
- ✅ "API endpoint routing and middleware"
- ✅ "frontend component structure and state"

### Good Patterns (Structural)

These work well with `grep`:

- ✅ `function $NAME($$ARGS) { $$BODY }` - find all functions
- ✅ `class $NAME extends $BASE { $$BODY }` - find subclasses
- ✅ `import { $IMPORT } from '$MODULE'` - find imports
- ✅ `app.$METHOD($PATH, $HANDLER)` - find Express routes
- ✅ `export function $NAME($$ARGS)` - find exported functions

### Poor Queries

Avoid these patterns:

- ❌ "code" (too vague)
- ❌ "file" (too generic)
- ❌ "function" (use grep instead)
- ❌ "everything" (use hints instead)
- ❌ Single character or very short terms

## Pre-Flight Checks

### Session Start Checklist

Run once at the beginning of an agent session:

```bash
# 1. Verify environment
ambiance doctor --json

# 2. If embeddings not initialized or stale → fix it
ambiance embeddings status --json --project-path ./
# → If needed: ambiance embeddings create/update

# 3. Get initial project orientation
ambiance hints --json --project-path ./ --max-files 100
```

### Before Each Command

```javascript
// Always use explicit project path
const PROJECT_PATH = process.env.WORKSPACE_FOLDER || process.cwd();

// Always request JSON output
const args = [..., '--json', '--project-path', PROJECT_PATH];

// Always check exit codes
if (res.status !== 0) handleError(res);
```

## Response Construction

### Include File References

Always reference specific files and lines from command output:

```
❌ "The authentication is handled in the middleware"

✅ "Authentication is handled in src/auth/middleware.ts:12-45
   by the validateToken function"
```

### Provide Context from Output

Don't just reference, explain what you found:

```
❌ "Found in src/auth.ts"

✅ "The authentication uses JWT tokens (src/auth/jwt.ts:23),
   validated by middleware (src/auth/middleware.ts:12) before
   each protected route"
```

### Handle Empty Results Gracefully

```javascript
const result = runAmbiance(['context', query, '--json', '--project-path', './']);

if (result.relevantFiles.length === 0) {
  // Try fallback approaches
  return "I couldn't find specific code for that query. Let me try a broader search...";
  // Then try hints or grep
}
```

## Error Recovery

### Automatic Recovery Pattern

```javascript
function runWithRecovery(command, args, projectPath) {
  try {
    return runAmbiance([command, ...args, '--json', '--project-path', projectPath]);
  } catch (error) {
    if (error.message.includes('Embeddings not initialized')) {
      // Auto-initialize
      runAmbiance(['embeddings', 'create', '--json', '--project-path', projectPath]);
      // Retry
      return runAmbiance([command, ...args, '--json', '--project-path', projectPath]);
    }

    if (error.message.includes('stale')) {
      // Auto-update
      runAmbiance(['embeddings', 'update', '--json', '--project-path', projectPath]);
      // Retry
      return runAmbiance([command, ...args, '--json', '--project-path', projectPath]);
    }

    throw error; // Can't recover
  }
}
```

### Graceful Degradation

```javascript
// Try semantic search, fall back to structural
function findCode(query, projectPath) {
  try {
    // Try semantic first (best)
    return runAmbiance(['context', query, '--json', '--project-path', projectPath]);
  } catch {
    // Fall back to structural pattern matching
    const pattern = guessPattern(query);
    return runAmbiance(['grep', pattern, '--json', '--project-path', projectPath]);
  }
}
```

## Performance Tips

### Cache Project Hints

```javascript
// Run once per session, reuse results
const projectHints = runAmbiance(['hints', '--json', '--project-path', projectPath]);

// Use hints.projectType, hints.keyDirectories throughout session
```

### Start Narrow, Expand as Needed

```javascript
// Start with focused query
let result = runAmbiance([
  'context', query, '--json',
  '--project-path', projectPath,
  '--max-tokens', '2000'
]);

// If insufficient, expand
if (result.relevantFiles.length < 3 || result.truncated) {
  result = runAmbiance([
    'context', query, '--json',
    '--project-path', projectPath,
    '--max-tokens', '5000'
  ]);
}
```

### Batch Related Queries

```javascript
// Instead of multiple context calls, use one comprehensive query
// ❌ Bad:
const auth = runAmbiance(['context', 'authentication', ...]);
const authz = runAmbiance(['context', 'authorization', ...]);

// ✅ Good:
const authFull = runAmbiance(['context', 'authentication and authorization', ...]);
```

## Integration Checklist

For agents integrating Ambiance:

- [ ] Use explicit `--project-path` for all commands
- [ ] Always request `--json` output
- [ ] Check exit codes before parsing JSON
- [ ] Handle embeddings initialization gracefully
- [ ] Implement fallback strategies (context → grep → hints)
- [ ] Cache project hints for session
- [ ] Reference specific files and lines in responses
- [ ] Start with conservative token/file limits, expand as needed
- [ ] Run `doctor` at session start
- [ ] Validate JSON parsing (catch malformed output)

## Quick Command Reference

```bash
# Environment check
ambiance doctor --json

# Project overview
ambiance hints --json --project-path ./ --max-files 100

# Semantic search
ambiance context "query" --json --project-path ./ --max-tokens 3000

# Debug error
ambiance debug "error log" --json --project-path ./

# Structural search
ambiance grep "pattern" --json --project-path ./ --language typescript

# File summary
ambiance summary path/to/file.ts --json

# Frontend analysis
ambiance frontend --json --project-path ./

# Embeddings management
ambiance embeddings status --json --project-path ./
ambiance embeddings create --json --project-path ./
ambiance embeddings update --json --project-path ./

# Skill validation
ambiance skill verify --json
```

## See Also

- [Full README](./README.md) - Comprehensive documentation
- [TROUBLESHOOTING](./TROUBLESHOOTING.md) - Error diagnosis and resolution
- [MIGRATION](../../MIGRATION.md) - MCP to CLI migration guide
