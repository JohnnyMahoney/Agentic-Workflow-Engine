# Output readiness verification

Fix for the false-success balance extraction in Awkward UI Test 3 (M-1007).
No Discovery or sandbox implementation changes. No manual edit to the failing
artifact. Original run files are preserved; [SHA-256 hashes](original-hashes.json)
were checked after the new compilation and replay.

## Code and runtime tests

- [17 passing unit/regression tests](tests-2.log), including the earlier actions.
- [Delayed valid value](regression-2/delay/assertions.json).
- [Valid zero](regression-2/zero/assertions.json).
- [Permanent placeholder](regression-2/permanent/result.json):
  RECOVERABLE_ERROR / OUTPUT_VALIDATION_TIMEOUT at extract, no success outputs;
  [failure screenshot](regression-2/permanent/failure.png).
- [Recorded-state validator checks](regression-2/builder/assertions.json):
  accepts the positive zero sample, rejects a condition accepting an observed
  intermediate value, rejects a condition contradicting the positive sample.
- Pattern tests cover malformed/blank patterns, full-string matching, parameter
  equality and bounded evaluation of a pathological expression.
- [12 passing existing Banking Sandbox compatibility cases](banking-tests.log)
  with isolated state. Detailed compatibility rerun files were moved to the ignored
  local archive ([manifest](../archive-manifest.json)); the summary log above remains.
  The [original runtime suite](../runtime-3-3/README.md) is retained in full.

`tests.log` and `regression/` retain an earlier harness failure: screenshot capture
inherited the expired output-read timeout. The final implementation resets the
capture budget; `tests-2.log` and `regression-2/` are the passing results.

## Genuine saved-evidence recompilation and replay

- [Original failed test](../e2e-round-2/test-3-awkward-M1007/verification.json).
- [Original Discovery reused unchanged](../e2e-round-2/test-3-awkward-M1007/discovery/discovery-v2.json).
- [First new candidate rejected](../e2e-round-2/test-3-awkward-M1007/compilation-readiness/compilation-error.json):
  model changed an output description; validation was not weakened.
- [Second Claude compilation](../e2e-round-2/test-3-awkward-M1007/compilation-readiness-2/compilation-call.json),
  [v2.1 artifact](../e2e-round-2/test-3-awkward-M1007/compilation-readiness-2/artifact.json),
  [readiness evidence report](../e2e-round-2/test-3-awkward-M1007/compilation-readiness-2/output-readiness-validation.json).
- [New Replay result](../e2e-round-2/test-3-awkward-M1007/replay-readiness/result.json):
  SUCCESS, M-1007, `$0.00`, outputReadiness validated, zero LLM calls.
- [Polling events](../e2e-round-2/test-3-awkward-M1007/replay-readiness/events.jsonl):
  rejected 17 placeholder samples, accepted `$0.00` at 981 ms.
- [Independent output and integrity verification](../e2e-round-2/test-3-awkward-M1007/readiness-verification.json).

The recorded Discovery contains only the final balance value, not its placeholder.
Builder therefore proves positive-sample compatibility, not complete readiness.
The new live Replay separately demonstrates rejection of that placeholder.
The model's currency pattern permits forms not demonstrated by this one recording;
those forms, general freshness, and full financial-format semantics are not proven.
Administrator acceptance of the repaired test remains pending.

## Commands

```powershell
npm.cmd test
npm.cmd run test:banking
npm.cmd run capability:compile -- --evidence evidence/e2e-round-2/test-3-awkward-M1007/discovery/discovery-v2.json --feedback evidence/e2e-round-2/test-3-awkward-M1007/verification.json --policy evidence/e2e-round-2/test-3-awkward-M1007/policy.json --out <new-compilation-directory>
npm.cmd run capability:replay -- --artifact <new-compilation-directory>/artifact.json --input memberId=M-1007 --policy evidence/e2e-round-2/test-3-awkward-M1007/policy.json --out <new-replay-directory>
```

Use new output directories for each run. Compatibility artifacts from v2.0 may
still report legacy-unverified; recompile to obtain v2.1 output-readiness coverage.
