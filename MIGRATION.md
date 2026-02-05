# MCP to CLI Migration Guide

This project is CLI-first as of the current transition plan.

- Primary interface: `ambiance` CLI
- Compatibility interface: MCP adapter/workflows (legacy hosts)

Use the live mapping at any time:

```bash
ambiance migrate mcp-map --json
```

## Quick Migration Checklist

1. Replace MCP tool calls with CLI command invocations.
2. Force JSON mode (`--json`) in agent/tool wrappers.
3. Add explicit `--project-path` where possible.
4. Validate environment and skill templates:
   - `ambiance doctor --json`
   - `ambiance skill verify --json`

## Tool Mapping

| MCP tool | CLI command | Notes |
|---|---|---|
| `local_context` | `ambiance context "<query>" --json` | Primary workflow command |
| `local_project_hints` | `ambiance hints --json` | Project structure and navigation |
| `local_file_summary` | `ambiance summary <file> --json` | Single file AST summary |
| `frontend_insights` | `ambiance frontend --json` | Frontend analysis |
| `local_debug_context` | `ambiance debug "<log text>" --json` | Debug context extraction |
| `ast_grep_search` | `ambiance grep "<pattern>" --json` | Structural AST search |
| `manage_embeddings` | `ambiance embeddings <action> --json` | Embedding lifecycle and workspace |
| Context pack tools | `ambiance packs <create|list|get|delete|template|ui> --json` | Context pack workflows |
| AI tools | `ambiance compare --json` | Additional AI subcommands may be added |

## Legacy Command Name Note

Older docs/examples may use a legacy executable alias.
Use `ambiance` for current CLI workflows.

## Compatibility Scope

MCP remains a compatibility layer during migration. New workflows and docs target CLI first.

For authoritative mapping in automation, prefer `ambiance migrate mcp-map --json` over hardcoding.
