# Modern UI — Test 1: member balance

Target: `http://localhost:8080/modern.html` (user-run local banking sandbox).

Goal: **Find member M-1001 and retrieve their current account balance. Confirm
the member ID and account type. Return the balance, account type, and member ID.**

The [request](request.json) explicitly binds `memberId` and declares the three
outputs. The [execution policy](policy.json) allows only the localhost origin.
This is a real UI/API-model run on synthetic sandbox data.

## Status: passed on November 1, 2026

Claude performed discovery, a separate Claude call compiled the candidate, and
the deterministic Builder validated it. Playwright executed the saved artifact in
a fresh browser session with zero LLM calls and confirmed the supplied member ID.

| Output | Discovery and replay value |
| --- | --- |
| memberId | M-1001 |
| accountType | Checking |
| balance | $2,450.75 |

## Evidence

- Discovery: [model response](discovery-2/summary.json), [actions](discovery-2/events.jsonl), [recorded DOM evidence](discovery-2/discovery-v2.json). All 15 tool actions succeeded.
- Separate compilation: [request](compilation-1/compilation-request.json), [candidate](compilation-1/candidate.json), [API call metadata](compilation-1/compilation-call.json).
- Builder: [validation report](compilation-1/validation.json), [saved artifact](compilation-1/artifact.json).
- Replay: [result](replay-1/result.json), [execution log](replay-1/events.jsonl).
- [Test verification](test-verification.json): replay outputs match recorded discovery values; member ID matches the input; replay has no LLM calls; evidence hash matches the validation report.

Discovery's `goalVerified: false` means model completion alone does not certify
the business result. Subsequent validation, replay, and comparison provide the
checks for this test.

## Limits

This run covers one member and the successful lookup path. Other members, error
paths, and human handoff remain untested. Account type and member ID selectors
depend on the current order of detail fields. Data is synthetic; this does not
establish production banking or PII readiness.

## Earlier failed attempt

The original [discovery summary](discovery/summary.json),
[action/error log](discovery/events.jsonl), and
[recorded states](discovery/discovery-v2.json) are preserved unchanged.
Localhost was unavailable during that attempt, so it retrieved no business values.
Its historical `passed: true` flag was incorrect: the old default equated model
`end_turn` with success. The code now separates completion from verification,
records tool failures, and rejects missing/failed actions before compilation.

## Repeat

Keep the sandbox running. Run from the repository root with the API key in `.env`.
Use a new directory for each run to preserve existing evidence.

```powershell
$test = 'evidence/modern-ui-testing/test-1'
$run = "$test/$(Get-Date -Format 'yyyyMMdd-HHmmss')"
npm.cmd run capability:discover -- --request "$test/request.json" --policy "$test/policy.json" --out "$run/discovery"
npm.cmd run capability:compile -- --evidence "$run/discovery/discovery-v2.json" --policy "$test/policy.json" --out "$run/compilation"
npm.cmd run capability:replay -- --artifact "$run/compilation/artifact.json" --input memberId=M-1001 --policy "$test/policy.json" --out "$run/replay"
```
