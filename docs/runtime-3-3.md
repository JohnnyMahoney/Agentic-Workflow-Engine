# Runtime contract (§3.3)

The architecture is unchanged. The capability stays surface-independent; the
Playwright adapter owns browser handles. Replay imports no Claude client.

## Conditions and confirmation

`visible`, `textEquals`, and `urlHash` remain supported. `textContains` works in
wait/assert/final checkpoints, requires nonempty text, and accepts literal or
input references. Example strengthening of the Case 2 confirmation:

```json
[
  {"id":"clickContinue","action":"click","target":"continueButton","effect":"stateChanging"},
  {"id":"waitConfirmation","action":"wait","timeoutMs":10000,
   "condition":{"kind":"textContains","target":"confirmationStatus","value":{"literal":"opened for"}}},
  {"id":"verifyMember","action":"assert",
   "condition":{"kind":"textContains","target":"confirmationStatus","value":{"input":"memberId"}}},
  {"id":"verifyType","action":"assert","confirms":"clickContinue",
   "condition":{"kind":"textContains","target":"confirmationStatus","value":{"input":"accountType"}}}
]
```

These are application artifact values, not engine constants. Validate the specific
identity/type semantics against recorded evidence; substring matching alone is
not a universal identity proof. Stronger exact/scoped targets can use textEquals.
A `visible` condition cannot confirm an explicit stateChanging action.

Builder rejects an element condition if it accepts a distinct intermediate text
between the preceding action and cited success. It does not guess that any
particular word means loading. Absent intermediate targets are not counterexamples;
ambiguous evidence fails closed. This is known-state validation, not a proof of
all possible UI states. Old artifacts parse, but already saved artifacts are not
automatically upgraded or silently recompiled during replay.

Retry compilation with the original saved evidence and validation diagnostics:

```powershell
npm.cmd run capability:compile -- --evidence <discovery>/discovery-v2.json --feedback <failed-compilation>/compilation-error.json --policy <policy.json> --out <new-compilation-directory>
```

## Result and policy

ExecutionResult includes status, code, stepId, retryable, evidenceRef, and where
applicable expected/observed, outputs, details, reconciliationRequired. Statuses:

| Status | Meaning |
| --- | --- |
| SUCCESS | Declared checkpoints passed; explicit writes confirmed |
| BUSINESS_OUTCOME | A trusted UI detector observed a business refusal/result |
| RECOVERABLE_ERROR | Bounded wait timed out or a configured transient state blocks progress |
| HARD_FAILURE | Missing/ambiguous target, unexpected dialog, failed assertion, policy denial, or explicit hard-outcome detector |
| OUTCOME_UNKNOWN | A possibly modifying action remains unconfirmed; reconcile actual state |

Codes retain the cause (e.g. WAIT_TIMEOUT under OUTCOME_UNKNOWN). Permission and
session expiry are never inferred from a timeout. Optional policy detectors use
inline Target Registry locator syntax and nonempty textContains values:

```json
{
  "code":"VALIDATION_ERROR",
  "status":"BUSINESS_OUTCOME",
  "target":{"strategies":[{"kind":"css","selector":"[role=alert]","frames":[]}]},
  "value":{"literal":"VALIDATION_ERROR:"},
  "resolvesMutations":["clickContinue"]
}
```

`resolvesMutations` is trusted configuration: supply it only when this observed
state conclusively means those specific operations were rejected, not committed.
Without it, an outstanding write overrides the detector status to OUTCOME_UNKNOWN.
Multiple terminal matches fail closed. RECOVERABLE_ERROR detectors block progress
until they disappear within a wait; other steps stop instead of acting through them.
Native browser dialogs are recorded and dismissed to unblock failure capture, then
execution stops; this is not human handoff or a generic dialog recovery routine.

## Bounds and safety

- wait: explicit 1–30000 ms deadline, polling up to every 50 ms; browser operations
  during polling have a remaining-budget timeout capped at 1000 ms.
- final checkpoints: 5000 ms each; ordinary browser operations: 5000 ms each.
  Browser scheduling and multiple probes can add bounded overhead to a deadline.
- extract: optional `retry: {"maxAttempts":3,"delayMs":100}`; max 3 attempts and
  max 1000 ms delay, only for TARGET_NOT_FOUND. Ambiguity is never retried.
- click/fill/selectOption/navigation are never reissued by the engine. Playwright
  still performs its normal actionability waits before dispatch.
- `effect: readOnly` is an explicit assertion about the application; default is
  potentially modifying. DOM evidence cannot prove absence of server side effects.
- `retryable` is false after any potentially modifying dispatch, even if its
  confirmation succeeded before a later failure. No automatic workflow restart.
  OUTCOME_UNKNOWN closes the test browser and requires external reconciliation.

The engine records conditions, attempts, retry delays, detector observations and
results. Screenshots are from the synthetic/public test surfaces only. Unit mocks
are labeled diagnostic fixtures and do not pretend to provide browser screenshots.
No human handoff, resume, conditional workflow engine, database, or production
redaction system is introduced here.
