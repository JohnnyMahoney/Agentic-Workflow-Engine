# Capability v2

The pipeline is:

`Claude Browser Use discovery -> saved evidence -> separate Claude compilation call -> candidate -> deterministic validation -> artifact -> Playwright replay`

## Run

Use Node.js 22.18+, `npm.cmd ci`, and `npx.cmd playwright install chromium`.
Set `ANTHROPIC_API_KEY` in the ignored root `.env`. Optionally set `CLAUDE_MODEL`;
the tested default is `claude-sonnet-5-5`. Discovery and compilation need network
and model API access. Replay only needs access to the target website.

```powershell
$run = Join-Path 'evidence/capability-v2' (Get-Date -Format 'yyyy-MM-ddTHH-mm-ss')
npm.cmd run capability:discover -- --request examples/challenging.json --out "$run/challenging/discovery"
npm.cmd run capability:compile -- --evidence "$run/challenging/discovery/discovery-v2.json" --out "$run/challenging/compilation-1"
npm.cmd run capability:replay -- --artifact "$run/challenging/compilation-1/artifact.json" --input rowKey=Iuvaret4 --out "$run/challenging/replay-Iuvaret4"
npm.cmd run capability:replay -- --artifact "$run/challenging/compilation-1/artifact.json" --input rowKey=Iuvaret7 --out "$run/challenging/replay-Iuvaret7"

npm.cmd run capability:discover -- --request examples/dynamic.json --out "$run/dynamic/discovery"
npm.cmd run capability:compile -- --evidence "$run/dynamic/discovery/discovery-v2.json" --out "$run/dynamic/compilation-1"
npm.cmd run capability:replay -- --artifact "$run/dynamic/compilation-1/artifact.json" --out "$run/dynamic/replay"
```

Each output directory must be empty. For a compilation retry, reuse `--evidence`
and choose a new directory, such as `compilation-2`. No discovery is repeated.
Compilation also accepts `--feedback PATH` with JSON from an earlier replay.
The feedback is sent to the separate Claude call as diagnostic data; the Builder
still validates every proposed target and condition against recorded discovery.
If a goal is narrowed, preserve the original evidence, save a new request and a
derived evidence file containing only the relevant recorded action prefix, and
record the original evidence hash. See
[Awkward UI test 2](../evidence/awkward-ui-testing/test-2/README.md).
All commands also accept `--policy PATH` for a trusted JSON file with `origins`
(exact HTTP(S) origins) and `actions` (supported action names). Pass the same policy
to discovery, compilation/validation, and replay; it is copied into each run folder.
Local synthetic fixtures use request `dataMode: "synthetic-test"`.
To rerun deterministic validation without an API call:

```powershell
npm.cmd run capability:validate -- --candidate "$run/challenging/compilation-1/candidate.json" --evidence "$run/challenging/discovery/discovery-v2.json" --out "$run/challenging/revalidation"
```

The example request files supply goals and input/output definitions, not action
sequences or locators. `bindings` contains the synthetic values used in discovery;
runtime inputs replace them during replay. `--input name=value` supplies strings;
the CLI also accepts an `--inputs` JSON object for primitive numeric/boolean values.

## Code boundaries

| File | Responsibility |
| --- | --- |
| `src/capability/contract.ts` | Zod schema and semantic validation; no Playwright types. |
| `src/capability/evidence.ts` | Versioned discovery records, recorded DOM and observed element facts. |
| `src/capability/compile.ts` | Separate model call; deduplicates repeated states in the request. |
| `src/capability/builder.ts` | Deterministically checks candidate against evidence, saves artifact and hashes. |
| `src/surfaces/adapter.ts` | Small execution interface. |
| `src/surfaces/playwright.ts` | Web targeting, unique resolution, browser execution, origin/action policy. |
| `src/replay/engine.ts` | Ordered execution, bounded condition waits, outputs and structured failures. |

Strategies specify a role/name or CSS selector, optional scope, and a frame path.
Native HTML selects use the `selectOption` step with a logical target, `by:
"label"` or `by: "value"`, and a literal or `{ "input": "name" }` value. The
Builder checks the actual selected option captured after Discovery. Replay uses
the same step through the Surface Adapter; older `fill` steps for text fields
remain valid. Policies must include `selectOption` to allow that action.
The scope can bind a descendant's exact text to an input. Resolver errors on
ambiguity or on strategies identifying different elements. The Builder requires
every strategy to identify the cited node in recorded evidence. It verifies the
actual clicked node and observed extraction text, not just locator syntax.

`wait` polls a condition with a bounded timeout; `assert` checks immediately.
Checkpoints use bounded waits, and final outputs are collected afterward.
No target-specific branches exist in the v2 Builder or executor. Policy is supplied
by trusted execution configuration, not by the candidate artifact.

## Evidence and limits

Discovery v2 adds DOM states before/after actions, frame ownership, node identities,
observed text/visibility, explicit request definitions, and recorded fill bindings.
The compilation candidate cites these states by action index and phase. Internal
node IDs are prohibited as replay locators. The old PoC logs remain unchanged.

The saved `artifact.json` contains only the reusable workflow. `candidate.json`
contains the proposed workflow plus evidence references. `validation.json` records
source/candidate SHA-256 hashes and completed checks. `compilation-call.json`
records the separate API call. A compilation failure writes `compilation-error.json`
and does not save an artifact. Replay records structured steps/results and a
screenshot on failure when a page is available.

This slice uses public demo data and synthetic fixtures. Input values are scrubbed
from captured form fields, and replay events omit supplied input values. DOM text,
model replies, screenshots, and declared outputs may still contain page data;
real banking PII/credentials are outside the supported capture mode. Evidence
validation does not prove business intent, arbitrary-site compatibility, or future
stability. The tested table locator still depends on its sixth column position.

Runtime outcomes and bounded recovery are implemented; see [runtime contract](runtime-3-3.md).
Real same-session human handoff remains future work.
CSS and frame strategies do not automatically work on a desktop adapter.

## Tests

`npm.cmd test` runs offline unit/integration tests with synthetic local pages,
including frame targeting, parameterized fill/extraction, ambiguity, contradictory
evidence, malformed artifacts, policy denial, timeout, and failure screenshots.
`npm.cmd run typecheck` checks types. These synthetic tests are distinct from the
[real Claude runs](../evidence/capability-v2/README.md).

The original v1 commands remain available: `spike:browser-use`, `slice:discover`,
and `slice:replay`. Their artifacts use the separate v1 executor and are not
silently migrated to v2.
