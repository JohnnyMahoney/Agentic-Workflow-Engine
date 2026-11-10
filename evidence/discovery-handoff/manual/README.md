# Live human handoff acceptance - Section 3.6

**Status: accepted for the current web MVP**, following real Claude Discovery,
separate Claude Compilation, deterministic validation and fresh-session Replay
with the developer acting as the human operator. Runs were executed locally;
directory names retain the host clock while event timestamps are UTC.

| Test | Actual result | Evidence |
| --- | --- | --- |
| 1. No intervention needed | Modern lookup completed with zero handoff requests; Replay SUCCESS: M-1005, Term Deposit, $50,000.00 | [Discovery](test1-20261109-184343/discovery/summary.json), [validation](test1-20261109-184343/compilation/validation.json), [Replay](test1-20261109-184343/replay/result.json) |
| 2. Operator resolves blocker | One real handoff during Discovery; dismissal validated; fresh Replay needed another handoff and returned SUCCESS: M-1001, Checking, $2,450.75 | [Discovery events](test2-guard-20261109-185606/discovery/events.jsonl), [validation](test2-guard-20261109-185606/compilation/validation.json), [artifact](test2-guard-20261109-185606/compilation/artifact.json), [successful Replay](test2-guard-20261109-185606/replay-fixed-20261109-191628/result.json), [Replay events](test2-guard-20261109-185606/replay-fixed-20261109-191628/events.jsonl) |
| 3. Resume without resolving blocker | Replay HANDOFF_UNRESOLVED before dispatch. Claude honestly refused after rereading the blocked page; current offline admission rejects the saved Discovery | [Replay](test3-20261109-191727/replay/result.json), [Discovery response](test3-discovery-20261109-191823/discovery/summary.json), [admission revalidation](../closure/admission-revalidation.json) |
| 4. Abort | Discovery audit records HANDOFF_ABORTED and incomplete run; Replay returns HANDOFF_ABORTED before dispatch | [Discovery audit](test4-20261109-192129/discovery/events.jsonl), [Replay](test4-replay-20261109-192228/result.json) |
| 5. Manual business actions | Operator dismissed blocker and performed lookup. Admission rejected HUMAN_EVIDENCE_UNVERIFIED; no accepted artifact | [Admission](test5-20261109-192255/discovery/discovery-admission.json), [manual events](test5-20261109-192255/discovery/events.jsonl) |

## Requirement coverage

- Detection/routing: typed request_human includes goal, reason, URL, prior action,
  evidence reference and screenshot. Replay uses explicit UI outcome detectors.
- Same live session: automation pauses, take-control transfers ownership, manual
  events are recorded, resume returns control. Discovery re-observes with fresh
  refs; Replay verifies deterministic recovery requirements. The fresh Replay
  session is separate from Discovery; each individual handoff preserves its session.
- Safe continuation: Test 2 records SAFE_RETRY only for an action proven not to
  have started, then executes it once. Tests 3-5 demonstrate refusal and abort.
  Automated regressions additionally cover uncertain writes and five-step recovery.

## Findings and preserved failures

The first Test 2 attempt ran without its server. Another attempt ended unresolved.
`test2-fixed-20261109-185329` bypassed the intended handoff before the pause; it is
not accepted as a handoff success. A policy-scoped input guard now protects the
configured blocker from page load, in addition to the paused/verifying input lock.

The [original Test 2 Replay](test2-guard-20261109-185606/replay/result.json) failed
at focusMember because recovery lacked beforeDispatch proof. The successful Replay
uses the same artifact after the generic recovery fix; no new Discovery was needed.

Test 3 Discovery originally printed recorded-for-compilation despite the unresolved
blocker. Its original admission file remains unchanged. The CLI now invokes full
human-evidence admission before announcing eligibility. The separately saved
[offline revalidation](../closure/admission-revalidation.json) demonstrates rejection
with current code; it is not a repeated live run.

Discovery Abort still surfaces COMMAND_FAILED at the CLI, while the audit retains
HANDOFF_ABORTED. This is a reporting limitation, not continuation after abort.

## Acceptance boundary

This closes the minimal Section 3.6 web mechanism. It does not certify arbitrary
login/MFA flows, human-only business actions, multi-tab or OS control, crash resume,
or production PII protection. Changed-state Discovery admission supports only a
trusted, proven temporary-blocker dismissal. DOM equality cannot prove hidden
server effects. Page locks do not restrict devtools/browser chrome and are not
an adversarial security boundary. Section 3.4 remains the next implementation slice.

[Current regression log](../closure/tests.log) uses scripted APIs/simulated operators
where applicable; it is distinct from the genuine live runs above.
