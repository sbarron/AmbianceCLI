---
name: ambiance
description: Build coding context incrementally with agent-directed search, selected source reads, and dependency expansion through the Ambiance CLI or MCP.
---

# Ambiance Skill

Use Ambiance as a project-intelligence and evidence-retrieval layer. The host agent owns the investigation and final reasoning; Ambiance discovers relevant neighborhoods, ranks grounded locations, and compacts the evidence.

Build the evidence needed for the task incrementally. The host agent chooses search terms, source targets, and each next dependency or reference hop. Prefer `explore`/`local_explore` for that loop when available; a broad `context` bundle is optional discovery, not a mandatory first call. Already-known source may only need a direct read. Stop retrieving when the needed implementation, wiring, and checks are grounded.

Use `ambiance ... --json` for automation. Treat a command as successful only when its exit code is `0` and the JSON `success` field is not `false`.

`explore discover` uses lexical retrieval by default without a model or index.
`--mode hybrid` / `mode: "hybrid"` opts into a ready local semantic index;
check the effective mode and any fallback. Discovery does not build or repair an
index. If retrieval fails, continue inspection with normal tools.

## Agent-directed exploration

Use `discover` for issue words, or `search` for a literal identifier, phrase, or
path. Discovery can batch `--queries` (a JSON array) / `queries`; reads can batch
`--selections` (a JSON array) / `selections`. Each call has one shared budget.
Copy a returned `ref` into a later read or follow, even in a new CLI process.
All references in a batch must belong to the same session. A known file and
symbol can be read directly. Source returned by Ambiance counts as inspection.

### Worked example: upload cancellation

Suppose an issue says “cancel an upload after a retry.” A literal `search` for
`cancel upload retry` can return zero because it looks for that exact phrase;
the tool's recovery suggests discovery with those words. Use:

```text
ambiance explore discover "cancel upload retry" --json --project-path <root>
```

The equivalent MCP request is `local_explore` with
`{"action":"discover","query":"cancel upload retry","projectPath":"<root>"}`.
Compare candidate paths and match reasons: choose the retry handler over a UI
label when its source is needed. Copy its actual returned reference:

```text
ambiance explore read --ref <handler-ref> --json --project-path <root>
```

MCP: `{"action":"read","ref":"<handler-ref>","projectPath":"<root>"}`.
If that source calls `abortUpload`, use that observed symbol to refine discovery
or follow the handler's dependencies:

```text
ambiance explore discover "abortUpload" --json --project-path <root>
ambiance explore follow --ref <handler-ref> --relation dependencies --json --project-path <root>
```

MCP equivalents are `{"action":"discover","query":"abortUpload","projectPath":"<root>"}`
and `{"action":"follow","ref":"<handler-ref>","relation":"dependencies","projectPath":"<root>"}`.
If two adapters are candidates, read both returned references together:

```text
ambiance explore read --selections '[{"ref":"<first-ref>"},{"ref":"<second-ref>"}]' --json --project-path <root>
```

MCP: `{"action":"read","selections":[{"ref":"<first-ref>"},{"ref":"<second-ref>"}],"projectPath":"<root>"}`.
Check which adapter the caller imports before concluding. Alternatively, if a
native search already found the entry point, read it directly with
`explore read --file-path <file> --symbol <name>` or the equivalent MCP fields.
Stop when the issue is grounded; one call or none can be enough.

Use `--scope` / `scope` to narrow discovery, literal searches and references.
Dependencies return local call-name and import candidates; references are lexical.
For HTTP crossings, verify base URL and path construction before following routes.
Static links are candidates, not proven runtime execution. Inspect registration,
aliases and consumers. Re-search after edits; stale refs or IDs are rejected.
Whole functions are preserved or deferred: raise the budget or explicitly choose
`startLine` and `endLine` for partial coverage. `maxTokens` / `--max-tokens`
bounds the shared JSON evidence output (default 6000, range 256–16000); MCP
framing is automatic. Do not pass `contextTokens` or `useEmbeddings` to explore.

For conceptual vocabulary gaps or older installations without exploration, read
[hybrid discovery and legacy commands](references/hybrid-context.md) only as needed.

## Choose evidence, then verify

Follow the actual caller, configuration/registration, client, receiving handler,
authorization, persistence/types, and consumers that the task needs. A name or
route resemblance is not proof of wiring. Check competing paths when ambiguous.
Read relevant test setup/assertions before making coverage claims, then verify
changes. Use ordinary source tools when they answer a gap more directly.
