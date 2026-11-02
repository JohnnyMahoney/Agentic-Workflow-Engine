# Legacy UI — Test 1: member balance

**Status:** Passed on November 1, 2026.

Target: `http://localhost:8080/legacy/index.html`.
Goal: Find member M-1002, confirm member ID and account type, and return their
current balance, account type, and member ID. The sandbox contains synthetic data.

| Output | Observed discovery and fresh replay |
| --- | --- |
| memberId | M-1002 |
| accountType | Savings |
| balance | $18,200.00 |

## Successful pipeline

1. [Request](request.json) declares explicit memberId binding and outputs; [policy](policy.json) restricts the origin to localhost:8080.
2. Real Claude discovery: [summary](discovery-2/summary.json), [events](discovery-2/events.jsonl), [recorded evidence](discovery-2/discovery-v2.json). All 15 actions succeeded.
3. Separate Claude compilation: [prompt and evidence](compilation-2/compilation-request.json), [candidate](compilation-2/candidate.json), [call metadata](compilation-2/compilation-call.json).
4. Deterministic Builder: [validation](compilation-2/validation.json), [saved artifact](compilation-2/artifact.json).
5. Fresh Playwright session without LLM: [result](replay-1/result.json), [events](replay-1/events.jsonl).
6. [Verification](test-verification.json) checks output agreement with recorded DOM values, member input, evidence hash, and zero replay LLM calls.

The same contract, Builder, and executor handle this workflow. The artifact uses
an iframe path, CSS targets for non-semantic span/u controls, an input-bound result
row, explicit waits, and a member-ID checkpoint. No site-specific executor was added.

## Issue found and fixed

The first [discovery](discovery-1/summary.json) completed the UI task, but coordinate
clicks inside the iframe were incorrectly recorded as targeting the outer iframe.
The Builder [rejected compilation](compilation-1/compilation-error.json) with
`UNSUPPORTED_EVIDENCE`; no artifact from that attempt was replayed.

The recorder now descends through frames when identifying a coordinate target.
A regression test covers nested bordered frames and checks the recorded identity
against the element actually clicked. All five tests passed. We repeated real
discovery after fixing the recorder; earlier evidence remains unchanged.

## Limits

Only M-1002 and the successful lookup path were tested on legacy UI. Selectors
depend on the current iframe name, table structure, labels, and presentation
markup (including the green balance font). Layout changes may require discovery
and compilation again. Transformed frame geometry is rejected when detected;
arbitrary transformed layouts are not validated. Human handoff, error paths,
and production banking data handling remain outside this test.

## Repeat

Keep the sandbox running and configure the API key in `.env`. From repository root:

```powershell
$test = 'evidence/legacy-ui-testing/test-1'
$run = "$test/$(Get-Date -Format 'yyyyMMdd-HHmmss')"
npm.cmd run capability:discover -- --request "$test/request.json" --policy "$test/policy.json" --out "$run/discovery"
npm.cmd run capability:compile -- --evidence "$run/discovery/discovery-v2.json" --policy "$test/policy.json" --out "$run/compilation"
npm.cmd run capability:replay -- --artifact "$run/compilation/artifact.json" --input memberId=M-1002 --policy "$test/policy.json" --out "$run/replay"
```
