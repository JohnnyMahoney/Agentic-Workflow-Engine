# Legacy UI — Test 2: member M-1003

**Status:** Passed on November 1, 2026.

Target: `http://localhost:8080/legacy/index.html`.
The [request](request.json) supplies the original member-balance goal with the
explicit `M-1003` input and three requested outputs. The [policy](policy.json)
allows the local sandbox origin. This run used fresh discovery and compilation;
it did not reuse the M-1002 artifact or provide selectors to Claude.

| Output | Discovery and replay |
| --- | --- |
| memberId | M-1003 |
| accountType | Checking |
| balance | $310.40 |

## Evidence

- Claude discovery: [response](discovery-1/summary.json), [actions](discovery-1/events.jsonl), [recorded DOM](discovery-1/discovery-v2.json). All 17 actions succeeded.
- Separate Claude compilation: [request](compilation-1/compilation-request.json), [candidate](compilation-1/candidate.json), [API metadata](compilation-1/compilation-call.json).
- Builder: [validation](compilation-1/validation.json), [artifact](compilation-1/artifact.json).
- Fresh Playwright replay: [result](replay-1/result.json), [events](replay-1/events.jsonl). No LLM calls.
- [Verification](test-verification.json) compares replay outputs to values observed in discovery and checks member ID, evidence hash, and absence of replay LLM calls.

This confirms the successful lookup path for M-1003 in the current legacy UI.
Error paths, human handoff, and future layout changes are outside this test.
