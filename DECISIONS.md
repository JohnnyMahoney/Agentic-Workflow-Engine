# Engineering Decisions

This records the engineering choices behind the current web slice. The
interface.ai assignment defines the requirements.

| Area | Current choice | Reason and limit |
| --- | --- | --- |
| Architecture | **Chosen:** TypeScript and Node.js in one modular application. | Simple to run and review. Distributed execution and scaling infrastructure are outside the MVP. |
| Artifact validation | **Chosen:** Zod and semantic/evidence validation for Capability v2. | A separate Claude compilation call proposes JSON; deterministic checks gate saving it. See D4. |
| Browser execution | **Chosen for the web slice:** Playwright. | It provides browser actions, inspection, and assertions. Native desktop control is outside this implementation. |
| LLM discovery | **Accepted for web discovery:** Claude Browser Use with a local Playwright driver. | See [D3](#d3--browser-use-for-discovery) for evidence and limits. |

## D3 — Browser Use for Discovery

**Status:** Accepted for web discovery.

**Decision:** Use Claude Browser Use for the LLM-driven discovery loop, backed by
our local Playwright browser driver. Record each observation and proposed action
before execution. Compile a versioned capability artifact from a successful run;
execute that artifact with Playwright without an LLM in the replay loop.

**Why:** Claude completed live UI tasks across frames, repeated table links, and
asynchronous loading. The toolset lets us intercept actions, inspect their DOM
targets, and retain control of the browser session. One real Challenging DOM run
produced an artifact that replayed successfully with two different row inputs.
This meets the agreed GO criterion for the web discovery layer.

**Evidence:** The [initial browser-use runs](evidence/browser-use-spike/) cover
Nested Frames, Challenging DOM, and Dynamic Loading. The
[vertical-slice evidence index](evidence/vertical-slice/README.md) links the
genuine discovery logs, source hashes, versioned artifacts, and two successful
fresh-session replays with distinct row inputs. It also records a structured
not-found outcome and the URL timing issue found during the recorder refactor.

**Trade-offs and limits:** We maintain a small Playwright driver because the
Stagehand local CDP connection failed on this Windows machine. Browserbase was
not evaluated. Session-scoped refs and screen coordinates are unsuitable as
replay targets on their own; the artifact uses a unique row key, column header,
and link name. Hash links need an explicit URL wait before recording a
post-action checkpoint. The original replay proved table operations; D4 extends
the contract to general web actions. D5 also demonstrates non-semantic controls
inside a legacy iframe. Native desktop surfaces and same-session pause, human
takeover, and resume are still untested.

**Alternatives considered:** Custom Claude tool definitions with Playwright
would give us control but require maintaining our own tool protocol. Stagehand
local was attempted and failed during browser startup. The current driver is
the smallest tested integration for this web slice.

## D4 — Capability contract and separate LLM compilation

**Status:** Accepted for MVP design; tested on two public web workflows.
Cross-platform portability remains unverified.

**Decision:** Use a versioned declarative Capability v2 with logical target names,
typed inputs/outputs, ordered actions, and checkpoints. Keep target resolution in
the Playwright implementation behind a small `SurfaceAdapter` interface. Support
`navigate`, `click`, `fill`, `extract`, `wait`, and `assert`; support role and CSS
strategies with frame paths and parameterized scopes. Retain the v1 PoC and evidence.

After discovery, make a **separate Claude compilation API call** with the goal,
explicit input/output definitions, schema, and recorded evidence. Treat its
candidate JSON as untrusted. A deterministic Builder validates schema, references,
parameter bindings, action identity/order, locators against recorded DOM states,
observed extractions, checkpoints, and policy before saving an artifact. Replay
uses no model. Compilation can be retried from saved evidence without discovery.

**Why:** Separate compilation lets discovery focus on the live UI, preserves its
evidence independently, and allows contract/prompt revisions without repeating UI
actions. It supports reuse and explicit extension points while keeping replay
deterministic. A single adapter interface and plain modules keep the MVP small.

**Evidence:** The [v2 evidence index](evidence/capability-v2/README.md) records two
real discoveries, separate compilation calls, validation reports, and successful
Challenging DOM and Dynamic Loading replays through the same Builder and executor.
The table artifact runs with two row inputs. A second compilation of its unchanged
discovery evidence demonstrates independent compilation retry.

**Trade-offs and limits:** Compilation adds a model call and may fail validation.
DOM capture increases evidence size; compilation deduplicates identical states.
Evidence validation proves agreement with recorded states and action identities;
it does not establish complete business-goal correctness or future locator stability.
Fresh-session replay provides a separate check. An inferred positional selector
can still depend on column order. Unsupported or insufficient evidence is rejected;
old v1 logs are not silently upgraded.

The workflow contains no Playwright API calls, but CSS, roles, and frame paths
remain web strategies. Another surface needs its own supported strategies and
adapter; cross-platform reuse is not automatic. Inputs support primitive types;
extracted outputs are strings in this slice. Recovery, business outcome taxonomy,
and live human handoff require later slices. DOM/screenshot evidence is currently
restricted operationally to public test pages and synthetic fixtures; input-field
scrubbing is not a complete PII sanitizer for real banking pages.

**Extension points:** Add an action in the schema, engine, adapter, and evidence
validator together, with tests. Add a locator strategy in the schema, resolver,
and recorded-state verification. Add a surface by implementing the adapter with
an explicit supported-strategy set. No plugin framework or distributed services.

**Alternatives considered:** Asking Claude for final JSON during discovery couples
UI completion to serialization and makes compilation retries repeat discovery.
A deterministic compiler using scenario-specific text patterns does not generalize
to the second workflow. Direct Playwright scripts bind the workflow to one engine.
A universal computer-use language would exceed the needs of this MVP.

## D5 — Business scenario validation on the local banking sandbox

**Status:** Accepted; modern and legacy UI test 1 validated.

**Decision:** Validate the discovery → separate compilation → deterministic replay
pipeline on business tasks in the user's local banking sandbox, starting with
`http://localhost:8080/modern.html`. Test 1 searches for member `M-1001`, confirms
their identity and account type, and returns balance, account type, and member ID.
Keep each test's request, policy, model evidence, artifact, and replay results in
its own directory under `evidence/modern-ui-testing/` or `evidence/legacy-ui-testing/`.
The legacy test uses `http://localhost:8080/legacy/index.html` and member `M-1002`
with the same contract, Builder, and replay executor.

**Why:** A member lookup exercises search, input binding, asynchronous results,
navigation to details, and extraction of multiple business outputs. This checks
whether the same contract and executor extend beyond the initial isolated web demos.

**Trade-offs and limits:** These are real interactions with synthetic sandbox data;
they do not demonstrate production banking or PII readiness. The sandbox is run
outside this repository and must remain available. An explicit CLI `--policy`
supplies the exact allowed origin for discovery, validation, and replay; the LLM
artifact cannot expand that allowlist. A model ending its turn is not proof that
the goal succeeded; failed or missing actions block compilation. Test 1 covers
one member per UI and the successful lookup path. Selectors depend on the current
field order or table/presentation markup; broader parameter coverage, error paths,
and human handoff remain untested. Coordinate recording must descend into iframes
to identify the actual clicked element. Detected transformed frame geometry is
rejected; arbitrary transformed layouts remain unverified.

**Evidence:** [Modern UI test 1](evidence/modern-ui-testing/test-1/README.md).
Real discovery, a separate compilation call, and a fresh-session replay returned
`M-1001`, `Checking`, and `$2,450.75`. Replay made no LLM calls. The
[verification report](evidence/modern-ui-testing/test-1/test-verification.json)
compares replay outputs with recorded discovery values and checks the member input
and evidence hash. Earlier failed-run logs are retained, with the misleading
legacy success flag explained in the test index.

[Legacy UI test 1](evidence/legacy-ui-testing/test-1/README.md) returned `M-1002`,
`Savings`, and `$18,200.00` through genuine discovery, separate compilation, and
fresh replay without LLM calls. It exercised non-semantic controls inside an iframe.
The first compilation was correctly rejected because coordinate targets were
recorded as the iframe itself. After fixing frame hit testing and passing all five
regression tests, new discovery evidence validated and replayed successfully.
Both attempts are retained; the test index links their logs and verification.

[Legacy UI test 2](evidence/legacy-ui-testing/test-2/README.md) repeated the full
pipeline from a fresh request for `M-1003`, without reusing the `M-1002` artifact
or supplying selectors. Discovery, separate compilation, validation, and fresh
replay returned `M-1003`, `Checking`, and `$310.40`; replay made no LLM calls.

[Awkward UI test 1](evidence/awkward-ui-testing/test-1/README.md) found `M-1004`
and `$92,500.10`, but the recorded member details did not show an account type.
The account-type choices on a New sub-account form do not establish the member's
current type. Separate compilation therefore returned
`COMPILATION_EVIDENCE_INSUFFICIENT`; no artifact or replay was produced. This
preserves a clear partial outcome and avoids inventing a required business value.

**Narrowed-goal follow-up:** After the administrator confirmed the UI has no
account type, [Awkward UI test 2](evidence/awkward-ui-testing/test-2/README.md)
reused the original discovery evidence to compile a two-output capability for
`M-1004`. A derived evidence file retains the relevant action prefix, with the
source hash and changed request recorded separately. No new discovery occurred.
Two replay attempts exposed asynchronous search results and a visible balance
placeholder. Compilation was retried with their recorded feedback. The final
artifact replayed in a fresh session without LLM calls and returned `M-1004`
and `$92,500.10`. This demonstrates compilation retry and the need to wait for
completed values, while leaving the original three-output request unresolved.

## D6 — Native select and conditional sub-account workflows

**Status:** `selectOption` accepted and tested in Discovery, Capability v2,
Builder, and Playwright Replay. Case 2 remains incomplete because its conditional
business rule is not represented.

**Decision:** Keep the existing Capability → Steps → Target Registry → Surface
Adapter structure. Add one `selectOption` action with a target, `by: label|value`,
and an input or literal value. Discovery uses Playwright `selectOption()` for a
native `<select>` and keeps `fill()` for text controls. Builder requires a
recorded select action and checks the chosen option's actual label or value in
the after-state. Replay calls `selectOption()` through the Surface Adapter.

**Why:** This is controlled extensibility: a supported UI operation is added at
the existing extension points, with no site-specific rule or new architecture.
Old actions and artifacts remain valid. Eight tests pass, including parameterized
selection by label and value, evidence rejection for a forged selected option,
and regression coverage for the earlier actions.

**Evidence:** [Modern UI Case 2](evidence/modern-ui-testing/test-2-current-state/README.md)
records the earlier driver failure and a new Discovery with `selectOption` state
captured. A compilation retry produced a validated artifact using the new action.
Replay of that artifact was withheld because it unconditionally opens a new
sub-account, contrary to the goal's existing-account branch.

**Trade-offs and limits:** The new action covers a single native select choice;
other custom widgets are separate work. Evidence for older runs lacks the
selected-option property and cannot be upgraded into proof of this new action.
Case 2 still needs an explicit existing-Savings branch or a safe precondition
before creation, since a linear artifact could create a duplicate. Fresh browser
contexts also do not share the user's `localStorage`. Those business and session
extensions are not part of this select slice.
