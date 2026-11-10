# Section 3.3 runtime evidence - historical index

**Historical record:** the linked `2026-11-02-final/` files are not present in the
current checkout. Their paths and reported outcomes are retained below as provenance,
not as accessible current evidence. No files were deleted by the final readiness pass.
For inspectable current results use [the safety Banking regression](../safety-3-4/banking/README.md)
and [final review verification](../final-review/README.md).

Implementation verification on the existing Banking Sandbox at http://localhost:8080/modern.html.
**These are hand-authored runtime fixtures, not new Claude Discovery/Compilation runs.**
All browser contexts were isolated. No Reset or banking UI source changes occurred.

- 14 unit/regression checks (`2026-11-02-final/unit-tests.log`, unavailable in this checkout)
- 12 Banking Sandbox checks (`2026-11-02-final/banking-tests.log`, unavailable in this checkout)
- Machine-readable summary (`2026-11-02-final/summary.json`, unavailable in this checkout)
- Historical Case 2 rejection (`2026-11-02-final/unit/historical-checkpoint/rejection.json`, unavailable in this checkout)
- Manually strengthened candidate (`2026-11-02-final/unit/historical-checkpoint/manually-strengthened-candidate.json`, unavailable in this checkout) and validation (`2026-11-02-final/unit/historical-checkpoint/validation.json`, unavailable in this checkout). Reuses original discovery-5; NOT a new Claude response and NOT replayed.

| Scenario | Status | Cause code | Step |
| --- | --- | --- | --- |
| AMBIGUOUS_TARGET (`2026-11-02-final/banking/AMBIGUOUS_TARGET/result.json`, unavailable in this checkout) | HARD_FAILURE | AMBIGUOUS_TARGET | search |
| committed-but-unverified (`2026-11-02-final/banking/committed-but-unverified/result.json`, unavailable in this checkout) | OUTCOME_UNKNOWN | WAIT_TIMEOUT | waitConfirmation |
| happy-M1001 (`2026-11-02-final/banking/happy-M1001/result.json`, unavailable in this checkout) | SUCCESS | SUCCESS | checkpoints |
| NOT_FOUND (`2026-11-02-final/banking/NOT_FOUND/result.json`, unavailable in this checkout) | BUSINESS_OUTCOME | NOT_FOUND | waitSearch |
| parameterized-M1002 (`2026-11-02-final/banking/parameterized-M1002/result.json`, unavailable in this checkout) | SUCCESS | SUCCESS | checkpoints |
| PERMISSION_DENIED (`2026-11-02-final/banking/PERMISSION_DENIED/result.json`, unavailable in this checkout) | HARD_FAILURE | PERMISSION_DENIED | waitConfirmation |
| SESSION_EXPIRED (`2026-11-02-final/banking/SESSION_EXPIRED/result.json`, unavailable in this checkout) | HARD_FAILURE | SESSION_EXPIRED | waitSearch |
| SLOW_LOADING (`2026-11-02-final/banking/SLOW_LOADING/result.json`, unavailable in this checkout) | SUCCESS | SUCCESS | checkpoints |
| TIMEOUT (`2026-11-02-final/banking/TIMEOUT/result.json`, unavailable in this checkout) | RECOVERABLE_ERROR | WAIT_TIMEOUT | waitSearch |
| unconfirmed-write (`2026-11-02-final/banking/unconfirmed-write/result.json`, unavailable in this checkout) | OUTCOME_UNKNOWN | WAIT_TIMEOUT | waitConfirmation |
| UNEXPECTED_DIALOG (`2026-11-02-final/banking/UNEXPECTED_DIALOG/result.json`, unavailable in this checkout) | HARD_FAILURE | UNEXPECTED_DIALOG | waitSearch |
| VALIDATION_ERROR (`2026-11-02-final/banking/VALIDATION_ERROR/result.json`, unavailable in this checkout) | BUSINESS_OUTCOME | VALIDATION_ERROR | waitConfirmation |

Each banking scenario directory contains artifact.json, policy.json, events.jsonl,
result.json, assertions.json (including actual isolated localStorage state), and
failure.png for non-success results. Unit mock adapters emit mock-diagnostic.json,
never browser screenshots. The native-dialog unit test uses a mock adapter signal;
the sandbox's unexpected-dialog case exercises its actual DOM overlay.

Both successful creation runs observed one Savings sub-account and verified member
and type before returning to details. In committed-but-unverified, localStorage
contained one account, yet the intentionally unsatisfied confirmation produced
OUTCOME_UNKNOWN. There was exactly one create dispatch, no retries and no declared
success. In unconfirmed-write the wait expired while the actual UI still said
Loading; it also stopped without a repeated write.

The historical weak visible confirmation is rejected on discovery action 24,
after-state Loading, rather than accepted solely from action 25's final text.
Original historical evidence was preserved unchanged.

Run: npm.cmd test; npm.cmd run test:banking (sandbox must be running).
Unit evidence normally goes to a temporary directory; set RUNTIME_UNIT_EVIDENCE_DIR
to retain it. Set RUNTIME_EVIDENCE_DIR to choose a fresh banking evidence directory.

Final section 3.3 acceptance remains pending a separate new genuine Claude
Discovery -> Compilation -> Validation -> Replay run. Conditional existing-account
handling, human takeover/resume and production redaction remain outside this slice.
