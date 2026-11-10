# Replay handoff verification

No new Claude Discovery or Compilation. Artifacts here are hand-authored test
fixtures. Browser tests use a simulated operator, not a claimed live human run.

- [Final handoff tests](tests-final.log): 8/8 passed.
- [Full regression suite](full-suite-final.log): 32/32 passed. The final subsequent
  change added structural target paths to manual-event metadata and was checked
  by rerunning all eight handoff tests.
- [Existing Banking Sandbox suite](banking-compatibility.log): 12/12 passed.
  Detailed repeated runtime files are kept in the ignored local archive.
- [Build](build.log) and [typecheck](typecheck.log): exit 0.

## Representative cases

| Case | Expected behavior | Result |
| --- | --- | --- |
| [Five steps](regression-final/five-step/result.json) | Step 3 confirmed by operator; 1-2 not repeated; 4-5 execute; saved outputs retained | SUCCESS |
| [Real Chromium](regression-final/real-browser/assertions.json) | Same context, real UI remediation, manual-event metadata, screenshots before/after | SUCCESS |
| [Banking session expiry](regression-final/banking-session-expired/assertions.json) | Login, disable injected expiry via UI, search, verify and continue | SUCCESS |
| [Unresolved condition](regression-final/unresolved/result.json) | One safe check retry, then stop | HANDOFF_UNRESOLVED |
| [Uncertain write](regression-final/write-unresolved/result.json) | One original dispatch, zero write retries | OUTCOME_UNKNOWN |
| [Wrong identity after write](regression-final/write-wrong-identity/result.json) | Matching account type alone cannot confirm mutation | OUTCOME_UNKNOWN |
| [Confirmed write](regression-final/write-confirmed/result.json) | All identity/type conditions pass, confirms clears pending write | SUCCESS |
| [No click postcondition](regression-final/TARGET_NOT_FOUND/result.json) | Resume cannot invent a postcondition or repeat the click | HANDOFF_UNRESOLVED |
| [Safe read](regression-final/safe-read/result.json) | One additional read without restarting earlier steps | SUCCESS |
| [Operator deadline](regression-final/deadline/result.json) | Close cleanly, no automatic continuation | HANDOFF_UNRESOLVED |
| [Browser closed](regression-final/closed/result.json) | Detect closed session while paused | HANDOFF_UNRESOLVED |
| [Real CLI abort](cli-abort/result.json) | Premature resume rejected; take-control then abort in an actual PTY | HANDOFF_ABORTED |

Each final case includes the artifact, events and structured result; browser cases
also include before/after screenshots. Tests assert the original artifact bytes
remain unchanged. Mock adapters report capture unavailable, never fake screenshots.
The CLI smoke test was driven by the coding agent, not an independent human.

## Initial failure preserved

[First sandbox attempt](regression/banking-session-expired/result.json) stopped
unresolved after login. The unchanged sandbox's SESSION_EXPIRED mode re-injects
expiry on every call. The corrected simulated operator sets TEST PANEL to NONE
before searching again, without Reset or direct storage edits. [Initial log](tests.log)
and failure screenshots remain. Earlier passing development duplicates are local
only; final cases above are the reviewer-facing set.

## Limits

Live human acceptance is pending. Discovery handoff, other tabs, OS-level input
locking and crash recovery are not implemented. Generic actions lacking linked
postconditions stop unresolved. No potentially modifying operation is retried.
Output text and screenshots use synthetic fixtures; production redaction remains
separate work. [Operator guide](../../docs/handoff.md) includes a reproducible CLI demo.
