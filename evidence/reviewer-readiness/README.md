# Cleanup verification

No new Claude calls. Source and tests unchanged.

- [Build](build.log) and [typecheck](typecheck.log): exit 0 (empty logs mean no diagnostics).
- [Unit/regression](tests.log): 24/24 passed.
- [Real-browser banking fixtures](banking-tests.log): 12/12 passed on bundled localhost:18082; detailed repeat-run files moved to the ignored local archive; see the [manifest](../archive-manifest.json). The [original runtime suite](../runtime-3-3/README.md) remains available.
- [Saved genuine artifact Replay](saved-artifact-replay/result.json): SUCCESS on localhost:8080, M-1005 / Term Deposit / $50,000.00; no LLM. Old artifact reports legacy-unverified readiness.
- [Hygiene scan](hygiene.json): recognized credential patterns and configured secret comparison, values suppressed; local documentation links checked. Not a comprehensive secret/PII/history audit.

See [cleanup disposition and limits](../../docs/reviewer-readiness.md).

The reintroduced AMBIGUOUS_TARGET artifact was removed from this directory and
preserved separately in the ignored local archive. See the retained
[original runtime fixture](../runtime-3-3/2026-11-02-final/banking/AMBIGUOUS_TARGET/artifact.json).
