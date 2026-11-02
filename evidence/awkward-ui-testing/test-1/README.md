# Awkward UI — Test 1: member M-1004

**Status:** Discovery completed; full capability could not be compiled.

Target: `http://localhost:8080/awkward.html`. The [request](request.json)
provides `M-1004` and asks for balance, account type, and member ID.
The [policy](policy.json) allows the local synthetic sandbox.

| Requested output | Discovery observation |
| --- | --- |
| memberId | M-1004, shown in search results and member details |
| balance | $92,500.10, shown in member details |
| accountType | Not shown for this member in the recorded UI states |

## Evidence

- [Claude discovery summary](discovery-1/summary.json), [action log](discovery-1/events.jsonl), and [recorded DOM](discovery-1/discovery-v2.json): 32 successful actions, no tool failures.
- [First compilation response](compilation-1/candidate.txt) correctly explains the missing account type. The CLI initially reported it as an invalid candidate schema.
- After correcting the error classification, a [second compilation response](compilation-2/candidate.txt) using the same saved discovery evidence returned the same conclusion. Its [error report](compilation-2/compilation-error.json) has `COMPILATION_EVIDENCE_INSUFFICIENT`.
- Neither compilation produced a validated artifact. Replay was not run because it requires a validated artifact with all declared outputs.

The profile shows `ID: M-1004`, `Balance: $92,500.10`, and
`Sub-accounts: none`. A separate `Open` control leads to a **New sub-account**
form listing Savings, Checking, Term Deposit, and Youth. Those are creation
choices and cannot establish the member's current account type. Claude did not
choose a type or submit that form.

This is a useful fail-closed outcome: partial observations are retained, and a
missing required output does not become a fabricated capability. It does not
prove that the application has no account type elsewhere; only that this discovery
did not observe one.
