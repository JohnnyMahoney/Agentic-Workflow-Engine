# Discovery human handoff

Discovery supports opt-in `--handoff` with `take-control`, `resume`, and `abort`
in an interactive terminal. It reuses the [Replay controller](handoff.md), the
same Chromium browser/context/page, and the same SDK toolRunner conversation.
No artifact or browser session is replaced during intervention.

## Control flow

1. Claude calls the typed SDK `request_human` tool with a reason, description and
   optional attempted recovery. Reasons are AUTH_REQUIRED, UNKNOWN_BLOCKER,
   ACTION_STUCK, RISK_APPROVAL and OTHER. Routine dialogs remain agent work.
2. Independently, the driver escalates repeated failures or unchanged textual
   observations before the next action. API/network errors stop normally; they
   are not converted into requests for an operator.
3. Browser and human tools share a serial execution queue. Automation pauses and
   page input is locked until `take-control`. The request includes the goal, URL,
   preceding action/dispatch state, evidence path and before screenshot.
4. `take-control` enables page input and records manual event metadata. Entered
   values/keystrokes are omitted. `resume` locks page input during evidence capture.
   Toolbar/devtools and page scripts are outside this input lock.
5. Resume checks the URL against policy, captures the resulting state, invalidates
   refs and requires a fresh `read_page` before further browser actions. Queued
   actions based on the old observation are rejected without dispatch. The tool
   reports operator return, never proof of business success.
6. Claude reassesses the page in the existing conversation. A persistent blocker
   may request another intervention; three are allowed. Each operator wait is
   bounded to five minutes. The 180-second active Discovery budget pauses during
   intervention. Abort, timeout, closed browser or exhausted limits stop the run.

Human approval does not override policy. A potentially dispatched failed browser
action is not retroactively declared safe: existing admission rules still reject
unconfirmed effects. The request itself executes no browser business action.

## Admission and trusted blocker policy

Human actions are stored separately from executable Discovery actions. Admission
checks intervention/audit consistency; Compilation preflight and Builder also run
offline, network-disabled DOM verification before accepting human-assisted evidence.

The Discovery CLI runs that same human-evidence verification before reporting
recorded-for-compilation. A configured blocker still present after Resume returns
DISCOVERY_HANDOFF_UNRESOLVED and writes a rejected discovery-admission.json.
An ordinary model end_turn, including an honest refusal, does not bypass this check.

The approved MVP supports a narrow trusted `humanBlockers` policy: exact URL,
main-document container selector, and its dismissal control. The policy author
certifies that the control only removes a temporary blocker. Automation cannot
click/type inside that reserved container. Verification requires recorded trusted
clicks solely on the declared control, container removal, and unchanged remaining
DOM and frames. No-action, unchanged-state intervention needs no dismissal proof,
but an outstanding configured blocker is rejected.

DOM equality cannot prove the absence of hidden server effects. This is a trusted
fixture contract, not automatic certification of arbitrary authentication screens.
Typing credentials, human-only business work, iframe dismissal, navigation, or
unrelated DOM changes fail closed with `HUMAN_EVIDENCE_UNVERIFIED`. Human-only steps
are never invented in the artifact. Fresh Replay may encounter the blocker again
and uses its own deterministic handoff; Discovery dismissal does not bypass it.

## Verification and scope

Run `npm.cmd test`, or build then run
`node --test dist/tests/discovery-handoff.test.js dist/tests/handoff.test.js`.
Discovery integration tests use the actual SDK runner and Chromium but scripted
API responses and simulated operators. The successful case validates a
hand-authored candidate and replays it in a fresh browser with another intervention.
This is not a genuine Claude Discovery or Compilation run.

See [test evidence](../evidence/discovery-handoff/README.md) and the
[live demo commands](../examples/discovery-handoff/README.md). Live Claude
Discovery -> Compilation -> fresh Replay with a real operator has passed within
the controlled web MVP. See [five live scenarios and limitations](../evidence/discovery-handoff/manual/README.md). Section 3.6 is accepted for that scope.

Only synthetic/public data is supported for this demo: screenshots, page text and
model replies are not a production-grade credential/PII redaction boundary.
