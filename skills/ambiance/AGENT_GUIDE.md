# Ambiance Agent Quick Reference

Fast decision guide for agents using the `ambiance` CLI.

## Session Start

1. `ambiance doctor --json`
2. `ambiance embeddings status --json --project-path <path>`
3. If embeddings are missing: `ambiance embeddings create --json --project-path <path> --force true`
4. **Initial Orientation (IMPORTANT - Read This First)**:
   ```bash
   # Start with manifest for quick file/function overview
   ambiance manifest --exports-only --max-files 50 --format flat --json --project-path <path>

   # Then get project structure
   ambiance hints --json --project-path <path> --max-files 100
   ```

See **"Initial Project Discovery"** section below for multi-pass context strategy.

## Choose The Right Command

- **Quick file/function listing**: `ambiance manifest --exports-only --json --project-path <path>` (NEW!)
- Understand feature or architecture: `ambiance context "<query>" --json --project-path <path>`
- Get project overview: `ambiance hints --json --project-path <path>`
- Debug from logs: `ambiance debug "<log text>" --json --project-path <path>`
- Structural code search (AST-only): `ambiance grep "<ast pattern>" --json --project-path <path>`
- File summary: `ambiance summary <file> --json`
- Frontend mapping: `ambiance frontend --json --project-path <path>`

## Search Routing Rules

Use this order when embeddings/index are available:

1. Semantic understanding first (default format, symbol-anchored query):
   `ambiance context "<symbol-anchored query>" --json --project-path <path> --auto-sync`
2. Line-number navigation second (only when you need jump targets):
   `ambiance context "<query>" --format index --json --project-path <path> --auto-sync`
3. Structural confirmation third:
   `ambiance grep "<ast pattern>" --json --project-path <path>`
4. Lexical detail fill-in last:
   `rg -n "<term>" <path>` (or `grep -R` fallback), ideally scoped to files from prior steps

**Default to `context` (no format flag).** Only use `--format index` when you specifically need file:line jump targets.

Only use `ambiance grep` when the task explicitly needs AST structure/captures:
   - "find all functions/classes/import forms"
   - codemod/refactor pattern matching
   - syntactic queries where regex text search is noisy

**Do NOT abandon the ambiance workflow early** — complete context → grep → summary steps before falling back to Read/Grep/Glob.

Fallback (if embeddings/index are unavailable): start with native lexical search, then grep.

## Query Strategy: Symbol-Anchored Queries

The single biggest factor in result quality is query specificity. Use concrete function/class/variable names, not generic keywords.

**Rules:**
- Include specific symbol names you know or discovered from `hints`/`summary`/`manifest`
- Include library-specific identifiers (e.g., `Hono`, `D1Database`, `R2Bucket`)
- Avoid conversational phrasing — ambiance uses semantic similarity, not Q&A
- Fewer specific symbols beat many generic keywords

**Examples:**
- **Strong** (specific symbols): `"generateThumbnailForKey presignR2GetUrl cf.image uploadR2Object"` → 1 file, 4 symbols, zero noise
- **Strong** (library-anchored): `"Supabase auth session refresh middleware validateToken"` → focused results
- **Weak** (generic keywords): `"image upload thumbnail generation R2 storage cf.image transform resize"` → 10 files, 40% noise
- **Weak** (conversational): `"What is the status of auth?"` → poor retrieval

## Initial Project Discovery

⚠️ **CRITICAL**: Never mix frontend and backend symbols in first context query.

### The Problem with Broad Queries

❌ **DON'T DO THIS:**
```bash
# BAD: Mixed domains, no runtime context
ambiance context "IngestionService ComputationService Dashboard FastAPI APIClient"
```

**Why this fails:**
- Mixes 3 intents: backend services + API framework + frontend client
- Class names without runtime anchors get low relevance
- "Sticky" symbols (like `APIClient`) dominate, missing architecture
- Result: 1 file instead of 8-12

### Multi-Pass Strategy (Recommended)

✅ **DO THIS instead - run 3-4 focused passes:**

#### 1. Start with Manifest (Optional but Helpful)
```bash
ambiance manifest --exports-only --max-files 50 --format flat --json --project-path <path>
```
→ Quick scan of exported functions/classes to identify entry points

#### 2. Backend Topology First
```bash
ambiance context "python services main.py health_check scheduler loop run_ingestion_job run_generation_loop run_tracking_loop" \
  --format index --json --project-path <path> --auto-sync
```

**Why this works:**
- Entry point anchors (`main.py`, `health_check`)
- Runtime verbs (`loop`, `run_`, `scheduler`)
- Single domain (Python backend only)
- No frontend terms to confuse retrieval

#### 3. Infrastructure Second
```bash
ambiance context "redis stream marketforge:events xadd xreadgroup EventPublisher EventConsumer data_ingested signals_generated" \
  --format index --json --project-path <path>
```

**Focus:** Data stores, message brokers, event systems

#### 4. API Wiring Third
```bash
ambiance context "FastAPI include_router APIRouter monitoring charts data ml_builder event_stream health_checker" \
  --format index --json --project-path <path>
```

**Focus:** HTTP routes, endpoints, backend API structure (no frontend!)

#### 5. Frontend Last (if applicable)
```bash
ambiance context "react router Dashboard SignalsPage InsightsPage AlertsPage ChartsPage DataPage MLBuilderPage apiClient" \
  --format index --json --project-path <path>
```

**Focus:** Pure frontend - components, pages, client routing

### Query Construction Rules

#### ✅ USE THESE (High Signal):

| Category | Good Terms | Why |
|----------|-----------|-----|
| **Entry Points** | `main.py`, `index.ts`, `app.py`, `server.ts` | Actual runtime entry |
| **Schedulers** | `scheduler`, `loop`, `cron`, `interval`, `run_*` | Continuous processes |
| **Verbs** | `run_`, `process_`, `handle_`, `execute_` | Actions, not just nouns |
| **Infrastructure** | `redis`, `postgres`, `rabbitmq`, `kafka`, `stream` | Concrete tech |
| **Wiring** | `router`, `include_router`, `Blueprint`, `mount` | Connection points |
| **Events** | `xadd`, `publish`, `emit`, `dispatch`, `subscribe` | Data flow |

#### ❌ AVOID THESE (Low Signal):

| Category | Bad Terms | Why |
|----------|-----------|-----|
| **Bare Classes** | `UserService`, `DataProcessor` | No runtime context |
| **Generic** | `Service`, `Manager`, `Handler` | Too abstract |
| **Mixed Domains** | `APIClient` + `FastAPI` in same query | Frontend + backend |
| **Interfaces** | `IUserRepository`, `IDataStore` | Not runtime code |

### Expected Results

Good orientation should give you:

- **Backend:** 3-6 files covering entry points and services
- **Infrastructure:** 2-4 files showing connections and setup
- **API:** 3-5 files with routes and handlers
- **Frontend:** 4-8 files with components and routing
- **Total:** 12-25 unique files across all passes

### If Results Are Poor

**Symptom:** Only 1-2 files returned

**Likely Causes:**
- Mixed-domain query
- Using class names without verbs
- Embeddings not synced

**Fixes:**
- Split into separate backend/frontend passes
- Add entry point file names (`main.py`, `index.ts`)
- Use runtime verbs (`run_`, `loop`)
- Add `--auto-sync` flag
- Run `manifest` first to see what's available

**Recipe:** See `ambiance skill recipe orientation --json` for complete workflow

## Discover Full Details (No Doc Digging)

Use CLI help first to inspect current command flags and usage:

- `ambiance --help`
- `ambiance --help --expanded`
- `ambiance <command> --help` (examples: `ambiance context --help`, `ambiance embeddings --help`)

Use skill introspection commands as the canonical machine-readable source:

- List all templates: `ambiance skill list --json`
- Get a workflow definition: `ambiance skill workflow <understand|debug|implement|review> --json`
- Get command recipe details: `ambiance skill recipe <context|hints|debug|grep|summary|frontend|doctor|embeddings-status|packs-create|packs-list|packs-template> --json`

Examples:

- `ambiance skill workflow understand --json`
- `ambiance skill recipe context --json`
- `ambiance skill recipe embeddings-status --json`

## JSON And Reliability Rules

- Always pass `--json`.
- Always pass explicit `--project-path` for project-wide commands.
- Check `exitCode` and `success` before reading payload fields.
- Use `--quiet` when needed to suppress non-essential stderr logs.

## Command Pairing Patterns

- New codebase:
  1. `hints`
  2. `context`

- Error triage:
  1. `debug`
  2. `context --format index` on the identified area
  3. `grep` for AST-structural confirmation
  4. native `rg` in top files from `nextActions.openFiles`

- Implementation prep:
  1. `hints`
  2. `context --task-type implement --format index`
  3. `grep` to find existing AST coding patterns
  4. native `rg` in top files from `byFile`

- Review:
  1. `context --task-type review --format index`
  2. `grep` for security/anti-pattern AST checks
  3. native `rg` for risky terms/secrets and exact string evidence

## Context Format Choice

- **Default `context`** (no `--format` flag): Focused, low-noise results organized by symbols and relationships. Best with specific symbol names.
- **`--format index`**: File:line jump targets with confidence/relevance. More results but noisier.

Format policy:
1. **Default to `context` (no format flag)** for understanding what code does and how symbols relate.
2. Use `--format index` when you specifically need line-number jump targets for navigation.

When using index mode, use `jumpTargets`, `byFile`, and `nextActions.openFiles` to decide where to run text search and edits.

## Error Recovery

- Embeddings not initialized:
  `ambiance embeddings create --json --project-path <path> --force true`

- Embeddings stale:
  `ambiance context "<query>" --json --project-path <path> --auto-sync`
  or `ambiance embeddings update --json --project-path <path>`

## Index Hygiene

1. Check status first for deep investigations:
   `ambiance embeddings status --json --project-path <path>`
2. Prefer incremental freshness:
   use `context --auto-sync` or `embeddings update` for routine changes.
3. Use full rebuild only when needed:
   `embeddings create --force true` only for migration/incompatible model/corruption scenarios.

- If semantic results are weak:
  1. broaden `context` query
  2. increase `--max-tokens`
  3. switch to `grep` for deterministic structural search
