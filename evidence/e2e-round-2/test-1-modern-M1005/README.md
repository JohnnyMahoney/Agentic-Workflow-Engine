# E2E round 2 - Test 1: Modern UI, M-1005

Result: SUCCESS. New genuine Claude Discovery, separate Claude Compilation,
evidence validation, and fresh-session Playwright Replay completed.

Returned member ID M-1005, account type Term Deposit, balance $50,000.00.
All outputs match the exact extraction nodes in recorded discovery evidence.
No code or contract changes, no Reset, no manually supplied selectors or expected
balance/type values. The standard request/CLI generic instructions were used.

- [Request](request.json) and [policy](policy.json)
- [Initial connection failure](discovery/summary.json): zero actions, no successful model run
- [Successful discovery](discovery-2/discovery-v2.json), [model/tool events](discovery-2/events.jsonl)
- [Compilation request](compilation/compilation-request.json), [candidate](compilation/candidate.json)
- [Validation](compilation/validation.json), [artifact](compilation/artifact.json)
- [Replay result](replay/result.json), [replay steps](replay/events.jsonl)
- [Output/evidence verification](verification.json)

Replay made zero LLM calls. This is test 1 of the requested six; the remaining
scenarios are not yet specified. This happy path does not alone accept all of section 3.3.

Administrator acceptance: explicitly confirmed by the user. See [acceptance record](admin-acceptance.json).
