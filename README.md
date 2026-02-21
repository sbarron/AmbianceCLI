# Ambiance CLI

CLI-first local code context and analysis for agent workflows.

> MCP users: start with `ambiance migrate mcp-map --json` for the current CLI mapping.

## Install

```bash
npm install -g @jackjackstudios/ambiance-cli
```

### Install Agent Skill
To integrate Ambiance directly into your favorite AI environments, install the Ambiance Agent Skill:
```bash
ambiance skill install
```
By default, this will copy the skill definitions into the known configuration directories of `.claude`, `.gemini`, `.antigravity`, `.codex`, and `.cursor`.

## Quick Start

```bash
ambiance --help
ambiance doctor --json
ambiance skill verify --json
```

## CLI Commands

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
