# Ambiance CLI

CLI-first local code context and analysis for agent workflows.

> MCP users: start with `ambiance migrate mcp-map --json` for the current CLI mapping.

## Install

```bash
npm install -g ambiance-cli
```

## Quick Start

```bash
ambiance --help
ambiance doctor --json
ambiance skill verify --json
```

## Automatic Embedding Sync

When `USE_LOCAL_EMBEDDINGS=true` (default), Ambiance automatically keeps embeddings fresh:

- **Auto-sync threshold**: Embeddings are checked and updated if they haven't been synced in 10 minutes (configurable)
- **Applies to**: All tools that use embeddings (primarily `context`)
- **Smart caching**: Avoids excessive checks (minimum 30s between checks)
- **Zero config**: Works automatically, no manual intervention needed

### Configuration

```bash
# Disable auto-sync (embeddings still work, but may be stale)
export EMBEDDING_AUTO_SYNC=false

# Change staleness threshold (default: 600000ms = 10 minutes)
export EMBEDDING_AUTO_SYNC_THRESHOLD_MS=300000  # 5 minutes

# Or use explicit --auto-sync flag
ambiance context "query" --auto-sync
```

## Core Commands

All commands support JSON mode via `--json`.

- `ambiance context "<query>" --json --project-path <path>`
- `ambiance hints --json --project-path <path>`
- `ambiance summary <file> --json`
- `ambiance manifest --json --project-path <path>` - **NEW**: Project-wide function listing
- `ambiance debug "<log text>" --json --project-path <path>`
- `ambiance grep "<ast pattern>" --json --project-path <path>`
- `ambiance frontend --json --project-path <path>`
- `ambiance embeddings <action> --json --project-path <path>`
- `ambiance packs <create|list|get|delete|template|ui> --json`
- `ambiance compare --prompt "<prompt>" --json`

## Agent Skill Workflows

Ambiance ships versioned skill templates in `skills/ambiance`.

- Validate templates: `ambiance skill verify --json`
- Workflow docs and examples: `skills/ambiance/README.md`
- Workflow files: `skills/ambiance/workflows/*.json`

## Migration from MCP

MCP remains available as a compatibility path, but CLI is now the primary interface.

- Bridge command: `ambiance migrate mcp-map --json`

## Notes for Automation

- Prefer `--json` for machine parsing.
- Non-zero exit codes are returned for usage/runtime failures.
- Use explicit `--project-path` for deterministic runs.

## Development

```bash
npm run build
npm run verify:skills
npm test
```

## License

MIT. See `LICENSE`.
