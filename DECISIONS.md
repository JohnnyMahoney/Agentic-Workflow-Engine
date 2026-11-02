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
they do not demonstrate production banking or PII readiness. The original runs used
the Desktop sandbox; its unchanged static files are now included in `banking-sandbox/`
with `npm run sandbox:serve` for repeatable setup. The known Legacy selection defect
is preserved. The local server must remain available during a run. An explicit CLI `--policy`
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
At the user's later request, a replay was run in a fresh isolated context. It
selected Savings and clicked Continue, but its confirmation wait matched the
transient `Loading...` status. The run failed at the next `clickBack` step while
the page was still loading. No replay creation or success was verified; the
failure screenshot and events are linked from the Case 2 evidence index.

**Trade-offs and limits:** The new action covers a single native select choice;
other custom widgets are separate work. Evidence for older runs lacks the
selected-option property and cannot be upgraded into proof of this new action.
Case 2 still needs an explicit existing-Savings branch or a safe precondition
before creation, since a linear artifact could create a duplicate. Fresh browser
contexts also do not share the user's `localStorage`. Those business and session
extensions are not part of this select slice.

## D7 — Deterministic runtime outcomes and evidence-backed checkpoints

**Status:** Implemented and tested for §3.3; final acceptance with a new Claude
Discovery ? Compilation ? Replay run remains pending.

**Decision:** Keep the existing pipeline and adapter boundary. Add `textContains`
(literal/input) to wait/assert/checkpoints. Builder checks the cited success state
and distinct earlier states since the preceding UI action. Reject a condition
that already accepts a different intermediate value (`PREMATURE_CHECKPOINT`).
Recompile from saved evidence; do not repeat Discovery merely to repair a candidate.

Replay returns `SUCCESS`, `BUSINESS_OUTCOME`, `RECOVERABLE_ERROR`, `HARD_FAILURE`,
or `OUTCOME_UNKNOWN`, with code, step, expected/observed state, retryability and
an evidence reference. Business/authentication/permission outcomes require
explicit policy detectors observing actual UI text. No banking strings or
selectors are embedded in the engine. Conflicting terminal detectors fail closed.

**Recovery rules:** Poll bounded waits; optionally retry only `extract` on a
missing target (at most three attempts). Never retry click/fill/select/navigation.
Mark persistent writes `effect: stateChanging`; a semantic wait/assert uses
`confirms: stepId` after all required identity/type checks. Unconfirmed writes
produce `OUTCOME_UNKNOWN` and require reconciliation, not replay restart.
A trusted rejection detector may resolve only explicitly listed mutation IDs.
Even after confirmation, a later timeout is not restartable if a write occurred.
Unannotated interactions are conservatively potentially modifying on failure.

**Why / alternative:** A fixed sleep or waiting for a visible status container
cannot distinguish loading from success. Semantic checkpoints plus deterministic
validation use the evidence already recorded. Automatic LLM recovery or blind
whole-workflow retries would weaken determinism and risk duplicate operations.

**Trade-offs:** Artifact v2 fields are additive; earlier artifacts still parse,
but old weak checkpoints should be revalidated/recompiled. Result consumers must
use the new uppercase statuses. Evidence checking finds known counterexamples;
it cannot prove every future state or that an LLM's `readOnly` annotation is true.
Action effects, confirmation semantics and conclusive rejection detectors need
review against the application. Runtime waits have bounded browser calls, not
hard real-time cancellation. Recovery does not resume a closed session, implement
handoff, or add an existing-account conditional branch. Tests use synthetic data;
production financial-data redaction remains separate work.

**Evidence:** [§3.3 runtime evidence](evidence/runtime-3-3/README.md): 14 unit/regression
checks and 12 isolated existing Banking Sandbox scenarios. The historical Case 2
candidate is rejected on recorded `Loading…`; a manually strengthened candidate
validates against the same evidence. That fixture is not a new Claude compilation.
No new LLM Discovery was run and §3.3 is not declared finally accepted.

## D8 — Output readiness belongs to the output contract

**Status:** Implemented; tested through saved-evidence recompilation and live
Awkward UI M-1007 replay. Section 3.3 acceptance remains broader than this fix.

**Decision:** Add Capability v2.1 while continuing to read v2.0. Every extracted
v2.1 output declares `validation.condition` and a bounded `timeoutMs`. Conditions
are input/literal `textEquals` or a full-string `textMatches` pattern. New Claude
compilations must emit v2.1. Validate the exact value during its extraction, save
that same sample, and stop on timeout rather than return an unchecked string.
No discovery changes, site-specific selectors or formats in the engine.

**Why:** Awkward Test 3 checked member identity but extracted an asynchronously
loading balance. A checkpoint on another element cannot establish output readiness.
Fixed sleeps, rejecting specific placeholder strings, and freezing the observed
zero would be brittle. A positive reusable output condition handles valid zero
and remains part of the reviewable artifact.

**Evidence validation:** Check the cited observed extraction against the condition
and reject conditions that also accept distinct recorded intermediate output
values after the preceding UI action. Save a separate readiness validation report.
Absence of intermediate samples is an explicit limitation, not fabricated proof.

**Trade-offs:** Require checks for all extracted v2.1 outputs because asynchronous
behavior cannot reliably be inferred from sparse snapshots. Old v2.0 artifacts
retain their behavior and explicitly report `legacy-unverified` output readiness;
recompilation is needed for the new guarantee. Patterns are artifact data, bounded
to 512 characters, 4096-character samples and 25 ms evaluation using Node's VM.
Timeout gives `OUTPUT_VALIDATION_TIMEOUT`; an outstanding write still takes
precedence as `OUTCOME_UNKNOWN`. No write is retried. Format validity does not
prove freshness, identity, or a complete business-format grammar. Preserve the
independent identity/checkpoint checks and review model-proposed patterns.

**Evidence:** [Output readiness regression and recompilation](evidence/output-readiness/README.md).
17 unit/regression tests and 12 existing sandbox tests passed. One compilation
candidate was rejected for changing an output description; the next validated.
Live replay rejected the placeholder before returning M-1007 and `$0.00`. The
original discovery, failed candidate/artifact and false-success replay remain intact.

## D9 — Selected option label extraction

**Status:** Implemented; regression-tested. Test 4 recompilation/replay evidence
is recorded in its [test index](evidence/e2e-round-2/test-4-modern-M1008-youth/README.md).

**Decision:** Extend `extract` with optional `property: text|selectedOptionLabel`.
Omitted property retains text extraction. For selectedOptionLabel the logical
target is the visible native single select. Playwright reads its selected label;
Builder checks its already recorded selectedOption metadata after the actual
form_input on that target or a recorded textual observation. Hidden option nodes
are not the target. Multiple selects, missing selection and unsupported controls
fail closed. Existing output-readiness checks apply to the extracted label.

**Why:** The recording already proves which native option was selected, but a
visible-text-only extract cannot return its label through a hidden option node.
Returning the entire confirmation changes the requested output meaning; copying
an input as an output would not read the actual UI selection.

**Trade-offs:** This adds one typed read property through the existing contract,
Builder and Surface Adapter extension points. Replay only forwards the property;
no new abstraction layer or site-specific logic. It is a concrete example of
controlled extensibility for assignment §3.7. Selection is not proof of creation:
post-action confirmation must separately verify success, member and account type.
Older recordings without selectedOption metadata cannot validate this read.
Multi-select and other control properties remain unsupported.

## D10 — Recovered Discovery failures and staged acceptance

**Status:** Implemented and regression-tested. Saved-evidence Test 6 compilation
and replay outcomes are recorded in its [test index](evidence/e2e-round-2/test-6-awkward-M1010-youth/README.md).

Test 6 replay succeeded with M-1010, Youth and reference M-1010-S1. Terminal
sandbox state verified exactly one matching sub-account. Failed action 7 remains
in the unchanged source audit and is absent from the artifact. All 24 tests pass.

**Decision:** Replace the zero-failure admission rule with two stages. Safe
recovery establishes eligibility for Compilation; deterministic Builder checks
then establish agreement with the explicit goal contract. Preserve failed actions,
original indices and audit files, but forbid failed actions as executable steps
or successful evidence references. Every successful interaction must still be
represented. Neither model completion nor later confirmation alone excuses a
potentially modifying failed action.

The initial allowlist covers only a form_input driver guard that runs before any
browser mutation. Require normal termination, unchanged snapshots, a successful
correction on the same recorded field before another interaction, an explicit
request binding, and subsequent textual observations. New records carry typed
failure phase/code and separate modelCompleted metadata. The observe/decide/act
loop, prompts, limits and UI behavior do not change.

**Legacy evidence:** Test 6 can use its companion structured audit to corroborate
the exact known pre-dispatch driver diagnostic. A narrowly scoped diagnostic
mapping plus unchanged snapshots and recorded correction is sufficient here;
arbitrary error text or equal DOM alone is not. Save audit/source hashes and the
admission proof without rewriting the historical completed=false flag.

**Goal validation:** Recovered candidates require v2.1 output validation and
semantic final checkpoints verifying every supplied input through input references.
Builder checks them on successful observed states after the recorded interactions.
Admission remains pending until these checks pass. This verifies the explicit
request contract; it cannot prove unrestricted natural-language business intent.

**Trade-offs:** Conservative and deliberately narrow. Failed clicks, unknown
dispatch phases, changed states, missing audit or unproven corrections remain
blocked even if a later message claims success. No generic recovery framework,
automatic retry of writes, audit deletion, or replay-time model call is introduced.
Support for another safe failure class requires a separate explicit proof rule.

**Evidence:** [Recovery regression evidence](evidence/discovery-recovery/README.md)
covers typed pre-dispatch guards, legacy audit, uncertain-write rejection, failed
reference exclusion, required final goal evidence and the unchanged historical run.
