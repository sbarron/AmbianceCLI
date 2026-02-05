# Ambiance CLI Development Plan

Date: 2026-02-04  
Status: Proposed (implementation-ready)  
Owner: Ambiance maintainers

## 1) Executive Summary

Ambiance should move from an MCP-first distribution model to a CLI-first product with an Agent Skill integration layer as the preferred usage path.

This plan keeps the strongest local capabilities (semantic compaction, AST analysis, embedding management, debug context, context packs), removes MCP-specific runtime coupling from the core execution path, and ships MCP as a compatibility adapter rather than the primary interface.

## 2) Product Direction

### Primary Interfaces (target)
1. **Ambiance CLI (primary)**: direct local commands, scriptable JSON output, stable command contracts.
2. **Agent Skill (primary for agent workflows)**: opinionated prompts/workflows that invoke CLI commands.
3. **MCP Adapter (compatibility mode)**: optional layer for existing MCP hosts.

### Goals
- Make CLI the default and most reliable runtime path.
- Keep all high-value local analysis capabilities.
- Minimize startup side effects and runtime surprises.
- Preserve migration path for existing MCP users.

### Non-Goals
- Rewriting core compactor/retrieval logic from scratch.
- Removing all cloud/provider integrations immediately.
- Breaking existing users without deprecation guidance.

## 3) Current Features to Maintain

These remain in scope and should be first-class in CLI:

### Core Local Analysis
- `context` (local semantic compaction / local context generation)
- `hints` (project architecture and navigation hints)
- `summary` (single-file AST summary)
- `debug` (local debug context extraction)
- `grep` (ast-grep structural search)

### Embeddings and Indexing
- `embeddings` action model (`status`, `create`, `update`, `validate`, `check_stale`, project management actions)
- Automatic/managed local embedding generation
- File-change-based incremental behavior

### Context Pack Workflows
- Context pack create/list/get/delete/template workflows
- Local UI mode for context pack generation (`ui`)

### AI/Provider Features (kept, modularized)
- Multi-provider support via OpenAI-compatible adapter path
- Comparison workflow (`compare`)
- AI-focused commands as optional capabilities (gated by keys)

### Operational Capabilities
- Cross-platform CLI execution (Windows/macOS/Linux)
- Structured JSON output for automation
- Offline-first local workflows

## 4) Features to Remove / Deprecate

### Remove from Primary Path (Phase-out)
- **MCP as default startup mode** (no-arg stdio server behavior)
- **MCP-only tool registration as product center**
- **MCP-specific naming as primary branding/documentation focus**

### Deprecate (with compatibility window)
- MCP transport bootstrap as default user entrypoint
- Tool-definition-first product docs (replace with command-first docs)
- Dual meaning for short flags that create ambiguity (ex: `-v`)

### Keep only as optional adapter
- `@modelcontextprotocol/sdk` server wiring
- MCP request/response transport wrappers
- Tool schema registration for MCP hosts

## 5) Target Architecture

## 5.1 Layering

1. **Runtime Core (`src/runtime`)**
   - Pure business logic and orchestration
   - No MCP transport dependency
   - No import-time side effects

2. **Command Layer (`src/commands`)**
   - CLI command handlers and argument normalization
   - Stable JSON/text output mapping

3. **Adapter Layer**
   - **CLI Adapter** (primary)
   - **MCP Adapter** (compatibility)
   - Future adapters (HTTP/service) if needed

4. **Skill Layer (`skills/ambiance`)**
   - Agent-oriented command recipes
   - Prompt templates invoking CLI commands

## 5.2 Proposed Package Structure

- `@jackjackstudios/ambiance-cli` (primary package)
- `@jackjackstudios/ambiance-cli-mcp-adapter` (optional compatibility package)

Initial transition can keep one package with two entrypoints, then split when stable.

## 6) Full Development Plan (Phased)

## Phase 0 - Stabilization (Immediate)

Purpose: remove current blockers before migration.

### Work
- Fix logger safe serialization for context payloads (avoid circular JSON crashes).
- Fix `embeddings status` failure path.
- Resolve CLI short-flag ambiguity (`-v` version vs verbose).
- Remove noisy import-time side effects in lightweight commands (`--help`, `--version`).
- Repair enhanced runner portability (`tests/runTests.js` root path + command invocation).

### Exit Criteria
- `node dist/src/cli.js embeddings status --format json` succeeds on clean environments.
- `--version` and `--help` run without heavy subsystem initialization.
- Enhanced test runner works on Windows and Unix.

## Phase 1 - Core/Adapter Separation

Purpose: decouple MCP transport from runtime logic.

### Work
- Introduce `runtime` service interfaces for all command/tool operations.
- Move command-executable logic from tool modules into shared runtime services.
- Keep MCP handlers as thin wrappers that call runtime services.
- Remove MCP SDK type dependency from shared runtime code.

### Exit Criteria
- CLI commands run through runtime services only.
- MCP adapter depends on runtime, not vice versa.
- Unit tests cover runtime services without MCP bootstrapping.

## Phase 2 - CLI UX and Contract Hardening

Purpose: make CLI the stable product interface.

### Work
- Define command contract spec (args, output schema, exit codes).
- Add strict JSON mode guarantees for all commands.
- Normalize command naming and help text.
- Add `doctor` command for environment/readiness diagnostics.
- Add explicit `--no-embeddings` and `--embeddings` style toggles where needed.

### Exit Criteria
- Command reference docs are complete and tested.
- JSON outputs validated in tests for all commands.
- No command requires MCP concepts in help/docs.

## Phase 3 - Agent Skill Productization

Purpose: make Agent Skill the preferred workflow layer.

### Work
- Add `skills/ambiance` with:
  - capability map
  - command recipes
  - common workflows (`understand`, `debug`, `implement`, `review`)
  - guardrails for token budgets and result shaping
- Add examples for Codex-style and generic agent usage.
- Add `ambiance skill verify` command to validate environment and command availability.

### Progress Update (2026-02-05)
- Completed: `skills/ambiance/README.md` with Codex-style and generic agent examples.
- Completed: Workflow E2E coverage that executes all `skills/ambiance/workflows/*.json` steps through CLI with JSON assertions.
- Completed: Skill validation wired into check/publish scripts (`verify:skills`) so invalid skill templates fail release flows.
- Remaining for full phase exit: complete Phase 4 docs migration (root README CLI-first + migration guide).

### Exit Criteria
- Skill documentation and templates are versioned with CLI release.
- End-to-end workflows execute through CLI only.

## Phase 4 - Compatibility and Migration Release

Purpose: ship CLI-first while preserving MCP users temporarily.

### Work
- Publish CLI-first docs and migration guide.
- Keep MCP adapter with deprecation notice and timeline.
- Add mapping table from MCP tool names to CLI commands.
- Provide compatibility examples for legacy users.

### Progress Update (2026-02-05)
- Completed: root `README.md` rewritten to CLI-first usage and command surface.
- Completed: migration guide added (`MIGRATION.md`) with MCP -> CLI mapping and checklist.
- Completed: `migrate mcp-map` documented prominently as the bridge for compatibility workflows.
- Remaining for phase completion: keep README/migration docs in sync with final release messaging and deprecation timeline.

### Exit Criteria
- CLI is default in README/install docs.
- MCP adapter is clearly marked compatibility-only.
- Existing MCP users can migrate with documented steps.

## Phase 5 - MCP De-Emphasis / Optional Extraction

Purpose: reduce maintenance burden once adoption is stable.

### Work
- Option A: keep adapter in-repo as optional module.
- Option B: split adapter to separate package/repo.
- Remove MCP-first language from remaining docs and scripts.

### Exit Criteria
- Core release cadence independent from MCP adapter changes.
- Issue triage distinguishes CLI core vs adapter issues.

## 7) Command Migration Map

| Current MCP Tool | CLI Command | Notes |
|---|---|---|
| `local_context` | `ambiance context` | Primary workflow command |
| `local_project_hints` | `ambiance hints` | Keep structured/json formats |
| `local_file_summary` | `ambiance summary <file>` | Preserve symbol options |
| `local_debug_context` | `ambiance debug "<log text>"` | Support file/log input mode |
| `ast_grep_search` | `ambiance grep "<pattern>"` | Keep AST pattern validation |
| `manage_embeddings` | `ambiance embeddings <action>` | Keep action model |
| context pack tools | `ambiance packs ...` (or existing subcommands) | Normalize naming |
| AI tools | `ambiance ai ...` / `ambiance compare` | Keep key-gated behavior |

## 8) Release Plan

## v0.3.0 (CLI-First Beta)
- CLI as documented default.
- MCP supported via compatibility mode.
- Deprecation warnings for MCP-first usage patterns.

## v0.4.0 (CLI + Skill Mature)
- Agent Skill released and documented as preferred integration.
- Runtime/adapters fully separated.
- Strong JSON command contracts finalized.

## v1.0.0 (CLI Stable)
- CLI and skill are official stable interfaces.
- MCP adapter remains optional or split package.
- Breaking changes only where migration path is documented.

## 9) Testing and Quality Gates

### Required Test Layers
- Unit tests for runtime services (no transport dependencies).
- CLI contract tests (args, exit codes, JSON schema output).
- Cross-platform smoke tests (Windows/macOS/Linux).
- Embedding lifecycle tests (cold start, stale update, failure fallback).
- Migration tests (MCP adapter -> runtime parity).

### Release Gates
- `npm run build` passes.
- `npm test` and enhanced test runner pass.
- Lint/format checks pass.
- CLI smoke tests pass:
  - `--help`
  - `--version`
  - `hints`
  - `context`
  - `embeddings status`

## 10) Risks and Mitigations

### Risk: Hidden import-time side effects
- **Mitigation**: lazy-load heavy modules and singleton initialization.

### Risk: Embedding native dependency issues across platforms
- **Mitigation**: explicit diagnostics, fallback behavior, preflight checks, better errors.

### Risk: Breaking existing MCP users
- **Mitigation**: compatibility adapter + deprecation window + migration docs.

### Risk: Command contract drift
- **Mitigation**: schema-based JSON output tests and versioned contract docs.

## 11) Implementation Backlog (Actionable)

1. Fix logger safe serialization and raw `Error` logging paths.
2. Fix `embeddings status` circular error failure path.
3. Resolve CLI flag ambiguity and command parser normalization.
4. Refactor runtime services out of tool/adapter modules.
5. Add CLI contract test suite and command schema docs.
6. Build Agent Skill package with workflow templates.
7. Publish migration docs and MCP compatibility guidance.
8. Prepare CLI-first release cut and changelog.

## 12) Definition of Done

This initiative is complete when:
- CLI is the documented and operational default interface.
- Agent Skill workflows are officially supported and versioned.
- MCP is optional compatibility only.
- Core functionality parity is preserved or improved.
- Release quality gates pass consistently across supported platforms.
