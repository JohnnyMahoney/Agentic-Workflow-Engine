# Discovery handoff verification

Start with [live acceptance](manual/README.md): all five manual scenarios were
reviewed, including genuine Claude Discovery, separate Compilation and successful
fresh Replay. Section 3.6 is accepted for the current web MVP.

The verification directory below contains earlier automated regression evidence,
with scripted API responses and simulated operators. The current regression log is
[closure/tests.log](closure/tests.log); original logs remain unchanged.

`npm.cmd test` passed **42/42**, including nine Discovery handoff tests and nine
Replay handoff tests. [Full log](verification/final-tests.log).

Discovery tests run the installed Anthropic SDK toolRunner and real Chromium with
scripted API responses and simulated operators. No paid API calls were made.
Candidate JSON in these tests is explicitly hand-authored, not Claude-generated.

| Scenario | Evidence | Verified behavior |
| --- | --- | --- |
| Trusted dismissal | [Discovery](verification/final-scenarios/dismiss/discovery-v2.json), [validation](verification/final-scenarios/dismiss/builder/validation.json), [fresh Replay](verification/final-scenarios/dismiss/fresh-replay/result.json) | Same discovery session, accepted blocker proof, fresh Replay requests another intervention and returns $0.00 |
| Human-only control | [Audit](verification/final-scenarios/policy-guard/events.jsonl) | Automation blocked before dispatch; operator dismisses it |
| Stale reference | [Audit](verification/final-scenarios/stale-action/events.jsonl) | Old action rejected after resume; fresh read required |
| Driver fallback | [Audit](verification/final-scenarios/driver-fallback/events.jsonl) | Repeated unchanged reads independently trigger intervention |
| Manual business action | [Audit](verification/final-scenarios/business-action/events.jsonl) | Compilation rejected before API call; no artifact saved |
| Abort | [Summary](verification/final-scenarios/abort/summary.json) | Incomplete Discovery, admission rejected |
| Unresolved | [Summary](verification/final-scenarios/unresolved/summary.json) | Three interventions, then bounded stop; admission rejected |
| API outage | [Summary](verification/final-scenarios/network-outage/summary.json) | Failure, no human request fabricated |

Each scenario includes test-verification.json identifying the scripted API, real
browser, simulated operator, launch and intervention counts. Lifecycle journals
and before/after screenshots sit alongside Discovery snapshots. The budget/queue
test also checks paused time and serialized tool execution.

Reproduce code tests: `npm.cmd test`. For new retained Discovery test evidence, set
`DISCOVERY_HANDOFF_EVIDENCE_DIR` to a fresh directory before running. Do not overwrite
these results. [Live operator demo](../../examples/discovery-handoff/README.md).
