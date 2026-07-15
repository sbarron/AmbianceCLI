---
name: ambiance
description: Build verified, token-budgeted project evidence for coding agents using adaptive semantic frontier discovery plus deterministic symbol and AST retrieval through the `ambiance` CLI.
---

# Ambiance Skill

Use Ambiance as a project-intelligence and evidence-retrieval layer. The host agent owns the investigation and final reasoning; Ambiance discovers relevant neighborhoods, ranks grounded locations, and compacts the evidence.

Use `ambiance ... --json` for automation. Treat a command as successful only when its exit code is `0` and the JSON `success` field is not `false`.

## Operating Principles

1. **Choose the retrieval path from what is known.** Exact identifiers use deterministic search. Conceptual or system-level questions use the semantic index to discover the vocabulary first.
2. **Semantic breadth, deterministic precision.** Preserve semantic chunks as frontier evidence, then drill into their symbols, callers, imports, configuration, persistence, tests, and failure handling.
3. **Do not stop at the first plausible subsystem.** Check at least one competing module or relationship before declaring the evidence complete.
4. **Keep the index trustworthy.** Embedding-assisted context performs incremental freshness checks, including tracked files that have zero chunks after an interrupted write.
5. **Agentic search is bounded escalation.** Do not start with multiple search agents. Use at most one focused scout only after the hybrid workflow leaves a named evidence gap.
6. **Provenance beats prose.** `answerDraft` is deterministic routing metadata, not a final answer. Base claims on `jumpTargets`, semantic chunk ranges, relationships, and exact follow-up reads.

## Adaptive Hybrid Workflow

### 1. Classify the request

Use the **known-symbol path** when the request already contains code-shaped identifiers such as `runSkillInstall`, `LocalEmbeddingStorage`, `USE_LOCAL_EMBEDDINGS`, or `src/cli.ts`.

Use the **conceptual path** when the request describes behavior but the implementation vocabulary is unknown, for example “how does shutdown prevent background timers from keeping the process alive?”

### 2A. Known-symbol path: deterministic first

```text
ambiance context "<symbol1 symbol2 frameworkIdentifier>" --format index --json --project-path <absolute-path> --max-tokens 1200 --no-embeddings
```

This is the lowest-token path. Exact code-shaped identifiers receive reserved coverage, while repeated resolved locations are removed.

### 2B. Conceptual path: semantic frontier first

Check the index, then retrieve a bounded hybrid frontier:

```text
ambiance embeddings status --json --project-path <absolute-path>
ambiance context "<behavior or system question>" --format index --json --project-path <absolute-path> --max-tokens 1600 --max-similar-chunks 12 --embeddings
```

`--embeddings` checks freshness and incrementally repairs new, stale, deleted, and zero-chunk tracked files before retrieval. Do not force a full rebuild unless compatibility is broken or incremental repair reports errors.

For conceptual queries, Ambiance interleaves real semantic chunks with structural candidates across modules. Read `metadata.retrievalStrategy`, `semanticCandidates`, and `moduleCoverage` before deciding whether the frontier is broad enough.

### 3. Convert the frontier into deterministic anchors

From the semantic chunk symbols and nearby structural targets, form one compact follow-up query:

```text
ambiance context "<discoveredSymbol1 discoveredSymbol2 relatedConfig>" --format index --json --project-path <absolute-path> --max-tokens 1200 --no-embeddings
```

Then inspect only selected evidence:

```text
ambiance summary <file> --json --project-path <absolute-path>
ambiance grep "<ast pattern>" --json --project-path <absolute-path> --file-pattern "<glob>"
```

Use the host's exact file reads for returned files and line ranges. The semantic pass discovers where to look; the deterministic pass verifies how the behavior is wired.

### 4. Run the local-maximum check

Before stopping, require:

- at least one grounded definition or entry point;
- caller, registration, or import wiring when behavior crosses files;
- configuration and persistence/external effects when applicable;
- tests and failure behavior;
- one result outside the leading file or module, or an explicit negative check showing no competing implementation exists.

If `moduleCoverage` is `1` for a system-level question, refine the semantic query or inspect imports before concluding. Do not expand merely to collect more copies of the same evidence.

## Bounded Escalation

### Tier 1: One hybrid frontier and one deterministic drilldown

For conceptual work, the normal budget is one embedding-assisted frontier plus one symbol-anchored verification query. For known-symbol work, start with the deterministic query and add a semantic pass only if a named evidence role is missing.

### Tier 2: One disconfirming query

If all evidence clusters in one subsystem, run one query aimed at the missing role or competing implementation. Examples: persistence outside the service, alternate registration, background worker, compatibility layer, or failure cleanup.

### Tier 3: One focused search agent

If the host supports delegation and a specific question remains unresolved, give one scout:

- the unresolved question;
- current semantic and deterministic jump targets;
- the missing evidence role or competing hypothesis;
- an explicit tool-call and token limit;
- a requirement to return file/line evidence and negative checks.

Do not use multi-agent search for ordinary navigation. The scout builds a small search context; it does not recursively explore the repository.

## Query Construction

For deterministic queries, use exact identifiers:

- `"parseGlobalOptions runSkillInstall handleSemanticCompact"`
- `"adminRoutes registerAdminRoutes Hono app.route"`

For semantic frontier queries, describe one behavior or boundary at a time:

- `"background cleanup during process shutdown"`
- `"machine-readable CLI output while installing the skill"`

Do not mix unrelated frontend, backend, and infrastructure questions. Prefer two bounded domain queries over one keyword dump.

## JSON Evidence Contract

Read these fields first:

- `jumpTargets`: ranked file, symbol, start/end lines, role, confidence, relevance, reasons, and optional snippet;
- `byFile`: the same targets grouped by file;
- `metadata.retrievalStrategy`: `deterministic`, `hybrid-symbol`, or `hybrid-concept`;
- `metadata.semanticCandidates`: semantic chunks considered before final selection;
- `metadata.moduleCoverage`: number of represented file/module prefixes;
- `embeddingSync`: whether freshness was checked, updated, or degraded, including update errors;
- `evidence`: compact symbol and location references;
- `nextActions`: suggestions that still require agent judgment;
- `answerDraft`: routing metadata only, never the final response.

Semantic targets now retain the indexed chunk's actual symbol and line range. Discard unsupported narrative and repeated locations. Every final claim should trace to a target or an exact follow-up read.

## Command Selection

| Need | Command |
|---|---|
| Unknown vocabulary or cross-system behavior | `context --embeddings --format index` |
| Known functions, classes, paths, or env keys | `context --no-embeddings --format index` |
| First project orientation without a semantic index | `hints`, then `manifest` |
| Exact structural match | `grep` |
| Single-file API and complexity | `summary` |
| Error log to likely code | `debug` |
| Frontend topology | `frontend` |
| Embedding health or maintenance | `embeddings status`, `check_stale`, or `validate` |
| Skill artifact validation | `skill verify` |

## Stop Conditions

Stop retrieving when:

- every required evidence role has a grounded location;
- semantic discovery has been converted into verified symbols or line ranges;
- exact identifiers from the request are represented;
- at least one competing module or negative check has challenged the leading hypothesis;
- additional results are duplicates or add no module, relationship, or evidence-role novelty;
- the remaining uncertainty is a reasoning question rather than missing code.

Report unresolved evidence explicitly instead of spending an unbounded search budget.

## Installation and Troubleshooting

Use an explicit absolute project path. If the command fails before returning JSON:

```text
ambiance doctor --json
ambiance --version
```

If `coverage.missingFiles` or `check_stale.incompleteCount` is nonzero, run one `context --embeddings` query or `embeddings update`; incremental repair should fill the gaps. Use `embeddings create --force true` only for incompatible or irreparably corrupt indexes.

For a local checkout, build before linking so `dist/src/cli.js` is current. After updating shipped skill files, reinstall the skill into the active agent environment and compare the installed copy with the package copy.

Run `ambiance skill verify --json` after changes.

## Skill Assets

- Capability map: `skills/ambiance/capabilities.json`
- Workflows: `skills/ambiance/workflows/*.json`
- Recipes: `skills/ambiance/recipes/*.json`
- Quick reference: `skills/ambiance/AGENT_GUIDE.md`
- Detailed documentation: `skills/ambiance/README.md`
- Troubleshooting: `skills/ambiance/TROUBLESHOOTING.md`
