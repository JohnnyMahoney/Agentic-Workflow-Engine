# E2E round 2 - Test 3: Awkward UI, M-1007

**FAILED business verification despite engine SUCCESS.**
New Claude Discovery observed M-1007 and $0.00. Separate Compilation and Validation
passed. Fresh-session Replay returned memberId M-1007 but balance was an ellipsis
placeholder, not the discovered balance. Replay made zero LLM calls.

Scope: member ID and balance only, following the administrator's earlier confirmation
that this UI does not expose account type. See [scope](scope.json).

The artifact waits for memberIdText to contain the member ID, then immediately
extracts #bal. Its sole final checkpoint is member identity. It never waits for the
balance to finish loading. Validator checks declared conditions, but not readiness
coverage of each output. Recorded snapshots containing #bal show only the final
$0.00; the transient balance placeholder was not captured in Discovery snapshots.

No code, contract, artifact or sandbox changes; no Reset or automatic retry/fix.
No replay failure screenshot exists because the engine reported SUCCESS and closed
the browser. The original result remains intact; independent verification marks
this test failed. This exposes a remaining gap in section 3.3 acceptance.

- [Request](request.json), [policy](policy.json)
- [Discovery](discovery/discovery-v2.json), [events](discovery/events.jsonl)
- [Compilation request](compilation/compilation-request.json), [candidate](compilation/candidate.json)
- [Validation](compilation/validation.json), [artifact](compilation/artifact.json)
- [Original replay result](replay/result.json), [execution steps](replay/events.jsonl)
- [Failure verification and diagnosis](verification.json)

## Output readiness follow-up

The original failure above is preserved. Recompilation from the same Discovery
evidence produced a v2.1 artifact; new Replay waited for the balance and returned
M-1007 and $0.00. No new Discovery or manual artifact patch was used.

- [Rejected compilation attempt](compilation-readiness/compilation-error.json)
- [New artifact](compilation-readiness-2/artifact.json)
- [Readiness evidence limitations](compilation-readiness-2/output-readiness-validation.json)
- [New replay result](replay-readiness/result.json) and [readiness polling](replay-readiness/events.jsonl)
- [Independent verification](readiness-verification.json)

Administrator acceptance of the repaired test remains pending.
