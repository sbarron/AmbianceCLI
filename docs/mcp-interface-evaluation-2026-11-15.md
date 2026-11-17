# MCP interface evaluation, November 15, 2026

**Completed native agent-directed follow-up:** 18 fresh Codex `gpt-6-luna`
medium sessions, three new cross-module tasks, two repetitions per arm, normal
native source/edit tools, agent-chosen queries, no fixed step/token cap. Snapshot:
739 files; 458 non-test/non-generated source files / 103,164 lines. Final outcomes:

| Arm     | Strict accepted | Mean seconds | Total provider tokens |
| ------- | --------------: | -----------: | --------------------: |
| Neither |             6/6 |         61.5 |             1,585,384 |
| MCP     |             5/6 |         65.8 |             2,563,751 |
| CLI     |             6/6 |         92.4 |             2,413,497 |

All six code patches passed private behavior checks and added no type errors.
The MCP strict failure was one omitted closing brace after all nine facts and
citations had passed verification. Most extra tokens were cached input; excluding
cached input while retaining output gives 210,280 / 222,631 / 240,057 tokens.
Neither interface demonstrated an overall advantage over native tools here.

Actual use matters: 38 MCP operations and 28 CLI operations occurred. Thirteen of
24 MCP searches and ten of 15 CLI searches returned no targets. No subject used
`follow`; CLI never reused a session. One MCP coding subject got no candidates or
source bodies from three searches, then solved through native tools. This does
not validate the intended persistent dependency-expansion loop. Proposed next
changes are hybrid candidate discovery, batched selected queries/reads, explicit
zero-evidence recovery, and easier session/hop use; they are not measured wins.

Two additional shared-runtime fixes are implemented locally:

- `src/core/compactor/astParser.ts` extracts object methods and function/arrow
  properties with qualified owners and complete boundaries.
- `src/local/embeddingGenerator.ts` fixes overlapping chunk line coordinates;
  `src/local/embeddingDefaults.ts` advances layout version to 3 so old layouts
  become eligible for refresh. The initial audit found 1,931 text/range mismatches.
  After refresh, all 9,354 vectors/chunk texts/ranges and 676 stored hashes passed;
  coverage is 100% with no pending files. This is the isolated snapshot's index.

CLI regression: 51 suites, 664 passed, two skipped. MCP: all 17 tests plus
lint/format/build. Source-free package acceptance passed. The MCP installed CLI
dependency contains these compiled fixes. Changes are uncommitted/unpublished;
release the updated shared CLI and set a compatible MCP dependency minimum
before publishing an MCP that requires `explore`.

Detailed methods, task/arm tables, errors, limitations and next engineering work:
`D:/Dev/2026/AmbianceMCP/docs/native-agent-directed-luna-medium-2026-11-15.md`.
Raw frozen cohort and manual reviews:
`D:/Dev/2026/AmbianceMCP/.artifacts/native-agent-directed-luna-medium-2026-11-15-v2`.
The abandoned v1 and failed unscored permission preflights are retained separately;
the scored cohort completed with working native edits/checks and unchanged runtime.

**Later implementation:** the old budget scores below predate the new agent-directed
exploration API. Shared FileDiscovery was excluding active v1–v10/versioned
folders, even though the frozen database contained six vectors for the receiving
v1 run handler. That retrieval defect and the matching automatic-indexer rules
are fixed. An archived/current exact-query replay confirms that the versioned
handler is now returned.

The shared runtime now provides `explore` (CLI) and `local_explore` (MCP): scoped
literal search, selected complete source reads, agent-chosen dependency/reference/
route expansions, persistent task targets, and stale-source detection. No model
or embedding call is made inside this API. Source is returned only when selected;
whole functions are deferred rather than silently cut. MCP framing is automatic.
Both installed host skills use the new 60-line entrypoint with legacy details in
an on-demand reference. Restart existing MCP processes to expose the new tool.

Validation and functional Codex/Luna traces, with no new efficiency claim:
`D:/Dev/2026/AmbianceMCP/docs/agent-directed-context-2026-11-15.md`.

**Completed budget follow-up:** 28 Luna-medium sessions plus a separately frozen
two-subject metadata correction compare initial index, 6,000-token source, and
12,000-token source through MCP and CLI, plus neither. Each condition covers one
investigation and one cross-module coding task, repeated twice. These are two
previously used cases, so this is an exploratory budget pilot. Both interfaces
receive the same workflow skill; targeted follow-ups have no fixed call count.

In the corrected-pair sensitivity (26 original plus two confirmation subjects):
neither passes 4/4 with 285.7 seconds / 1,829,646 tokens; MCP index passes 4/4
with 382.6 seconds / 2,633,658 tokens. MCP 6,000 passes 3/4 (one citation failure),
and MCP 12,000 passes 4/4 with 407.6 seconds / 3,282,035 tokens. CLI index,
6,000, and 12,000 each pass 4/4: 410.4 / 427.8 / 525.6 seconds and
3,953,084 / 3,802,298 / 4,839,077 tokens. All coding attempts pass. CLI 6,000
saves 25.6% coding tokens against CLI index, but no overall tool condition beats
neither here. Do not claim that larger first-call bundles are generally better.

The 3,000 setting was not a whole-agent context cap. MCP index is pointers-only;
CLI index JSON additionally retains short snippets duplicated in byFile. Higher
source bundles are delivered correctly. MCP now exposes optional contextTokens
for shared source evidence, independent of whole-response maxTokens: 6,000/16,000
or 12,000/32,000. Source-dropping envelope packing and shared CWD-dependent route
ranking/snippet loading were fixed before collection. CLI validation passed
50 suites / 655 tests (two skipped), MCP 16 tests and fresh source-free consumer
acceptance. Larger-budget guidance is installed in both host skill locations.

Audit found exactly one edit/undo timestamp leak in the original benchmark. It
is a harness defect: bytes restored but recency metadata did not. All 67 patches
were replayed to locate it. Metadata restoration is fixed; the affected matched
12,000-token pair was repeated with both original results retained. Corrected
native receipts have identical locations and source. The final 739 file hashes
and mtimes, 676 stored hashes, all 9,354 vectors, 100% eligible coverage and
zero stale/incomplete work passed again. Runtime inputs stayed frozen during
collection. The original AmbianceAgent project was not edited. Nothing published.

Full protocol, every session, call counts, original results and correction:
`D:\Dev\2026\AmbianceMCP\docs\context-budget-luna-medium-evaluation-2026-11-15.md`.
Raw cohorts are `context-budget-agent-pilot-luna-medium-2026-11-15-v1` and
`context-budget-metadata-confirmation-luna-medium-2026-11-15-v1` under MCP .artifacts.
Keep these separate from the older first-submission cohort below.

**Completed primary large-codebase study:** 36 fresh Codex Luna-medium sessions
cover four investigations and two multi-file changes, each repeated twice with
MCP, CLI, and neither. The AmbianceAgent snapshot has 458 non-generated,
non-test source files / 103,164 lines. Its local MiniLM index was built and
independently verified first: 9,354 valid vectors, 100% eligible coverage, no
pending work. Every tool session actually received and inspected semantic source
locations; every subject had independently verified model-visible workspace-write.

Follow-up audit: these are first-submission measurements, not repeated attempts
until acceptance. No step/token cap was imposed, and no session hit the wall-time
cap. The four-file investigation citation minimum was not stated in the agent
prompt; that hidden criterion weakens interpretation of MCP's strict rejection.
All coding trials passed, so the coding efficiency comparison already has equal
success. Frozen scores are retained rather than silently regraded.

Neither: 12/12 strict acceptance, 698.7 agent seconds, 7,353,581 tokens.
MCP: 11/12, 844.2 seconds, 6,613,603 tokens.
CLI: 11/12, 822.7 seconds, 7,086,114 tokens.
All coding tasks passed (4/4 each). MCP's failure was citation breadth; CLI's was
an extra HTTP-method prefix on the correct endpoint. Endpoint normalization
changes CLI acceptance to 12/12. MCP saved 10.1% tokens against neither while
adding 20.8% time; against CLI it saved 6.7% tokens and added 2.6% time overall.
On coding alone, MCP saved 13.0% tokens and 3.9% time against CLI. This is a
required semantic-first study, not an adoption/choice test or a general speed claim.

Full protocol, results, setup corrections, and limitations:
`D:\Dev\2026\AmbianceMCP\docs\large-codebase-luna-medium-evaluation-2026-11-15.md`.
Primary raw cohort: `.artifacts/large-codebase-luna-medium-2026-11-15-v4/` in MCP.
Conflicting-permission v2/v3 runs remain excluded diagnostics. Use explicit
`default_permissions=":workspace"` and validate model-visible permissions for
this runtime; legacy sandbox flags did not produce consistent instructions.
Shared CLI readiness fixes honor nested ignore files and avoid perpetual repair
of BOM-only files. Both installed host skills match the package, and the global
CLI is linked to this checkout. Nothing was published.

Final checks passed: CLI 50 suites / 653 passing tests (two skipped), MCP lint/format/build and 13 tests, and a fresh source-free consumer with nine tools and zero protocol errors. The original application matches all 739 frozen file hashes.

The narrow-repair and earlier model results below are historical diagnostics.

A separate primary coding-repair comparison now uses Codex Luna at medium
reasoning across MCP, CLI, and no Ambiance, per the owner's corrected selection.
Its protocol, collection status, results, and limitations are in
`D:\Dev\2026\AmbianceMCP\docs\coding-first-call-luna-medium-2026-11-15.md`.
The earlier Terra and Bonsai coding runs remain historical diagnostics, not pooled
results. Bonsai's possible value for broad document search has not been tested by
these coding trials.
The shipped `skills/ambiance/SKILL.md`, agent guide, and installed host copies
now explicitly describe first-call orientation followed by normal source reads,
edits, and verification. These experiments do not change Hermes's live policy.

Luna-medium collection is complete: MCP and neither passed 3/4 frozen primary
checks; CLI passed 4/4. A post-collection hoisted-dependency audit rejected CLI's
additional accepted patch, leaving 3/4 for every condition under the stricter
combined checks. Median agent seconds were 49.0 (MCP), 50.0 (neither), and 52.4
(CLI); cumulative tokens were 1,349,095, 1,434,374, and 2,240,899 respectively.
These are twelve fresh sessions on four narrow seeded repairs. The report keeps
primary and later audit outcomes separate; no answer-driven rerun was used.

A later size/payload audit limits that interpretation further: the frozen CLI
snapshot has 316 total files (160 non-test source files, 67,361 lines), and MCP
has 230 total files (120 non-test source files, 57,342 lines including legacy
engine code). The current local MCP adapter is just four files/800 lines, and
the repairs target three files of 15, 26, and 181 lines. All eight Luna calls
returned 18–20 valid locations, but all explicitly disabled embeddings. Six
earlier Terra semantic calls never delivered a completed payload. These coding
numbers are diagnostic, not evidence for or against working semantic orientation
on unfamiliar large applications. Raw audits are `codebase-size.json` and
`orientation-audit.json` under the Luna cohort.

CLI remains the development owner of the retrieval/indexing runtime. MCP 0.3.0 now
has direct paired evidence of parity with CLI 0.6.1 for default index navigation.
The adapter evaluation and harness live in the adjacent AmbianceMCP checkout.

- Original MCP packing lost five required anchors on two of 32 development
  comparisons. MCP's formatter was corrected; the CLI runtime did not need a change.
- Corrected adapter: all 454 CLI locations and their order preserved on those 32
  comparisons; 68/78 required anchors found by each interface.
- First-scored holdout: all 146 locations/order preserved on 16 comparisons;
  both interfaces found 38/40 required anchors. No MCP-invalid source ranges.
- Four real cached-local-embedding comparisons also matched, including after
  additions, an edit, rename and deletion. MCP's incremental refresh reported
  successful writes/removals and no errors; no real project index was modified.
- Both interfaces still miss some annotated conceptual/test-module targets. This
  evaluation proves bounded interface parity, not perfect retrieval or general
  coding-task accuracy.

MCP index responses use a file dictionary and ranked
`[fileIndex,symbol,startLine,endLine]` tuples. This avoids repeated paths/index text
and preserves all tested locations within the whole-response budget. The MCP
adapter owns that projection; future retrieval improvements belong in this project.

In a small choice pilot with both interfaces usable, Codex `gpt-6.1-terra` chose
MCP first in 3/4 sessions; Bonsai through isolated Hermes chose it in 2/4, always
picking the first-listed option. These are four sessions on two exact-symbol tasks,
not general adoption rates. Hermes's deployed capability policy currently excludes
MCP, and the live configuration was not changed. Invalid Codex trials where shell
execution was blocked were excluded after a CLI-only control exposed the bias.

Full report: `D:\Dev\2026\AmbianceMCP\docs\cli-mcp-evaluation-2026-11-15.md`.

The historical 24-session coding study completed: Terra solved 4/4 seeded
repairs in each of the MCP, CLI, and no-Ambiance arms. MCP used 961,639 total
agent tokens versus CLI's 1,190,022 and no-Ambiance's 833,324, with median agent
times of 63.8, 94.0, and 41.3 seconds respectively. Thus MCP had less overhead
than CLI, but both added overhead over direct search on these small cold-index
tasks. Bonsai through Hermes solved 1/4 with MCP and 0/4 in each other arm; ten
timeouts make its token totals lower bounds. These forced-first-call results
do not establish general coding superiority or spontaneous adoption.

Coding report and raw primary data:
`D:\Dev\2026\AmbianceMCP\docs\coding-first-call-evaluation-2026-11-15.md` and
`D:\Dev\2026\AmbianceMCP\.artifacts\coding-first-call-2026-11-15-v7`.
Post-study skill and MCP guidance now call out cold semantic setup costs,
deterministic first orientation when readiness is unknown, ordinary-tool fallback,
and investigation breadth appropriate to a narrow repair. Both installed host
skill copies match this source. The revised wording has not been rebenchmarked.

Raw evidence: `D:\Dev\2026\AmbianceMCP\.artifacts`.
Reproduction scripts: `D:\Dev\2026\AmbianceMCP\scripts\compare-cli-mcp.cjs`,
`compare-live-embeddings.cjs`, `agent-interface-choice.cjs`, and
`hermes-interface-probe.py`. Source hashes and every first-pass response are retained.
