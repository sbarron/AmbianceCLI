# Ambiance Agent Quick Reference

Ambiance combines semantic frontier discovery with deterministic code verification. The host agent plans the investigation and writes the final answer.

Use an agent-directed loop: `explore discover` for issue words (lexical by default, optional ready-index hybrid), `explore search` for literal matches, `explore read` for selected source, and `explore follow` for evidence-driven relationship candidates. Copy returned refs into reads or follows; batch queries and selections when useful. MCP exposes the same actions as `local_explore`. Its maxTokens is the evidence budget with framing automatic. Inspect returned source directly and verify actual wiring. No call is mandatory; stop when grounded. The worked upload-cancellation example and caveats are in SKILL.md.

When semantic index readiness is unknown, prefer `context --no-embeddings --format index` for fast initial navigation, then ordinary source search. Semantic calls can block on index creation or freshness repair; a response-token budget does not bound setup time. Use them when an index is ready or a specific vocabulary gap warrants that cost. After a failed orientation attempt, continue normal source inspection. For a narrow repair, focus on the owning implementation, relevant wiring, and direct tests; expand for a concrete gap.

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

`format=index` formats navigation without a fenced source bundle. MCP index is
pointers-only; CLI JSON also retains short snippets and repeated metadata.
For a broader first-call source bundle, use
`--format enhanced --max-tokens 6000 --max-similar-chunks 20`, or a 12000-token
source budget when warranted. These are curated, attributable excerpts, not a
raw repository dump. Raising an index budget alone need not expand its contents.
When the MCP tool schema exposes `contextTokens`, request `format="enhanced", contextTokens=6000, maxTokens=16000`, or
`contextTokens=12000, maxTokens=32000`; `maxTokens` includes the whole response.
Additional targeted calls are appropriate for unresolved evidence gaps.

## Combined Search Loop

1. Use semantic chunks to discover relevant modules, source ranges, and project vocabulary.
2. Read `metadata.retrievalStrategy`, `semanticCandidates`, `moduleCoverage`, and `embeddingSync`.
3. Build one exact follow-up query from discovered symbols:

   ```text
   ambiance context "<discovered symbols>" --format index --no-embeddings --json --project-path <path> --max-tokens 1200
   ```

4. Inspect selected ranges with exact host file reads. `grep` is AST search: use complete code-shaped
   patterns, not identifier fragments or regex. Use bounded host text search for literal paths,
   fragments, comments, or regex.
5. Trace route/path -> registered handler -> auth -> persistence/effect -> public consumer -> success
   and failure tests. A plausible helper is not part of the flow until wiring proves it.
6. Challenge the specific failure hypothesis. Check competing modules when making broader system claims.
7. Stop when further results add no new module, relationship, or evidence role.

If a conceptual query reports `moduleCoverage: 1`, do not conclude yet. Read candidate test setup and
assertions; a truncated file read covers only the returned range.

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

A useful conceptual starting sequence is a semantic frontier and a deterministic drilldown. Add targeted queries for unresolved or disconfirming evidence; there is no universal one-call limit. If a named gap still remains, use one bounded scout with the current targets, missing role, tool/token limit, and a requirement for file/line evidence. Do not start multiple search agents.

## Command Choice

| Need                                                            | Command                                                                            |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Unknown vocabulary or cross-system behavior, with a ready index | `context --embeddings --format index`                                              |
| Known identifiers                                               | `context --no-embeddings --format index`                                           |
| AST structure                                                   | `grep` with complete code-shaped syntax and literal file/directory scope           |
| Literal path/string, fragment, comment, regex                   | Host text/content search scoped to selected roots                                  |
| One-file API                                                    | `summary`                                                                          |
| Project orientation without a ready semantic index              | `context --no-embeddings --format index`; `hints` or `manifest` for remaining gaps |
| Embedding truth and refresh                                     | `embeddings status`, `check_stale`, `validate`                                     |
| Log-driven diagnosis                                            | `debug`                                                                            |
| Frontend topology                                               | `frontend`                                                                         |
| Resume a Codex/Claude task                                      | `handoff list` or `handoff search`, then `handoff create --compact`                |

Use `ambiance doctor --json` for command failures and `ambiance skill verify --json` after changing skill artifacts.

Zero AST matches, missing semantic targets, truncated output, and budget exhaustion are unresolved
evidence gaps, not proof of absence. Negative claims require appropriate search semantics, adequate
scope, and exact reads. When time expires, name what remains unverified.

## Portable Handoff

```text
ambiance handoff list --json --project-path <path>
ambiance handoff search "<keywords>" --json --project-path <path>
ambiance handoff create <selection> --compact --list-id <listId> --json --project-path <path>
ambiance handoff create --session-id <searchResult.sessionId> --compact --json --project-path <path>
ambiance handoff evidence <handoff-id> --tests --json
```

Prefer the compact handoff and retrieve cited evidence on demand. Use stable `sessionId` for automation;
the numbered `selection` is a human-friendly shortcut. List 5-10 recent titles when the user wants to
browse, and use local ranked search when they describe a topic. Add `--all-projects` only for
cross-checkout discovery. Handoff creation does not create, refresh, or query project embeddings. If
the result warns that refreshed symbol-level code evidence was unavailable, run one bounded
symbol-anchored `context --no-embeddings --format index` query from its relevant files and identifiers.
