# Ambiance CLI

CLI-first Agent Accessible local code context and analysis for agent workflows.  Uses AST-grep for semantic code search and analysis with compacting for token efficiency. AmbianceCLI fetches appropriate context from accross the project, your agent decides where to dig deeper. Meaning faster, more efficient, code completion. 


### `ambiance context` — Semantic code search
Instead of grepping through hundreds of files, ask a natural language question and get ranked results with jump targets, key symbols, and config — in milliseconds.

![ambiance context demo](https://raw.githubusercontent.com/sbarron/AmbianceCLI/master/demo/context-scenario-c-demo.gif)

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

## More Demos

### `ambiance hints` — Instant project orientation
One command gives any agent or developer a full orientation to an unfamiliar codebase: architecture patterns, key folders, entry points, and top functions.

![ambiance hints demo](https://raw.githubusercontent.com/sbarron/AmbianceCLI/master/demo/hints-scenario-d-demo.gif)

### `ambiance summary` — File complexity at a glance
Instantly surfaces cyclomatic complexity, symbol counts, and architectural patterns so you know which files need attention.

![ambiance summary demo](https://raw.githubusercontent.com/sbarron/AmbianceCLI/master/demo/filesummary-scenario-b-demo.gif)

### `ambiance grep` — AST-aware pattern matching
Finds exact function invocations, not comments or string matches. Compared here against standard text grep on the same codebase.

![ambiance grep demo](https://raw.githubusercontent.com/sbarron/AmbianceCLI/master/demo/astgrep-scenario-a-comparison.gif)

### `ambiance debug` — Log-to-code tracing
Paste a log line and get back the relevant source locations, stack context, and suggested fix targets.

![ambiance debug demo](https://raw.githubusercontent.com/sbarron/AmbianceCLI/master/demo/debug-scenario-e-demo.gif)

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
