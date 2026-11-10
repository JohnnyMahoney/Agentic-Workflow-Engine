# Replay human handoff

Opt-in, Replay-only control transfer in the existing browser/context. No Claude
call, artifact rewrite, automatic rediscovery or workflow restart.

This page describes Replay. Discovery uses the same controller with different
admission rules: see [Discovery handoff](discovery-handoff.md).

Replay records dispatch state for each attempt. A detector failure before the
adapter operation starts permits one post-handoff attempt, including click/fill/
selectOption, only with no pending mutations and successful policy, detector and
unique visible target checks. A timeout inside an adapter operation is not proof
of non-dispatch. Existing observation-only retries and confirmation rules remain;
potentially executed writes are never retried through this path.

While paused/verifying, the adapter combines CDP input suppression with capture-phase
page event cancellation in the page and frames. The second guard also blocks events
that reach the DOM independently of CDP injection. It is removed logically on
take-control without modifying application markup. Browser chrome/devtools are not
locked, and page scripts keep running. During normal automation, input is enabled.

## Run locally

Start the bundled sandbox in another terminal: npm.cmd run sandbox:serve.
Then run this saved, hand-authored session-expiry runtime fixture:

```powershell
$run = Join-Path 'evidence/handoff-demo' (Get-Date -Format 'yyyy-MM-ddTHH-mm-ss')
npm.cmd run capability:replay -- --artifact examples/handoff/artifact.json --input memberId=M-1001 --input accountType=Savings --policy examples/handoff/policy.json --out "$run" --handoff
```

Use an interactive local terminal. --handoff cannot be combined with --headless.
When launched by a sandboxed coding agent, the visible window may require an
unsandboxed launch to appear on the operator's Windows desktop.

1. Replay stops at waitSearch with SESSION_EXPIRED. The browser remains open.
2. The paused page ignores mouse/keyboard input. In the terminal type take-control.
   Wait for the human-control acknowledgement; page input is now enabled.
3. In the SAME browser click Log in again. Set the sandbox TEST PANEL mode to NONE
   (do not Reset), then click Search. Wait for the correct member's result row.
   The fixture continually re-injects session expiry until its mode is changed;
   login alone is insufficient. This is test fault removal, not engine behavior.
4. Type resume in the terminal. Page input is blocked again during verification.
5. Replay verifies the existing row condition, continues, and returns its output.

Type abort to terminate. EOF or Ctrl+C while awaiting operator input also aborts.
The intervention deadline is five minutes, including time under human control.
Closing the browser terminates handoff as unresolved. Ordinary runs without
--handoff retain their existing failure/cleanup behavior.

## Deterministic recovery rules

The engine saves completed step IDs, pending mutations and extracted values in
memory. It never restarts the workflow. Each failed step gets at most one
intervention and one safe recovery attempt.

- HUMAN_COMPLETED: existing conditions prove completion. A failed wait/assert uses
  its contiguous condition group; an explicit stateChanging step requires following
  contiguous wait/assert conditions with a confirms link. Every associated check
  must pass, including identity/type conditions. Every pending write must be covered
  by a verified confirms relationship before human completion is accepted.
- SAFE_RETRY: extract/wait/assert, or a proven beforeDispatch operation after policy,
  detector and target checks, with no pending mutations. This is one
  additional bounded execution; extract's normal retry budget is not restarted.
- HANDOFF_UNRESOLVED: insufficient postconditions, failed verification/retry,
  invalid current origin, an ongoing detector, a closed session or operator timeout.
  An outstanding mutation gives status OUTCOME_UNKNOWN and reconciliationRequired.
- HANDOFF_ABORTED: operator/terminal abort; pending mutations still take precedence
  for OUTCOME_UNKNOWN. All unresolved/aborted results are non-retryable.

Started or unknown-dispatch clicks/navigation/fill/select are never repeated by
this recovery path; proven beforeDispatch operations may execute once. A generic click has no explicit postcondition link in this contract, so
an arbitrary later global checkpoint is not used to pretend it completed.
Missing/ambiguous targets, wait/output timeouts, failed assertions, transient
loading, session expiry and unexpected dialogs are eligible. Policy denial,
business refusal, malformed artifacts and unknown programming errors stop normally.
Final checkpoint failures outside the step loop do not request handoff in this slice.

## Evidence and scope

Each intervention writes handoff-<step>-request.json and sanitized before/after
DOM diagnostics as handoff-<step>-<phase>.png.json; raw images are omitted. events.jsonl records ownership, rejected commands,
manual clicks/input/change/submit/navigation metadata, verification observations
and the recovery decision. Manual event records omit values, keystrokes, target text
and URL query strings. Current persistence is sanitized and restricted to trusted
synthetic/public fixtures; see [Safety](safety.md) for classification limits.

The observer covers the controlled page and its frames, including subsequent
navigations. It does not capture OS actions, developer-tools changes or other tabs.
Automation issues no workflow actions while human control is active. Chromium
input blocking enforces the paused/verifying phases, including page keyboard input
and same-page frames. Input is enabled during human control and restored for
automation after verification: Chromium also blocks Playwright clicks when input
is disabled. This is not exclusive OS-level ownership during automated execution;
browser toolbar, window closing and developer tools are outside the page lock. The process must remain alive; no crash-resume persistence.

The existing native-dialog handler dismisses dialogs before escalation; this slice
does not replace it with a native-dialog operator UI. Recovery conditions establish
the artifact's declared state, not every possible hidden backend side effect.
[Discovery handoff](discovery-handoff.md) uses the same controller. A dashboard
and additional approval UI are outside scope.

## Verification

npm.cmd test includes the handoff regressions. Set HANDOFF_EVIDENCE_DIR to a fresh
directory to retain generated test artifacts. The real-browser tests use a
simulated operator; they do not constitute a live human acceptance run or new
Claude Discovery. See [retained test results](../evidence/handoff/README.md) and
[separate live operator acceptance](../evidence/discovery-handoff/manual/README.md).
