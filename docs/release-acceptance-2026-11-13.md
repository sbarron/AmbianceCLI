# Release-candidate acceptance: 2026-11-13

The locally packed candidate passes 34 installed-package lifecycle checks and the full default Jest suite: 47 suites, 632 tests passed, two existing skips. TypeScript checking and skill verification pass. The lifecycle command is configured in the existing Windows/Linux, Node 22/24 CI matrix; remote CI has not run for these uncommitted changes. Nothing was published.

This pass verifies package behavior and index maintenance. It makes no new agent-accuracy claim and runs no Bonsai or Luna requests. Existing benchmark artifacts remain unchanged.

## Installed-package acceptance

The runner builds an npm tarball, installs it in a new consumer directory outside the checkout, and invokes the compiled CLI from that consumer. It checks that source TypeScript is absent from the installation. Both project paths contain spaces. Fixtures cover TypeScript and mixed JavaScript/Python, default turbo4 storage and explicit float32 storage. Local validation used Windows and Node 22.12.0, with cached MiniLM assets and remote model access disabled.

Each project checks:

- Doctor, shipped skill verification, project-relative summaries, symbol manifests, AST search and real import-graph targets.
- Cold inference, complete chunk ordinals, ignored build output and unchanged updates with zero inference.
- Warm context, one query inference, parseable JSON and rendered context within the requested token budget.
- Edits, additions, renames and deletions, including removal of stale chunk rows and file metadata.
- Visible inference failure with prior vectors retained; successful retry without another source edit.
- Partial inference failure: successful files persist, failed files retain old vectors, and the command returns failure.
- A process deliberately exiting after committed chunk deletion, followed by automatic repair in a fresh context process.
- Repair of an unchanged legacy layout, retaining vector bytes and source ranges.

Normal observations wrap the real tokenizer to count inference inputs. Two explicit test-only fault modes inject inference errors or terminate after chunk deletion. They are confined to the observer loaded by this runner and are not shipped CLI behavior. Watcher cancellation, retries and queue serialization are tested by the unit suite rather than a long-running native daemon.

## Confirmed fixes

| Area | Before | Accepted behavior |
|---|---|---|
| Summary paths | Relative files resolved against the consumer working directory | Explicit project roots resolve relative summary paths |
| Incremental discovery | Only tracked files were considered | New source is discovered; missing files and their metadata are removed |
| Per-file update errors | Returned generation errors were discarded | Errors reach the command result and cause failure |
| Partial updates | A successful file could hide another file's failure | Partial work persists while the command reports failure |
| Local-only indexing | Health/hash requests still reached the cloud adapter | `skipCloud` makes no cloud requests |
| Local freshness | Repeated local passes parsed and generated again | Successful local hashes skip unchanged work; failed generation remains retryable |
| Watcher lifecycle | Pending work survived stop; failed content could be marked handled | Pending debounce work is cancelled; content hashes advance after successful updates |
| Update queue | Waiters could overlap after an earlier operation completed | Operations remain serialized and later work survives an earlier failure |

The first valid packed baseline failed eight of its 30 checks: summary paths, new files, renamed files and failure reporting in both fixture projects. The accepted runner adds four graph/partial-failure checks and passes all 34. Earlier harness-debug attempts are retained separately; `baseline-corrected` and `accepted` are the comparison records.

## Excluded indexer-test triage

All 20 historical failures have individual entries in [the triage ledger](../artifacts/release-acceptance/2026-11-13/indexer-triage.json). They used obsolete parser/project mocks, an unused injected logger, assignments to read-only namespace exports, stale debounce assumptions or assertions about log messages rather than behavior. The cloud-error test also expected failure where the documented behavior is local fallback.

The suite now contains 28 behavior tests and runs in default Jest and CI. Running those repaired tests against the captured original indexer reproduces six product failures: cloud isolation, generation-error reporting, stop cancellation, failed-update retry, unchanged local work and queue serialization. All six pass with the fixes.

The complete suite additionally exposed a stale fixture missing the current chunk-layout revision. That fixture now declares its current revision, and a separate test verifies that legacy revisions remain eligible for repair. The workflow test now uses a bounded temporary project, isolated storage and a subprocess timeout, while retaining embedding-enabled workflow commands.

## Evidence and reproduction

Local records are under [artifacts/release-acceptance/2026-11-13](../artifacts/release-acceptance/2026-11-13):

- `accepted-candidate.tgz`: accepted package; SHA-256 `a9971794f274b98f664fea15fa82a22f6b83d0a093f9cdd66b59fd219972bace`.
- `accepted/acceptance.json`: 34 checks and 38 CLI process observations; 29 actual inference inputs.
- `indexer-triage.json`, `original-code-new-tests-2.json`: historical failure explanations and counterfactual regression proof.
- `default-tests-accepted.json`, `typecheck-final.log`, `skills.log`: default suite and validation evidence.
- `benchmark-before.json`, `benchmark-preservation.json`: all 5,212 pre-existing benchmark files, including state, hash-identical after the work. Existing v9 and v10 seals also pass.
- `implementation.patch`: changes relative to the starting checkout, preserving pre-existing unrelated changes.

Run from the repository root:

```text
node scripts/release-acceptance.cjs --out <new-report-directory>
node scripts/release-acceptance.cjs --offline --out <new-report-directory>
node scripts/release-acceptance.cjs --tarball <candidate.tgz> --offline --out <new-report-directory>
node node_modules/jest/bin/jest.js --runInBand
npm run verify:skills
```

`npm run test:release` also runs acceptance with a new temporary report directory. Use the direct Node command for explicit arguments on Windows. The initial model load may download MiniLM assets unless `--offline` is supplied; later processes use the cache. `--model-cache <directory>` selects an existing cache. No hosted inference key is required. Reports, consumer installation and temporary project state are retained for inspection.

Release remains subject to the remote CI matrix completing successfully. The other intentionally excluded legacy integration suites are outside this default-suite result. A held-out agent-quality comparison remains separate from this acceptance pass.
