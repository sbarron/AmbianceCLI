# Discovery release candidate

CLI `0.7.0-rc.1` owns the runtime used by MCP `0.4.0-rc.1`. It adds lexical
multi-term discovery, optional ready-index hybrid discovery, batched searches
and source reads, stable source references, explicit recovery outcomes, and
numbered source delivery to AI advisers and callers.

The staged implementation and original source patch are prepared in the MCP
development workspace. Integrate that patch and the subsequent release-cleanup
patch into the canonical CLI checkout, preserving existing uncommitted work.
Build, verify skills, run the full current suite, and pack from that checkout.
Previously recorded full-suite results predate the last source-delivery fix.
The release handoff in the MCP repository records current validation and any
environment failures separately.

Publish the tested CLI candidate under the explicit `rc` tag before publishing
the MCP candidate that depends on it. The source-checkout prepublication check
rejects a prerelease under `latest`. npm skips that hook for tarball publication,
so explicitly pass `--tag rc` when publishing the tested tarball.
Verify registry installation and the runtime export,
then rerun MCP acceptance against the exact CLI tarball and registry dependency.

Source-delivery diagnostics and the completed adviser comparisons do not prove
voluntary agent adoption. A separate native, ordinary Ambiance, and taught
Ambiance comparison records queries, delivered evidence, follow-up reads, and
task outcome. Adviser briefings remain optional; the measured fixed-source
questions showed no factual accuracy gain over Bonsai with Ambiance evidence.
