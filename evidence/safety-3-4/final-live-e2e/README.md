# Final genuine Claude E2E with current safety policy

**Result: SUCCESS.** The developer explicitly authorized genuine API calls for
this final run. The target was the bundled synthetic Modern Banking Sandbox at
http://localhost:8080/modern.html, requesting member M-1005.

| Stage | Result | Evidence |
| --- | --- | --- |
| Genuine Claude Discovery | Completed, 15 recorded actions, zero tool failures | [Summary](discovery/summary.json), [events](discovery/events.jsonl), [recorded evidence](discovery/discovery-v2.json) |
| Separate Claude Compilation | Candidate compiled from saved Discovery evidence | [Request](compilation/compilation-request.json), [call metadata](compilation/compilation-call.json), [candidate](compilation/candidate.json) |
| Deterministic Builder | Validated | [Validation](compilation/validation.json), [artifact](compilation/artifact.json) |
| Fresh deterministic Replay | SUCCESS, validated outputs, zero LLM calls | [Result](replay/result.json), [events](replay/events.jsonl) |

Returned outputs: **M-1005 / Term Deposit / $50,000.00**.

The current `examples/banking/policy.json` was unchanged across all stages. No
artifact was manually patched and no stage was retried. Discovery and Replay used
separate browser contexts, launched independently by their CLI processes. No
human intervention was required. [Verification assertions](verification.json).

Commands run after building, with the bundled server running on port 8080:

```powershell
node --env-file=.env dist/capability/cli.js discover --request examples/banking/member-balance.json --policy examples/banking/policy.json --out evidence/safety-3-4/final-live-e2e/discovery --headless
node --env-file=.env dist/capability/cli.js compile --evidence evidence/safety-3-4/final-live-e2e/discovery/discovery-v2.json --policy examples/banking/policy.json --out evidence/safety-3-4/final-live-e2e/compilation
node dist/capability/cli.js replay --artifact evidence/safety-3-4/final-live-e2e/compilation/artifact.json --input memberId=M-1005 --policy examples/banking/policy.json --out evidence/safety-3-4/final-live-e2e/replay --headless
```

Output directories are preserved; reproduction requires fresh output paths.
Screenshots are not persisted under the safety boundary. The fixture contains
synthetic data. This positive E2E complements the negative automated tests; it
does not establish universal PII detection or arbitrary production safety.
