---
name: ambiance
description: CLI-first code context and analysis for agent workflows. Use when an agent needs deterministic local project understanding, semantic context retrieval, AST pattern search, debug-context extraction from logs, embeddings lifecycle management, context-pack workflows, or MCP-to-CLI migration mapping via the `ambiance` command.
---

# Ambiance Skill

Use `ambiance --json` commands as the primary interface for automation.

## STOP — Read Before Using

Before running any ambiance command, internalize these rules. Skipping this section leads to noisy results, wasted queries, and premature tool-switching.

### 1. Write symbol-anchored queries, not keyword dumps
The single biggest factor in result quality is query specificity.

- **Strong** (specific symbols): `"generateThumbnailForKey presignR2GetUrl cf.image uploadR2Object"` → 1 file, 4 relevant symbols, zero noise
- **Weak** (generic keywords): `"image upload thumbnail generation R2 storage cf.image transform resize"` → 10 files, 20 symbols, 40% noise

Always include concrete function names, class names, or identifiers you already know. If you don't know any yet, use `ambiance hints` or `ambiance summary` first to discover them, then re-query with the symbols you find.

### 2. Pick the right format before running
- **Default `context`** (no `--format` flag): Returns focused, low-noise results organized by symbols and relationships. Best when you need to understand what functions exist and how they connect. Use with specific symbol names for surgical precision.
- **`--format index`**: Returns file:line jump targets with more results but more noise. Use when you need line numbers to navigate to, or for broad "where is X referenced" sweeps.

**Default to `context` (no format flag).** Only switch to `--format index` when you specifically need line-number jump targets.

### 3. Complete the ambiance workflow — do NOT bail out early
Agents have a strong bias toward built-in tools (Read, Grep, Glob). Resist this:
- Do NOT get file paths from step 2 then abandon ambiance to use Read/Grep directly
- Do NOT run parallel manual searches alongside ambiance — complete the ambiance workflow first
- Use `ambiance grep` for structural narrowing and `ambiance summary` for file-level detail before falling back to raw text search

### 4. Understand what ambiance returns
The `answerDraft` field in results is **extracted metadata** (symbols, relationships, signatures), not generated summary text. Do not evaluate it as a prose summary or dismiss it as "hallucinated." It is deterministic AST/embedding output.

## Core Workflow

1. Run `ambiance embeddings status --json` only for first-run setup, environment changes, or command failures. Create embeddings if needed.
2. Start with semantic understanding (default format, symbol-anchored query):
   - `ambiance context "<symbol-anchored query>" --json --project-path <path> --auto-sync`
3. If you need line-number jump targets, follow up with index format:
   - `ambiance context "<query>" --format index --json --project-path <path> --auto-sync`
4. Narrow and confirm structure with AST search:
   - `ambiance grep "<ast pattern>" --json --project-path <path> --file-pattern "<glob>"`
5. Get file-level API/symbol extraction:
   - `ambiance summary <file> --json`
6. Fill exact details with lexical search only after ambiance steps are exhausted:
   - `rg -n "<term>" <path>` (fallback `grep -R`)
7. Use workflow-appropriate commands:
   - `hints`: `ambiance hints --json --project-path <path>` for structure discovery
   - `debug`: `ambiance debug "<log text>" --json --project-path <path>` for log-driven root-cause context
   - `frontend`: `ambiance frontend --json --project-path <path>` for UI architecture analysis
   - `packs`: `ambiance packs list --json` for reusable context bundles
8. Run `ambiance skill verify --json` when validating shipped skill artifacts.

## Format Selection Policy

| Goal | Format | Why |
|------|--------|-----|
| Understand what code does and how symbols relate | `context` (default) | Focused, low-noise, symbol-organized output |
| Find line numbers to jump to specific locations | `context --format index` | Returns file:line targets for navigation |
| Broad sweep for all references to a concept | `context --format index` | Casts a wider net, accepts more noise |
| Deep understanding of a single file's API | `summary <file>` | Complete symbol extraction for one file |

## Query Strategy

- Use **symbol-anchored** queries: include concrete function/class/variable names you know or discovered from prior steps.
- Include library-specific identifiers (e.g., `Hono`, `D1Database`, `R2Bucket`) to anchor results.
- Avoid conversational phrasing — ambiance uses semantic similarity, not Q&A.

**Examples:**
- Strong: `"presignR2GetUrl signQuery S3Client GetObjectCommand"` — specific symbols, tight results
- Strong: `"adminRoutes registerAdminRoutes Hono app.route"` — anchored to known identifiers
- Weak: `"how does the admin routing work"` — conversational, vague
- Weak: `"image upload thumbnail generation R2 storage cf.image transform resize"` — too many generic keywords, produces noisy results

## Search Routing Policy

1. Use `context` (default format) first for semantic understanding with symbol-anchored queries.
2. Use `context --format index` second when you need file:line jump targets.
3. Use `ambiance grep` third when AST structure/captures are required.
4. Use native text search last (`rg -n "<term>" <path>`, fallback `grep -R`) to fill exact details.
5. On large repos, apply scope early with `--file-pattern` and `--exclude`/`--exclude-patterns`.

## Index Hygiene

1. Prefer incremental freshness with `context --auto-sync` by default.
2. Use `embeddings status` for troubleshooting, maintenance, or explicit audits.
3. Use full rebuild (`embeddings create --force true`) only for migration or broken indexes.

## Expected Result

- Commands run non-interactively and return machine-readable JSON.
- Treat a command as successful only when process exit code is `0` and JSON `success` is not `false`.
- On failures, use the returned `suggestion`/error message and follow `skills/ambiance/TROUBLESHOOTING.md`.
- For command details and option discovery, use `ambiance <command> --help` and `ambiance skill recipe <name> --json`.

## Skill Assets

- Command/workflow capability map: `skills/ambiance/capabilities.json`
- Workflow templates: `skills/ambiance/workflows/*.json`
- Recipe templates: `skills/ambiance/recipes/*.json`
- CLI help: `ambiance --help`, `ambiance --help --expanded`, `ambiance <command> --help`
- CLI introspection: `ambiance skill list --json`, `ambiance skill workflow <name> --json`, `ambiance skill recipe <name> --json`
- Agent quick reference: `skills/ambiance/AGENT_GUIDE.md`
- Detailed docs: `skills/ambiance/README.md`
- Troubleshooting patterns: `skills/ambiance/TROUBLESHOOTING.md`
