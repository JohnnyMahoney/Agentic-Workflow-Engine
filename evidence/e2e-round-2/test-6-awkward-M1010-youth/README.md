# E2E round 2 - Test 6: Awkward UI, M-1010, Youth

**Latest result: SUCCESS after safe recovered-failure admission, saved-evidence Compilation and deterministic Replay.**
The original partial result below is preserved. See [final verification](recovered-replay-verification.json).

**PARTIAL: real creation confirmation observed, full E2E blocked at Discovery acceptance.**

Claude recovered from an initial form_input rejection and reached the actual UI
message: Sub-account M-1010-S1 (Youth) created for Yuri Savchenko. Simulated.
The message is recorded in successful get_page_text action 33. This is not merely
a model assertion. No final localStorage verification was performed.

Action 7 failed with: Only string form input on an observed reference is supported.
Claude then continued successfully; summary reports toolFailures=1 and the model
ended its turn. The current CLI and Builder reject any discovery with failed
actions. Saved discovery-v2.json therefore has completed=false, despite the
actual successful business confirmation. Compilation and Replay did not run.

No code/contract changes, new Discovery, manual evidence edits, or automatic retry.
This exposes the strict failed-action admission rule; it is not classified as a
sandbox UI defect or a complete deterministic-replay success.

- [Request](request.json), [policy](policy.json)
- [Discovery evidence](discovery/discovery-v2.json)
- [Model/tool events](discovery/events.jsonl), [summary](discovery/summary.json)
- [Independent verification](verification.json)

Actual screenshots are preserved in discovery/. Administrator acceptance pending.

## Recovered Discovery acceptance and full Replay

No new Discovery occurred. The original completed=false flag and failed action 7
remain unchanged. The original structured audit and driver-guard diagnostic prove
that action 7 was rejected before browser mutation, with identical snapshots and
a successful correction at action 10. Admission was eligibility only; Builder
accepted the candidate after output/readiness and final semantic goal checks.

The first two Compilation calls were truncated at max_tokens=10000. The third
complete candidate was rejected for an absent scoped locator. Exact offline
feedback led to a fourth validated candidate; no candidate was manually patched.
Later calls used the recorded bounded maxTokens=20000 configuration.

Replay returned M-1010, Youth, and confirmation of M-1010-S1 (Youth) creation.
A read-only terminal hook saved actual sandbox state: exactly one Youth sub-account
under M-1010 with reference M-1010-S1. One creation dispatch, no creation retry,
and zero LLM calls during Replay. All successful Discovery interactions were
preserved; failed action 7 is absent from executable evidence references.

- [Admission](compilation-recovered-4/discovery-admission.json), [Builder acceptance](compilation-recovered-4/discovery-acceptance.json)
- [Accepted artifact](compilation-recovered-4/artifact.json), [validation](compilation-recovered-4/validation.json)
- [Replay result](replay-recovered/result.json), [steps](replay-recovered/events.jsonl)
- [Terminal UI and actual state](replay-recovered/terminal-state.json), [screenshot](replay-recovered/terminal.png)
- [Independent verification and history](recovered-replay-verification.json)
- [Replay runner](run-recovered-replay.mjs): production Engine, artifact steps only; close hook records evidence.

Technical Test 6 result is now passed; explicit administrator acceptance pending.
