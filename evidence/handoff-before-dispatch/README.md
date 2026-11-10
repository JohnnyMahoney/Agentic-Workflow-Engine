# Before-dispatch Replay recovery regression

These are automated tests, with real Chromium and simulated operators for the
before-dispatch cases. No Claude calls or live human acceptance are claimed.

Run: `node --test --test-concurrency=1 dist/tests/*.test.js` after building.
See [test output](tests.log) and [scenarios](scenarios).

The before-dispatch cases assert that the browser click method has not been called
when handoff starts. Success removes the blocker and invokes click exactly once
in the original session, then verifies downstream output/checkpoints. Missing,
ambiguous and still-blocked variants invoke click zero times and stop unresolved.
The artifact stays unchanged. Existing tests cover unknown write results,
confirmation requirements, abort, bounded retry and policy violations.

The live Test 2 artifact remains at
`../discovery-handoff/manual/test2-guard-20261109-185606/compilation/artifact.json`.
Its original failed Replay is preserved. Repeat it into a new output directory
to confirm recovery with a real operator; no new Discovery or Compilation needed.
