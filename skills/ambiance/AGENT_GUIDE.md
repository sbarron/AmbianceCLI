# Ambiance Agent Quick Reference

Ambiance combines semantic frontier discovery with deterministic code verification. The host agent plans the investigation and writes the final answer.

## Choose a Path

Known function, class, path, route, or environment key:

```text
ambiance context "<exact identifiers>" --format index --no-embeddings --json --project-path <path> --max-tokens 1200
```

Unknown vocabulary, behavior question, or cross-system flow:

```text
ambiance embeddings status --json --project-path <path>
ambiance context "<one behavior or boundary>" --format index --embeddings --json --project-path <path> --max-tokens 1600 --max-similar-chunks 12
```

The embedding-assisted path incrementally repairs new, stale, deleted, and tracked zero-chunk files before searching. A full rebuild is not the normal refresh path.

## Combined Search Loop

1. Use semantic chunks to discover relevant modules, source ranges, and project vocabulary.
2. Read `metadata.retrievalStrategy`, `semanticCandidates`, `moduleCoverage`, and `embeddingSync`.
3. Build one exact follow-up query from discovered symbols:

   ```text
   ambiance context "<discovered symbols>" --format index --no-embeddings --json --project-path <path> --max-tokens 1200
   ```

4. Inspect the selected files with `summary`, `grep`, and exact host file reads.
5. Check definition, caller/wiring, configuration, effects, tests, and failure handling.
6. Challenge the leading hypothesis with one competing module or negative check.
7. Stop when further results add no new module, relationship, or evidence role.

If a conceptual query reports `moduleCoverage: 1`, do not conclude yet.

## Read JSON Results

- `jumpTargets`: grounded semantic and structural locations;
- `byFile`: targets grouped by file;
- `metadata.retrievalStrategy`: deterministic, hybrid-symbol, or hybrid-concept;
- `metadata.semanticCandidates`: size of the semantic frontier considered;
- `metadata.moduleCoverage`: represented module prefixes;
- `embeddingSync`: freshness work and any update errors;
- `evidence`: compact source references;
- `nextActions`: suggestions requiring agent judgment;
- `answerDraft`: routing metadata, never a final answer.

## Bounded Escalation

Normal conceptual work is one semantic frontier plus one deterministic drilldown. Add at most one disconfirming query. If a named gap still remains, use one bounded scout with the current targets, missing role, tool/token limit, and a requirement for file/line evidence. Do not start multiple search agents.

## Command Choice

| Need | Command |
|---|---|
| Unknown vocabulary or cross-system behavior | `context --embeddings --format index` |
| Known identifiers | `context --no-embeddings --format index` |
| AST structure | `grep` |
| One-file API | `summary` |
| Project orientation without a usable index | `hints`, `manifest` |
| Embedding truth and refresh | `embeddings status`, `check_stale`, `validate` |
| Log-driven diagnosis | `debug` |
| Frontend topology | `frontend` |
| Resume a Codex/Claude task | `handoff list`, `handoff create --compact` |

Use `ambiance doctor --json` for command failures and `ambiance skill verify --json` after changing skill artifacts.

## Portable Handoff

```text
ambiance handoff list --json --project-path <path>
ambiance handoff create <selection> --compact --list-id <listId> --json --project-path <path>
ambiance handoff evidence <handoff-id> --tests --json
```

Prefer the compact handoff and retrieve cited evidence on demand. Use stable `sessionId` for automation;
the numbered `selection` is a human-friendly shortcut.
