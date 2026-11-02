# E2E round 2 - Test 2: Legacy UI, M-1006

SUCCESS: member M-1006, Savings, $7,640.20. All replay outputs match the actual
recorded extraction nodes in the new discovery evidence. Replay made zero LLM calls.

The entry point was /legacy/index.html. Claude independently chose to navigate
to /legacy/content.html after interacting with the frame. Both navigations and
all UI interactions are preserved in the compiled artifact. This is a successful
business lookup, not proof that the complete workflow remained inside an iframe.

No code/contract changes, Reset, manual candidate edits or supplied selectors.
The standard CLI generic instructions and explicit member input were used.
Administrator acceptance of this test is pending.

- [Request](request.json), [policy](policy.json)
- [Discovery](discovery/discovery-v2.json), [model/tool events](discovery/events.jsonl)
- [Compilation prompt](compilation/compilation-request.json), [candidate](compilation/candidate.json)
- [Validation](compilation/validation.json), [artifact](compilation/artifact.json)
- [Replay result](replay/result.json), [steps](replay/events.jsonl)
- [Independent output/evidence verification](verification.json)
