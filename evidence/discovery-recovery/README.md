# Recovered Discovery admission

The original Test 6 reached a real Youth account creation confirmation after
recovering from a rejected form_input. Admission now distinguishes proven
pre-dispatch recovery from uncertain side effects. Eligibility for Compilation
is separate from Builder acceptance and independent Replay success.

## Regression evidence

- [24 passing tests](tests-final.log).
- [Admission cases](regression-final/admission/assertions.json): proven recovery
  eligible; possible writes, unknown dispatch, changed snapshots, wrong target,
  unbound correction, absent final observations and incomplete runs rejected.
- [Builder checks](regression-final/builder/assertions.json): failed action cannot
  be executable evidence; weak final checkpoints, contradicting outputs and
  missing successful interactions rejected.
- [Historical Test 6 admission](regression-final/historical-test-6/admission.json):
  failed action 7 retained, corrected action 10, legacy driver-guard proof.
- Typed guard test confirms the rejected input does not modify the field.

`tests.log` and `regression/` contain the first passing run; tests-final.log and
regression-final/ verify the final implementation including bounded compilation
budget configuration. Fixtures are synthetic, not new Claude Discovery runs.

## Preserved source and Compilation attempts

[Original hashes](original-hashes.json) cover discovery-v2.json, events.jsonl,
summary.json and the original Test 6 verification. These files are not filtered,
reindexed or rewritten. Failed action 7 remains an auditable failed action.

- [Original Discovery](../e2e-round-2/test-6-awkward-M1010-youth/discovery/discovery-v2.json).
- [Admission proof](../e2e-round-2/test-6-awkward-M1010-youth/compilation-recovered/discovery-admission.json).
- [First incomplete response](../e2e-round-2/test-6-awkward-M1010-youth/compilation-recovered/compilation-error.json).
- [Second incomplete response](../e2e-round-2/test-6-awkward-M1010-youth/compilation-recovered-2/compilation-error.json).
- [Third candidate locator rejection](../e2e-round-2/test-6-awkward-M1010-youth/compilation-recovered-3/locator-diagnostic.json).

The first two calls hit the 10000-token response limit; partial JSON was not
repaired. Later calls use an explicitly recorded 20000-token budget. The third
candidate's accountOption selector searched for an .o descendant inside an .o
scope and failed against the original DOM. That exact diagnostic was passed back
to Compilation without manually changing its candidate.

The [Test 6 index](../e2e-round-2/test-6-awkward-M1010-youth/README.md) records the
final Compilation/Replay outcome separately from original Discovery success.

## Final Test 6 result

**SUCCESS after saved-evidence Compilation and fresh-session Replay.**

- [Fourth candidate validation](../e2e-round-2/test-6-awkward-M1010-youth/compilation-recovered-4/validation.json).
- [Builder acceptance and excluded action 7](../e2e-round-2/test-6-awkward-M1010-youth/compilation-recovered-4/discovery-acceptance.json).
- [Accepted artifact](../e2e-round-2/test-6-awkward-M1010-youth/compilation-recovered-4/artifact.json).
- [Replay result](../e2e-round-2/test-6-awkward-M1010-youth/replay-recovered/result.json):
  M-1010, Youth, confirmation of M-1010-S1 (Youth), output readiness validated.
- [Terminal state](../e2e-round-2/test-6-awkward-M1010-youth/replay-recovered/terminal-state.json):
  exactly one sub-account under M-1010, reference M-1010-S1, type Youth.
- [Terminal screenshot](../e2e-round-2/test-6-awkward-M1010-youth/replay-recovered/terminal.png).
- [Independent verification](../e2e-round-2/test-6-awkward-M1010-youth/recovered-replay-verification.json):
  original source hashes unchanged, failed action 7 retained in audit and absent
  from executable references, all successful interactions preserved, one creation
  dispatch, no creation retry, zero Replay LLM calls.

No new Discovery or manual candidate/artifact editing occurred. The Replay close
hook only records the actual terminal UI/localStorage and screenshot; all UI
actions come from the accepted artifact through the production Engine. Explicit
administrator acceptance of the repaired Test 6 remains pending.

## Limits

Only the known pre-dispatch form_input guard is allowlisted. Unknown failed clicks
or writes remain rejected regardless of a later success or unchanged DOM.
Legacy proof requires its companion audit; arbitrary error text is insufficient.
Builder verifies the explicit output/checkpoint contract, not unrestricted natural
language semantics. No live recovery orchestrator or new Discovery was introduced.

Run `npm.cmd test`; optionally set RECOVERY_EVIDENCE_DIR to a fresh directory to
retain the fixture reports. Otherwise tests use a temporary directory.
