# Capability v2 evidence

All live runs below use the public The Internet test site and synthetic values.
Discovery and compilation are separate real Claude API stages. Replay calls no LLM.

| Stage | Challenging DOM | Dynamic Loading |
| --- | --- | --- |
| Discovery | [recorded evidence](2026-10-31/challenging/discovery/discovery-v2.json), [summary](2026-10-31/challenging/discovery/summary.json) | [recorded evidence](2026-10-31/dynamic/discovery/discovery-v2.json), [summary](2026-10-31/dynamic/discovery/summary.json) |
| Separate compilation | [call metadata](2026-10-31/challenging/compilation-1/compilation-call.json), [candidate](2026-10-31/challenging/compilation-1/candidate.json) | [call metadata](2026-10-31/dynamic/compilation-1/compilation-call.json), [candidate](2026-10-31/dynamic/compilation-1/candidate.json) |
| Deterministic validation | [final validation and hashes](2026-10-31/challenging/validation-final/validation.json) | [final validation and hashes](2026-10-31/dynamic/validation-final/validation.json) |
| Saved capability | [artifact](2026-10-31/challenging/compilation-1/artifact.json) | [artifact](2026-10-31/dynamic/compilation-1/artifact.json) |
| Fresh-session replay | [Iuvaret4: Phaedrum4](2026-10-31/challenging/replay-Iuvaret4/result.json), [Iuvaret7: Phaedrum7](2026-10-31/challenging/replay-Iuvaret7/result.json) | [Hello World!](2026-10-31/dynamic/replay/result.json) |

The same v2 Builder and executor handled both workflows without scenario-specific
action types. Each replay directory includes an action log with `llmCalls: 0`.

The final validation reports repeat the deterministic checks on the original
candidates with the finished validator; this step makes no model API calls.

## Independent compilation retry

[Compilation 2](2026-10-31/challenging/compilation-2/validation.json) uses the
same saved Challenging DOM discovery, with no new discovery run. The compilation
request deduplicates identical DOM states. Input tokens dropped from 211,842 in
the original call to 57,105 in the retry, as recorded in the API metadata. Both
candidates passed recorded-state validation; the two parameterized replay results
above are for the original compilation's artifact.

The full original discovery remains unchanged. Validation on recorded states is
separate from the fresh-session replay evidence. Synthetic unit tests are documented
in [the implementation guide](../../docs/capability-v2.md), not presented as LLM runs.
