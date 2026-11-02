# Modern UI — Case 2: ensure Savings sub-account for M-1001

**Status:** Failed during Claude Discovery. No Compilation, Validation, or Replay
was run after the discovery failure. The code and contract were not changed. The
sandbox was not reset.

The [request](request.json) stores the user's goal verbatim. The [policy](policy.json)
uses the existing localhost allowlist. The current CLI launches a new browser
context, so its localStorage state is separate from any previously open browser
session. This test reports what Claude observed in that new session.

## What Claude observed

The [discovery summary](discovery-2/summary.json) states that M-1001 (Anna
Kovalenko) had `Sub-accounts: none` in this session. Claude correctly proceeded
to the new sub-account form. It could not select Savings: two `form_input` calls
on the native dropdown failed with `Element is not an input, textarea or
contenteditable`; subsequent coordinate clicks did not change the selected
option. Claude left the form with `— select —`, did not submit it, and reported
that no account was created.

The [action log](discovery-2/events.jsonl) and
[recorded states](discovery-2/discovery-v2.json) retain 32 actions, including two
failed tool actions. The evidence has `completed: false`, so it cannot pass the
Builder preflight for compilation. Builder's ability to represent a successful
existing-account or creation branch was not established; Playwright replay did
not occur. [Machine-readable status](run-status.json) records these stage results.

The first CLI invocation failed before browser launch because the generated
request file had a UTF-8 BOM. The file was rewritten without the BOM and the
second invocation produced the discovery evidence above. No Reset was used.

## Repeat run

A fresh [Claude discovery](discovery-3/summary.json) with the same
[request](request.json) and [policy](policy.json) failed at the same stage.
The [event log](discovery-3/events.jsonl) and
[recorded evidence](discovery-3/discovery-v2.json) contain 31 actions, including
two failed `form_input` attempts on the native Account type dropdown. Claude
observed `Sub-accounts: none`, opened the form, and could not select Savings.
It did not press Continue, and no sub-account was created. The
[repeat status](repeat-status.json) records the exact stage outcomes. As requested,
compilation, validation, and replay were not run after discovery failed.

## Native select support follow-up

The Discovery Driver now dispatches `form_input` to Playwright `selectOption()`
for native `<select>` elements and keeps `fill()` for text fields. A regression
test verifies that choosing Savings changes the actual selected value. All six
tests passed before rerunning the case. The same request and policy were used;
there was no Reset.

[Discovery 4](discovery-4/summary.json) completed with 27 successful actions.
Claude observed `Sub-accounts: none` in its own new browser context, selected
Savings, received a simulated confirmation for `M-1001-S1 (Savings)`, and read
the account again. The [recorded evidence](discovery-4/discovery-v2.json) and
[action log](discovery-4/events.jsonl) preserve the sequence.

[Compilation 1](compilation-1/compilation-error.json) was rejected because the
candidate changed output descriptions from the request. The same discovery was
compiled again with this [validation feedback](compilation-feedback.json).
[Compilation 2](compilation-2/validation.json) validated and saved an
[artifact](compilation-2/artifact.json).

[Replay 2](replay-2/result.json) failed at `fillType`. The contract represented
the select operation as `fill`, and the Replay Adapter called Playwright `.fill()`
on `<select id="t">`. Playwright rejected it. The [replay log](replay-2/events.jsonl)
and [failure screenshot](replay-2/failure.png) preserve the exact failure. The
first replay CLI invocation failed before browser launch because PowerShell
mangled a JSON argument; replay 2 used two `--input` arguments.

The current DOM snapshot records the select's HTML but not its selected property:
its before and after HTML are identical even though Discovery selected Savings.
The Builder validated action identity and input binding, but could not verify
selected option state. The saved artifact is linear and does not encode a branch
for an existing Savings account or prevent a duplicate during replay. Browser
contexts have independent `localStorage`; the prior state of a user's open
browser was not visible to these fresh sessions.

[Machine-readable stage status](select-support-status.json) summarizes this
follow-up. No sub-account was created in the failed replay session.

## Capability `selectOption` follow-up

The contract now supports `selectOption` by option label or value, with a literal
or input binding. The Discovery Driver records the actual selected label and
value; Builder checks the selected after-state; Replay Adapter calls Playwright
`selectOption()`. Eight tests passed, including both parameterized selection
modes and regression coverage for older actions. The new
[policy](policy-select.json) explicitly allows `selectOption`.

[Discovery 5](discovery-5/summary.json) used the same goal without Reset and
completed with 30 successful actions. It observed `Sub-accounts: none` in its
new browser context, selected Savings (the [recorded state](discovery-5/discovery-v2.json)
changed from `— select —` to `Savings`), then observed simulated creation and
one Savings sub-account on the details page. The [action log](discovery-5/events.jsonl)
contains the complete run.

[Compilation 3](compilation-3/compilation-error.json) was rejected because Claude
changed output descriptions. A retry using the existing
[validation feedback](compilation-feedback.json) produced a
[validated artifact](compilation-4/artifact.json) and
[validation report](compilation-4/validation.json) with the new `selectOption`
action.

**Replay was not started.** The validated artifact always clicks Open sub-account
and Continue. It does not check for an existing Savings sub-account or branch to
an existing-account outcome. Running it against a session with Savings already
present could create a duplicate, contrary to the goal. This is a new business
workflow limitation, separate from native select support. The
[stage status](select-option-status.json) records the stop. The user's open
browser state was not reused by the isolated test contexts.

## User-authorized replay of the validated select artifact

[Replay](replay-select-1/result.json) was run in a fresh isolated Playwright
context with `memberId=M-1001` and `accountType=Savings`; it made zero LLM calls.
The [event log](replay-select-1/events.jsonl) shows `selectAccountType` and
`clickContinue` completed. The run then failed at `clickBack` with
`TARGET_NOT_FOUND`.

The [failure screenshot](replay-select-1/failure.png) shows `Loading...`, not a
confirmation. The artifact's `waitConfirmation` target, `#out p[role=status]`,
matched that transient loading message. `extractStatus` therefore completed too
early, and the Back button did not exist yet. The browser context closed on
failure. **This replay does not establish that a sub-account was created.** No
success result was returned. The [stage report](replay-select-status.json)
records the completed steps and the precise limitation. The artifact and code
were not changed after this result.
