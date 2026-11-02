# Awkward UI — Test 2: narrowed goal for M-1004

**Status:** Passed on November 1, 2026.

The administrator confirmed that this UI does not contain the requested account
type. The [narrowed request](request.json) asks for only the current balance and
member ID of `M-1004`; its [policy](policy.json) allows the local sandbox.
The member ID was read from the search result and compared with the input. The
balance was read from the member profile.

| Output | Discovery and final replay |
| --- | --- |
| memberId | M-1004 |
| balance | $92,500.10 |

## Reused discovery evidence

[Provenance](provenance.json) identifies the unchanged original
[discovery](../test-1/discovery-1/discovery-v2.json) by SHA-256. The
[derived evidence](derived-discovery-v2.json) retains actions 1–16, through the
recorded profile state, and pairs them with the narrowed goal and outputs.
Later actions explored the new-sub-account form and do not belong to this goal.
No browser discovery was repeated. The original request and evidence remain in
test 1.

## Compilation and replay

- [Compilation 1](compilation-1/validation.json) produced an artifact, but [replay 1](replay-1/result.json) failed because the asynchronous search result was not yet available.
- [Compilation 2](compilation-2/validation.json) added an observed wait for the search result. [Replay 2](replay-2/result.json) reached the profile but returned the loading placeholder `…` as the balance.
- [Replay feedback](replay-feedback.json) records those failures. [Compilation 3](compilation-3/compilation-request.json) used the same saved discovery plus this feedback. The [candidate](compilation-3/candidate.json) and [validation](compilation-3/validation.json) identify a balance target that waits for completed currency text. The [artifact](compilation-3/artifact.json) contains the resulting workflow.
- [Replay 3](replay-3/result.json) succeeded in a fresh Playwright session with zero LLM calls. Its [event log](replay-3/events.jsonl) records every step. [Verification](test-verification.json) compares outputs with the recorded DOM and checks the member input and evidence hashes.

The output description inherited from the original request says the ID is read
from account details; the artifact actually extracts the exact ID from the search
result, then opens that member's profile to read the balance. The user-visible
result remains `M-1004`.

This validates the narrowed lookup on the current UI. It does not make the
original three-output goal valid, and does not establish behavior for other
members or error paths.
