# Agentic Workflow Engine

This repository implements a web discovery and deterministic replay slice for the
interface.ai assignment. Claude Browser Use
explores a live page; the recorded run produces a versioned JSON artifact that
Playwright replays in a fresh browser session without Claude. Capability v2 adds a
separate Claude compilation call and deterministic validation against recorded evidence.

## Run Capability v2

Use Node.js 22.18+ and put `ANTHROPIC_API_KEY=...` in a root `.env` file. The file
is ignored by Git.

```powershell
npm.cmd ci
npx.cmd playwright install chromium
$run = Join-Path 'evidence/capability-v2' (Get-Date -Format 'yyyy-MM-ddTHH-mm-ss')
npm.cmd run capability:discover -- --request examples/challenging.json --out "$run/discovery"
npm.cmd run capability:compile -- --evidence "$run/discovery/discovery-v2.json" --out "$run/compilation"
npm.cmd run capability:replay -- --artifact "$run/compilation/artifact.json" --input rowKey=Iuvaret7 --out "$run/replay"
```

Each output directory must be empty. Discovery and compilation load `.env`;
validation and replay do not call Claude. The [implementation guide](docs/capability-v2.md)
includes both workflows, compilation retry, offline validation, and limitations.

```powershell
npm.cmd test
npm.cmd run typecheck
```

See [engineering decisions](DECISIONS.md) and [v2 evidence](evidence/capability-v2/README.md)
for the results. The original `slice:discover` and `slice:replay` commands and
[v1 evidence](evidence/vertical-slice/README.md) remain available. The earlier
[browser-use spike evidence](evidence/browser-use-spike/) covers three discovery cases.

## Run the bundled Banking Sandbox

The original Modern, Legacy and Awkward test UIs are included in
[banking-sandbox/](banking-sandbox/INTEGRATION.md), including the Legacy iframe.
Start the fixture from the repository root:

```powershell
npm.cmd run sandbox:serve
```

Open http://localhost:8080/ (`modern.html`, `legacy/index.html`, `awkward.html`).
The server uses Node.js with no additional dependencies. If port 8080 is already
occupied by the Desktop copy, stop that server before starting this one. Serving
does not reset saved browser state. The known Legacy selection defect is preserved.

In another terminal, run a complete member-balance demo after the setup above:

```powershell
$run = Join-Path 'evidence/banking-demo' (Get-Date -Format 'yyyy-MM-ddTHH-mm-ss')
npm.cmd run capability:discover -- --request examples/banking/member-balance.json --policy examples/banking/policy.json --out "$run/discovery"
npm.cmd run capability:compile -- --evidence "$run/discovery/discovery-v2.json" --policy examples/banking/policy.json --out "$run/compilation"
npm.cmd run capability:replay -- --artifact "$run/compilation/artifact.json" --input memberId=M-1005 --policy examples/banking/policy.json --out "$run/replay"
```

This demo requests member ID, account type and balance. Discovery and Compilation
use the API key in `.env`; Replay uses the saved artifact without an LLM. See the
[integration guide](banking-sandbox/INTEGRATION.md) for alternate ports, storage
behavior and the fixture's limitations.

## Runtime verification (§3.3)

```powershell
npm.cmd test
# In another terminal: npm.cmd run sandbox:serve
npm.cmd run test:banking
```

Banking tests use fresh browser contexts and hand-authored runtime fixtures.
They do not reset your browser state or call Claude. Override the application
URL with `BANKING_SANDBOX_URL`; evidence defaults to `evidence/runtime-3-3/<timestamp>/`.
See [saved results](evidence/runtime-3-3/README.md) and [runtime contract](docs/runtime-3-3.md).

Replay writes `result.json`, `events.jsonl`, and a failure screenshot when available.
For example, an unconfirmed write returns:

```json
{
  "status": "OUTCOME_UNKNOWN",
  "code": "WAIT_TIMEOUT",
  "stepId": "waitConfirmation",
  "retryable": false,
  "reconciliationRequired": true,
  "evidenceRef": "<run>/events.jsonl"
}
```

Do not rerun creation after this result: verify the actual state first. The CLI
returns a nonzero exit code for every non-`SUCCESS` result, including a detected
business outcome; callers should inspect `status` and `code`.
New Claude Discovery/Compilation/Replay acceptance remains a separate test.

New compilations emit Capability v2.1 with a readiness condition and timeout for
every extracted output. Replay waits for a valid value and saves that exact sample;
permanent invalid values return `OUTPUT_VALIDATION_TIMEOUT`. Existing v2.0 artifacts
remain readable but report `outputReadiness: legacy-unverified` when checks are absent.
See [output readiness evidence](evidence/output-readiness/README.md) and the
[contract details](docs/output-readiness.md). Run the regression tests with `npm.cmd test`.

`extract` also supports `property: selectedOptionLabel` on a native single select;
the omitted property retains text extraction. This reads the UI selection, while
post-action checkpoints still establish whether creation succeeded.

Discovery with a proven recovered pre-dispatch failure may now be recorded for
Compilation. Failed actions remain in the audit, while Builder accepts only
successful executable steps and observed goal checkpoints. Potentially modifying
failures remain blocked. See [acceptance rules](docs/discovery-acceptance.md) and
[recovery evidence](evidence/discovery-recovery/README.md).
