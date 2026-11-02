# E2E round 2 - Test 4: Modern UI, M-1008, Youth

**Latest result: SUCCESS after the selectedOptionLabel extension and saved-evidence recompilation.**
The earlier failed attempts below remain preserved. See [successful verification](selected-option-replay-verification.json).

**FAILED full pipeline at Compilation Validation.**

New Claude Discovery completed 26 actions with zero tool failures and observed:
Sub-account M-1008-S1 (Youth) opened for Daria Petrenko.
Discovery did not navigate back to confirm the listing after the confirmation.

Separate Claude Compilation produced a candidate, but Builder rejected it:
UNSUPPORTED_EVIDENCE - Output definitions differ from the explicit compilation request.
The accountType output changed from selected account type to the full confirmation
message and changed its required description. This is not an accepted output contract.
The remaining locator/readiness checks were not reached. No artifact was saved;
Replay was not run. No code, contract or candidate edits, Reset, or automatic repair.

- [Request](request.json), [policy](policy.json)
- [Discovery evidence](discovery/discovery-v2.json), [events](discovery/events.jsonl), [summary](discovery/summary.json)
- [Compilation input](compilation/compilation-request.json), [candidate](compilation/candidate.json), [rejection](compilation/compilation-error.json)
- [Verification and exact mismatch](verification.json)

The discovery used a fresh isolated browser context; it did not alter the user's
open Chrome session. Successful discovery is not proof of deterministic creation.

## Compilation retry

At user request, [exact validation feedback](compilation-retry-feedback.json) was
passed to a second Claude Compilation using the same saved Discovery. The model
corrected accountType mapping to Youth but cited extraction from an invisible
`#t option:checked` after action 22 (form_input). Validator rejected it with
UNSUPPORTED_EVIDENCE: Extraction was not observed in a textual browser result.

[Second candidate](compilation-2/candidate.json), [rejection](compilation-2/compilation-error.json),
and [precise evidence analysis](compilation-2-verification.json) are preserved.
No visible standalone Youth node exists in the recorded textual extraction states.
Selected-option metadata exists, but current output sources cannot read that label
or derive Youth from the full confirmation. No code or contract changes were made.
No artifact was accepted and no Replay ran; Test 4 remains incomplete.
The requirement to independently verify replay creation of M-1008-S1 (Youth) is
therefore still unmet. A further identical retry cannot supply a missing operation.

## Selected-option extension and successful Replay

New Compilation used the original Discovery with the additive selectedOptionLabel
contract property. No new Discovery or manual candidate/artifact edit occurred.
The third candidate passed validation and returned exact accountType Youth.

Replay SUCCESS: member M-1008, accountType Youth; confirmation identifies
M-1008-S1 (Youth). A read-only hook before session close saved the terminal UI and
localStorage. Actual sandbox state contains exactly one M-1008-S1 of type Youth.
There was one Continue dispatch and no creation retry; Replay made zero LLM calls.

- [Compilation feedback](selected-option-compilation-feedback.json)
- [Accepted artifact](compilation-3-selected-option/artifact.json) and [validation](compilation-3-selected-option/validation.json)
- [Selected-label and status readiness evidence](compilation-3-selected-option/output-readiness-validation.json)
- [Replay result](replay-selected-option/result.json), [steps](replay-selected-option/events.jsonl)
- [Terminal UI and sandbox state](replay-selected-option/terminal-state.json), [screenshot](replay-selected-option/terminal.png)
- [Independent verification](selected-option-replay-verification.json)
- [Replay runner](run-selected-option-replay.mjs): uses the unchanged Engine; its hook only records terminal evidence. Use an empty output directory for another run.

All earlier failure logs and Discovery hashes were verified unchanged. Technical
test result is passed; explicit administrator acceptance has not yet been recorded.
