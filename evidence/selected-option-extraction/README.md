# Selected option extraction

Additive `extract.property: selectedOptionLabel` through Capability v2.1, Claude
Compilation, Builder, Replay property forwarding and Playwright Surface Adapter.
No Discovery changes. Omitted property and `text` retain the earlier behavior.

- [20 passing tests](tests-2.log), including all existing actions/readiness cases.
- [Recorded selection checks](regression-2/builder/assertions.json).
- [Successful selection and independent creation confirmation](regression-2/confirmed/assertions.json).
- [Selected Youth without creation confirmation](regression-2/blocked/assertions.json):
  OUTCOME_UNKNOWN at confirm; exactly one modifying dispatch, no success output.
- Adapter tests check label differs from value, unchanged ordinary text reads,
  hidden/non-select targets, multi-select and missing selection.

`tests.log` retains the initial test run: one expected error message did not match
because an earlier selectOption validation rejected missing metadata first. The
assertion was corrected; production validation was not weakened. `tests-2.log`
is the complete passing run.

## Test 4 saved-evidence recompilation

Original Discovery and both rejected candidates were preserved; their
[hashes](original-hashes.json) were verified after replay. No new Discovery or
manual candidate/artifact editing occurred.

- [Third compilation artifact](../e2e-round-2/test-4-modern-M1008-youth/compilation-3-selected-option/artifact.json).
- [Selected-option evidence/readiness report](../e2e-round-2/test-4-modern-M1008-youth/compilation-3-selected-option/output-readiness-validation.json).
- [Replay result](../e2e-round-2/test-4-modern-M1008-youth/replay-selected-option/result.json):
  SUCCESS, M-1008, Youth, confirmation for M-1008-S1 (Youth), zero LLM calls.
- [Terminal UI and actual sandbox state](../e2e-round-2/test-4-modern-M1008-youth/replay-selected-option/terminal-state.json):
  exactly one Youth sub-account, reference M-1008-S1, under M-1008.
- [Terminal screenshot](../e2e-round-2/test-4-modern-M1008-youth/replay-selected-option/terminal.png).
- [Independent verification](../e2e-round-2/test-4-modern-M1008-youth/selected-option-replay-verification.json).

The Replay runner uses the production Engine and model-generated artifact. Its
adapter close hook only reads terminal UI/localStorage and captures a screenshot;
it adds no UI actions or workflow decisions. The original first two compilation
rejections remain part of the test history.

Selection alone proves no business write. This run separately verified the
post-action confirmation and actual stored sandbox state. It used an isolated
browser context and does not modify the user's open Chrome session. Native
multi-select and other control properties remain unsupported. Explicit
administrator acceptance of the repaired Test 4 is pending.

Run `npm.cmd test`; optionally set `SELECTED_OPTION_EVIDENCE_DIR` to a fresh
directory to retain the fixture evidence (default is a temporary directory).
