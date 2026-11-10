# Reviewer evidence index

[Section 3.4 safety verification](safety-3-4/README.md) covers route/action/risk
denials, side-effect checks, sanitization and the Banking Sandbox regression.

Start here rather than reading every historical run. All banking data is synthetic.
Original logs and failures are preserved; a later fix does not change an earlier result.

[Discovery handoff verification](discovery-handoff/README.md) contains automated
SDK/real-browser tests with scripted model responses and simulated operators.
It is separate from [genuine live handoff acceptance](discovery-handoff/manual/README.md),
which closes Section 3.6 for the current web MVP.

## Genuine model-driven workflows

| Example | What it demonstrates | Entry point |
| --- | --- | --- |
| Modern M-1005 lookup | Genuine Discovery, separate Compilation, validated artifact, Replay returns ID/type/balance; administrator accepted | [Test 1](e2e-round-2/test-1-modern-M1005/README.md) |
| Legacy M-1006 lookup | Same pipeline on Legacy UI; Claude navigated to direct content page, so not proof of staying in iframe | [Test 2](e2e-round-2/test-2-legacy-M1006/README.md) |
| Awkward M-1007 lookup | Original false success with placeholder retained; saved-evidence recompilation and Replay correctly return $0.00 | [Test 3](e2e-round-2/test-3-awkward-M1007/README.md) |
| Modern M-1008 Youth creation | Recompiled after selected-option support; actual terminal storage confirms exactly M-1008-S1 (Youth) | [Test 4](e2e-round-2/test-4-modern-M1008-youth/README.md) |
| Awkward M-1010 Youth creation | Recovered pre-dispatch failure audited, excluded from artifact; recompiled and Replay independently confirms M-1010-S1 | [Test 6](e2e-round-2/test-6-awkward-M1010-youth/README.md) |
| Parameterized public workflows | Real discovery/compilation and table artifact replay with two row inputs | [Capability v2](capability-v2/README.md) |

For the shortest audit, inspect Modern Test 1:
[Discovery](e2e-round-2/test-1-modern-M1005/discovery-2/discovery-v2.json),
[events](e2e-round-2/test-1-modern-M1005/discovery-2/events.jsonl),
[candidate](e2e-round-2/test-1-modern-M1005/compilation/candidate.json),
[validation](e2e-round-2/test-1-modern-M1005/compilation/validation.json),
[artifact](e2e-round-2/test-1-modern-M1005/compilation/artifact.json),
[Replay events](e2e-round-2/test-1-modern-M1005/replay/events.jsonl),
[result](e2e-round-2/test-1-modern-M1005/replay/result.json) and
[independent verification](e2e-round-2/test-1-modern-M1005/verification.json).

For creation, [Test 4 verification](e2e-round-2/test-4-modern-M1008-youth/selected-option-replay-verification.json)
compares outputs, source hashes and actual terminal sandbox storage. Selection alone
is not proof of creation. Test 6 also preserves rejected/truncated compilations.

## Failures and regression evidence

- [Original Case 2 negative Replay](modern-ui-testing/test-2-current-state/README.md):
  actual browser failure after a weak confirmation wait; not rewritten as success.
- [Runtime §3.3](runtime-3-3/README.md): hand-authored artifacts run in real browsers,
  including NOT_FOUND, VALIDATION_ERROR, SLOW_LOADING, TIMEOUT, permission/session
  errors, unexpected dialog, ambiguous target and safe OUTCOME_UNKNOWN.
- [Committed-but-unverified result](runtime-3-3/2026-11-02-final/banking/committed-but-unverified/result.json):
  one actual sandbox write, no retry, no declared success. Its directory includes
  artifact, policy, events, screenshot and assertions checking actual storage.
- [Weak checkpoint rejection](runtime-3-3/2026-11-02-final/unit/historical-checkpoint/rejection.json):
  validates historical Discovery; manually strengthened candidate is a labeled
  regression fixture, not Claude output.
- [Output readiness](output-readiness/README.md): delayed valid values, permanent
  placeholders, valid zero and saved-evidence recompilation/live Replay.
- [Selected option extraction](selected-option-extraction/README.md) and
  [recovered Discovery acceptance](discovery-recovery/README.md): generic extensions,
  rejection cases and real follow-up runs linked separately from unit fixtures.
- [Legacy creation defect](e2e-round-2/test-5-legacy-M1009-youth/README.md): administrator
  accepted defect detection. Discovery stopped; no successful Compilation/Replay.

## Reading a run

Discovery records observations/actions and raw audit. Compilation records the model
request/response and candidate. validation.json records deterministic checks and
hashes; artifact.json is the reusable workflow. Replay events.jsonl records steps,
waits and errors; result.json is the structured outcome. Screenshots/DOM and separate
verification files support diagnosis. A test index explains retries and limitations.

Historical indexes: [initial spike](browser-use-spike/), [v1 slice](vertical-slice/README.md),
[Modern](modern-ui-testing/), [Legacy](legacy-ui-testing/), [Awkward](awkward-ui-testing/).
The initial reviewer cleanup retained all files. A subsequent cleanup moved 140
repeat-run files into an ignored local archive; see the file-by-file
[manifest](archive-manifest.json). Run-specific summary logs and the original runtime
suite remain. Genuine Claude runs, failure/fix evidence and test dependencies are retained.

## Replay human handoff

[Handoff verification](handoff/README.md) covers same-session continuation,
unresolved recovery, uncertain writes and CLI abort. Real-browser tests use a
simulated operator; live human acceptance remains pending. No new Claude run.
