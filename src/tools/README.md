## Ambiance Tools Directory (`src/tools`)

This directory hosts all MCP tool definitions, handlers, and utilities exposed by the Ambiance agent. Tools are organized into progressive capability tiers so a chat session can dynamically enable what’s available in the current environment (local-only, OpenAI-enabled, or Ambiance cloud + GitHub).

- Source: `src/tools`
- Single entry hub: `src/tools/index.ts`
- Categories: local, AI (OpenAI‑compatible), Ambiance (cloud), GitHub cloud, debug, shared utils

### Quick Start

- Import the central hub:
```ts
import {
  getAvailableTools,
  toolCategories,
  localHandlers,
  openaiCompatibleHandlers,
  ambianceHandlers,
  cloudToolHandlers,
} from './tools';
```
- Choose a mode and register tools with your MCP server or runtime:
```ts
const tools = getAvailableTools('essential'); // 'essential' | 'basic' | 'openai' | 'cloud' | 'all'
// Register `tools` and the corresponding handlers (see below for handler maps)
```

Modes map to categories in `index.ts`:
- essential: local tools only
- basic: local + ambiance (no OpenAI)
- openai: local + OpenAI‑compatible
- cloud: GitHub cloud tools
- all: everything available

### Environment and Dependencies

- Local tools: no external keys required. Pure AST/static analysis with optional embeddings powered by local/auto fallback.
- OpenAI‑compatible tools: requires `OPENAI_API_KEY` (and optionally `OPENAI_EMBEDDINGS_MODEL`).
- Ambiance cloud tools: requires `AMBIANCE_API_KEY` and optional `AMBIANCE_API_URL` (defaults to `https://api.ambiance.dev`).
- GitHub cloud tools: use Ambiance GitHub App integration through Ambiance API (`AMBIANCE_API_KEY`). No local file storage.

Recommended variables:
- `AMBIANCE_API_KEY`, `AMBIANCE_API_URL`
- `OPENAI_API_KEY`, `OPENAI_EMBEDDINGS_MODEL` (`text-embedding-3-large` default, 3072 dims)

### Handler Maps (name → function)

Register handlers matching tool names in your MCP host.

- Local (`src/tools/localTools/index.ts`):
```ts
export const localHandlers = {
  local_context: handleSemanticCompact,
  local_project_hints: handleProjectHints,
  local_file_summary: handleFileSummary,
  frontend_insights: handleFrontendInsights,
  local_debug_context: handleLocalDebugContext,
  manage_embeddings: handleManageEmbeddings,
  ast_grep_search: handleAstGrep,
};
```

- OpenAI‑compatible (`src/tools/aiTools/index.ts`):
```ts
export const openaiCompatibleHandlers = {
  ai_get_context: handleAISemanticCompact,
  ai_code_explanation: handleAICodeExplanation,
  ai_project_insights: handleAIProjectInsights,
  ai_debug: handleAIDebug,
};
```

- Ambiance cloud (`src/tools/ambianceTools/index.ts`):
```ts
export const ambianceHandlers = {
  ambiance_setup_project: handleSetupProject,
  ambiance_project_status: handleProjectStatus,
  ambiance_remote_query: handleRemoteQuery,
  ambiance_auto_detect_index: handleAutoDetectIndex,
  ambiance_index_project: handleIndexProject,
  ambiance_reset_indexes: handleResetIndexes,
  ambiance_start_watching: handleStartWatching,
  ambiance_stop_watching: handleStopWatching,
  ambiance_get_indexing_status: handleGetIndexingStatus,
};
```

- GitHub cloud (`src/tools/cloudTools/index.ts`):
```ts
export const cloudToolHandlers = {
  ambiance_search_github_repos: handleSearchGithubRepos,
  ambiance_list_github_repos: handleListGithubRepos,
  ambiance_get_context: handleGetGithubContextBundle,
  ambiance_get_graph_context: handleGetGraphContext,
};
```

### Tool Catalog

- Local tools (`src/tools/localTools`)
  - `local_context` (semanticCompact): Enhanced local context with AST‑grep, deterministic AnswerDraft, JumpTargets, MiniBundle, NextActions. Optional embeddings (auto-generated on first use).
  - `local_project_hints` (projectHints): Project navigation and architecture hints; supports `enhanced` format for capabilities/risks/next actions.
  - `local_file_summary` (fileSummary): Fast AST‑based file analysis with symbol extraction and complexity.
  - `manage_embeddings` (embeddingManagement): **Workspace & embedding management** - workspace configuration (get/set/validate), embedding status, health checks, migration, validation, and project maintenance. Replaces deprecated `workspace_config`.
  - `frontend_insights` (frontendInsights): Component/route/state/perf/accessibility insights for React frontends.
  - `local_debug_context` (debug/localDebugContext): Local debug bundle (errors, symbols, search matches).
  - `ast_grep_search` (localTools/astGrep): Structural code search (AST-based). Pattern is code-like, not regex. Use $UPPERCASE metavariables.

- OpenAI‑compatible tools (`src/tools/aiTools`)
  - `ai_get_context` (aiSemanticCompact): Cloud LLM assisted context compaction using OpenAI.
  - `ai_code_explanation` (aiCodeExplanation): Code explanation generation.
  - `ai_project_insights` (aiProjectInsights): Higher‑level insights via prompt suites.
  - `ai_debug` (debug/aiDebug): AI‑powered debug analysis.

- Ambiance cloud tools (`src/tools/ambianceTools`)
  - `ambiance_setup_project`: Auto‑detect, index, and configure a project with Ambiance.
  - `ambiance_project_status`: Health and configuration checks.
  - `ambiance_remote_query`: Direct cloud query by projectId.
  - Indexing suite: `ambiance_auto_detect_index`, `ambiance_index_project`, `ambiance_reset_indexes`, `ambiance_start_watching`, `ambiance_stop_watching`, `ambiance_get_indexing_status`.

- GitHub cloud tools (`src/tools/cloudTools`)
  - `ambiance_search_github_repos`: Search a specific indexed GitHub repository.
  - `ambiance_list_github_repos`: List available repositories via Ambiance GitHub App.
  - `ambiance_get_context`: Build a repository context bundle with token budgeting and hints.
  - `ambiance_get_graph_context`: Graph‑based repository context across one or more repos.

- Debug tools (`src/tools/debug`)
  - Arrays: `debugTools`, handlers: `debugHandlers`.
  - Tools are also referenced by local/ai categories for convenience.

- Shared utils (`src/tools/utils/toolHelpers.ts`)
  - `formatError`, `createToolResponse`, `validateToolInput`, `estimateTokens`, `truncateToTokens`, `cleanupLightweightTools`, `validateFilePath`.

### Typical Usage Patterns

- Get local context for a question:
```ts
await localHandlers['local_context']({
  query: 'How is database connection initialized?',
  taskType: 'understand',
  maxTokens: 3000,
  useProjectHintsCache: true,
});
```

- Run an AST‑Grep search (TypeScript example):
```ts
await localHandlers['ast_grep_search']({
  pattern: 'import $NAME from "express"',
  projectPath: 'C:/Dev/Ambiance',
  language: 'ts',
  maxMatches: 50,
  includeContext: true,
  contextLines: 3,
});
// Note: Patterns are structural, not regex. For multiple cases, run separate queries:
// 1) 'import $NAME from "express"'
// 2) 'const $NAME = require("express")'
// 3) 'express()'
```

- Generate project hints (enhanced):
```ts
await localHandlers['local_project_hints']({
  projectPath: 'C:/Dev/your-project',
  format: 'enhanced',
  maxFiles: 120,
  query: 'authentication flow',
});
```

- Summarize a file:
```ts
await localHandlers['local_file_summary']({
  filePath: 'C:/Dev/your-project/src/index.ts',
  includeSymbols: true,
  format: 'structured',
});
```

- GitHub context (Ambiance):
```ts
await cloudToolHandlers.ambiance_get_context({
  query: 'error handling policy',
  github_repo: 'owner/repo',
  token_budget: 6000,
});
```

### Capability Detection (Progressive Enhancement)

Use `getAvailableTools(mode)` from `src/tools/index.ts` to select tool sets based on environment. You can also introspect `toolCategories` for static arrays per tier.

- `essential` → `localTools`
- `basic` → `localTools + ambianceTools`
- `openai` → `localTools + openaiCompatibleTools`
- `cloud` → `cloudToolDefinitions`

### Notes and Best Practices

- **Embedding Behavior**: Local tools favor deterministic AST/static strategies first; embeddings are **automatically generated in background on first tool use** (non-blocking). File changes trigger incremental updates via 3-minute debounced watching.
- **Workspace Setup**: Use `manage_embeddings` with actions `get_workspace`, `set_workspace`, or `validate_workspace` for workspace configuration (replaces deprecated `workspace_config`).
- **AST-Grep Patterns**: Patterns are structural; avoid regex features like '|', '.*', or '/.../'. On Windows, we already avoid shell parsing, so characters won't be misinterpreted, but regex‑style patterns will still be rejected with a helpful error.
- **Model Changes**: When using embeddings locally and changing models, call `manage_embeddings` with actions like `status`, `validate`, or `migrate`.
- **API Routing**: For this project, prefer routing embedding/LLM calls through Ambiance server APIs when enabled.
- **GitHub Privacy**: GitHub cloud tools do not write local files; they consume Ambiance's indexed data for privacy/security.

### Maintenance

- Central re‑exports live in `src/tools/index.ts`.
- Adding a new tool: export its definition and handler from its module and add to the appropriate array/handler map in the category `index.ts`.
- Keep descriptions/input schemas accurate; downstream MCP hosts rely on these for schema validation.
