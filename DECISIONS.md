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
Discovery -> Compilation -> Replay run was pending at this decision. Later E2E
evidence and subsequent gaps/fixes are indexed in [evidence/README.md](evidence/README.md).

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

## Visible browser runs

Discovery and Replay CLI commands now open a visible browser by default for local
observation. `--headless` opts out; adapter defaults and automated tests remain
headless. Runs still use isolated sessions and close on completion. This is a
viewing convenience, not same-session human handoff or permission to act concurrently.

## D11 - Deterministic Replay and human handoff

**Status:** Implemented for Replay. Automated tests cover recovery and input locking.
A live operator also demonstrated successful session-expiry recovery and rejection
of Resume without remediation. This does not establish Discovery handoff or safe
recovery for every artifact. See [handoff evidence](evidence/handoff/README.md).

**Decision:** Preserve the existing pipeline and artifact contract. Replay runs
ordered steps through the Surface Adapter with no LLM. Add opt-in CLI handoff
inside the step loop, keeping the same browser/context and in-memory execution
state. Use existing conditions to verify recovery; never invent a postcondition,
rewrite the artifact, trigger Discovery or restart the entire workflow.

**Why:** The previous outer catch/finally closed the browser immediately on failure.
Handling eligible failures within the step loop makes manual remediation possible
without losing completed steps or introducing an orchestrator. A local CLI provides
a small operator interface; a dashboard is unnecessary for this slice.

### Core Replay, step by step

1. Validate artifact schema/references, supplied inputs and trusted origin/action
   policy. Open one browser/context and create the execution journal.
2. Execute steps in order. Resolve logical targets uniquely through the adapter;
   check configured UI outcome detectors before actions and during bounded waits.
3. Keep extracted values in memory. For v2.1 declared outputs, wait for the value
   to satisfy its readiness condition and save that exact sample. Existing v2.0
   artifacts remain compatible and may report legacy-unverified readiness.
4. Track potentially modifying dispatches in pending mutations. Semantic conditions
   with explicit confirms relationships establish confirmation. A known pre-dispatch
   target error can remove the current pending marker; arbitrary timeouts cannot.
5. On an eligible step failure with --handoff, pause at that step. Preserve completed
   step IDs, saved outputs and pending mutations; do not execute later steps.
   Without handoff, or for an ineligible error, return the structured failure.
6. After a successful step or verified recovery, continue with the next step.
   Previously completed steps are not replayed.
7. Verify final checkpoints and reject unresolved explicit state-changing operations.
   Return declared outputs only on SUCCESS. Otherwise report status, code, step,
   expected/observed state, retryability and evidence. Close the browser on final
   success, failure or abort, rather than closing it while intervention is pending.

### Control transfer and UI input

| Phase | Behavior |
| --- | --- |
| Running | Playwright executes the workflow. |
| Paused | Save intervention request and before screenshot; block page mouse/keyboard input. |
| take-control | Start manual-event recording, enable page input, acknowledge human ownership. Automation waits. |
| resume | Block page input again, stop manual-event recording, capture after evidence, verify current state. |
| Verified continuation | Enable input for subsequent Playwright operations and return ownership to automation. |
| abort / unresolved | Return a structured result and close the session. |

Resume before take-control is rejected. Waiting for the operator is bounded to
five minutes. EOF/Ctrl+C while awaiting input aborts; a closed browser stops recovery.
Chromium input blocking includes the page and same-page frames. It does not block
the browser toolbar, window closing or developer tools. Input must be enabled for
running automation because the Chromium switch also blocks Playwright clicks.
This is a paused/verifying input lock, not exclusive OS-level ownership throughout
execution; page scripts and timers continue running while input is blocked.

### Recovery decision after Resume

| Decision | Required evidence | Execution |
| --- | --- | --- |
| HUMAN_COMPLETED | Existing associated conditions all match; every pending mutation has a verified confirms relationship | Complete the failed step and continue in order |
| SAFE_RETRY | Observation-only step, or proven beforeDispatch failure; no pending mutations; policy, detectors and target revalidated | Execute the step once with bounded waits |
| HANDOFF_UNRESOLVED | Insufficient conditions, blocked UI, invalid origin, ambiguity, failed retry or operator timeout | Stop without skipping or repeating a modifying action |
| OUTCOME_UNKNOWN | Failure leaves a potentially modifying operation unconfirmed | Stop with reconciliationRequired; never automatically repeat the write |

A failed wait/assert uses its contiguous condition group. An explicit stateChanging
step requires following contiguous wait/assert checks with a confirms link to that
step. Identity/type checks in the group must all pass. Global final checkpoints
are not assumed to be postconditions for an arbitrary click. Generic actions without
sufficient associations stop unresolved. Click, fill, selectOption and navigate
may execute once after a proven beforeDispatch failure (D12 amendment); an unknown
or started dispatch cannot use that recovery path. One intervention and at
most one safe recovery attempt are allowed per failed step.

Eligible cases include missing/ambiguous targets, condition/output timeouts,
assertion failure, transient loading, session expiry and unexpected dialogs.
Policy denial, expected business refusal, invalid artifacts and unknown programming
errors follow normal failure handling. Final checkpoint failures outside the step
loop are not handoff entry points in this implementation.

### Evidence and limits

The request records capability description, session, step, reason, completed steps,
pending mutations and saved-output names. The journal records ownership changes,
manual action metadata, verification observations and HUMAN_COMPLETED / SAFE_RETRY /
HANDOFF_UNRESOLVED decisions. Before/after screenshots are captured when available.
Manual event records omit entered values and keystrokes; screenshots and output
logs still require synthetic/public fixtures because production PII redaction is
incomplete. New tabs, OS actions, crash-resume and Discovery handoff remain outside
this slice. Existing native-dialog dismissal behavior is retained.

The session-expiry example is a hand-authored runtime fixture, not a new Claude
Discovery result. Automated real-browser tests use simulated operators. The two
live operator runs separately demonstrated positive and negative recovery; they do
not prove full-pipeline discovery-to-handoff generalization or write recovery.

### Reproduce the handoff demo

From the repository root, start the sandbox in one PowerShell terminal if needed:

```powershell
npm.cmd run sandbox:serve
```

In a second interactive PowerShell terminal:

```powershell
$run = Join-Path 'evidence/handoff-demo' (Get-Date -Format 'yyyy-MM-ddTHH-mm-ss')
npm.cmd run capability:replay -- --artifact examples/handoff/artifact.json --input memberId=M-1001 --input accountType=Savings --policy examples/handoff/policy.json --out "$run" --handoff
```

After Replay paused, confirm that page clicks are blocked. Type take-control in
the terminal. In the browser click Log in again, change TEST PANEL to NONE without
Reset, click Search and wait for M-1001. Then type resume. Expected: HUMAN_COMPLETED
followed by SUCCESS. The test mode repeatedly injects expiry until it is disabled;
removing that injected fault through the UI is part of this sandbox demonstration.

For the negative test, use a fresh output directory, take-control, and resume
without fixing the UI. Expected: HARD_FAILURE / HANDOFF_UNRESOLVED. Use abort to
terminate explicitly. --handoff requires an interactive terminal and visible
browser; it cannot be combined with --headless.

```powershell
npm.cmd test
# Focused handoff regression suite:
npm.cmd run build
node --test dist/tests/handoff.test.js
```

See [operator details](docs/handoff.md) and [the stable example](examples/handoff/README.md).

## D12 - Discovery handoff and trusted blocker admission

**Admission correction:** The live negative run
`test3-discovery-20261109-191823` showed an honest model refusal after an unresolved
handoff, but the CLI announced recorded-for-compilation. Normal end_turn is not
goal success. Discovery CLI now runs the existing offline human-evidence checks
before announcing eligibility, writes a rejected admission result on failure,
and reports DISCOVERY_HANDOFF_UNRESOLVED when a configured blocker remains in
post-intervention evidence. Compilation/Builder retain their independent checks.
The original negative run is preserved; its saved evidence now rejects without
another API call, while the positive Test 2 evidence still admits.

**Replay recovery amendment (approved):** Track each attempt as beforeDispatch,
started, or completed. Only failures before the adapter operation begins provide
beforeDispatch proof; never infer it from the disappearance of a blocker or an
exception's message. After handoff, recheck current origin, action policy,
navigation destination where applicable, outcome detectors, and unique visible
target. With no pending mutations, allow one execution of the blocked step.
Enable browser input for this execution after verification; do not restart the
workflow or request a second intervention if it fails. Started modifying actions
still require existing confirmation, otherwise stop with OUTCOME_UNKNOWN.
The original Test 2 failure and artifact remain unchanged. Regression evidence:
[before-dispatch recovery](evidence/handoff-before-dispatch/README.md).

**Input-lock correction:** The operator reported that page clicks were possible
before take-control. The later live run `test2-fixed-20261109-185329` contains no
handoff request: the blocker disappeared during normal Discovery, before the
pause-only lock could activate. Declared human blockers now get an input guard
installed before application scripts, active while the configured blocker exists.
Only recorded human ownership enables interaction. Regression coverage attempts
dismissal and a business click before the first request_human. This closes the
pre-pause window for configured blockers, not arbitrary UI during automation.

The earlier report concerned clicks possible
without take-control. CDP-only input suppression was insufficient evidence of
desktop input isolation. The shared adapter now also captures and cancels page
input events while paused/verifying, including frames, and releases that guard
on take-control. It adds no DOM elements or attributes, preserving admission
snapshots. Regression coverage dispatches DOM clicks independently of CDP and
checks locked/unlocked behavior. All 42 tests passed after the correction;
the subsequent live handoff suite is documented in the acceptance record. This protects
page interaction during handoff, not browser chrome, devtools or arbitrary scripts.

**Status:** Accepted and live-validated for Section 3.6 in the current web MVP.
See [live acceptance and limitations](evidence/discovery-handoff/manual/README.md).
The earlier deferral was superseded by the five manual test scenarios.

**Decision:** Reuse the same-session CLI controller from D11 in Discovery. Register
the typed request_human tool through the official SDK helper alongside Browser Use.
Keep the existing conversation and browser/context/page alive. Serialize both tool
paths, pause the active Discovery budget during bounded operator waits, invalidate
refs and require fresh observation on return. Driver-detected repeated failures or
unchanged observations can also request intervention; API outages remain failures.
Preserve original action indices and record manual intervention separately.

**Why:** Discovery needs flexible reassessment after human assistance, whereas
Replay must verify deterministic artifact conditions. Sharing control transfer
without sharing these decision rules preserves that architectural boundary. No
dashboard, capability schema change, new framework or automatic rediscovery is needed.

**Approved admission rule:** A trusted policy may declare an exact URL, temporary
blocker container and human-only dismissal control. Before Compilation, verify the
manual action ledger against the audit and offline DOM: only clicks on the declared
control, blocker removed, remaining DOM/frames unchanged. Builder repeats this
validation. Reject unverified changes and essential human-only business actions;
never synthesize them into executable steps. Fresh Replay independently handles any
new blocker via its existing handoff. Approval never expands action/origin policy.

**Alternatives:** Trusting Claude's success claim or accepting arbitrary manual
changes would allow unrepeatable artifacts. Rejecting every intervention would
prevent even a proven temporary-blocker dismissal. The approved narrow policy
keeps a useful MVP path with explicit trust rather than inferring hidden effects.

**Trade-offs and limits:** DOM comparison cannot establish absence of server-side
effects; the policy author certifies the dismissal semantics. Main-document click
dismissals only are supported for changed-state admission. Credential entry,
human-only business work, iframe dismissals and unrelated asynchronous DOM changes
fail closed. The input lock applies while paused/verifying, not to the toolbar,
devtools or running scripts. Three interventions maximum, five minutes each;
180 seconds of active Discovery time. Unknown prior action effects remain subject
to conservative admission. Existing data-capture limitations still apply.

**Closure validation:** All five live scenarios were reviewed: no-intervention
lookup, successful Discovery/Compilation/fresh Replay handoff, unresolved Resume,
Abort in both stages, and rejected manual business actions. Test 2 returned
M-1001 / Checking / $2,450.75 after a single proven beforeDispatch retry. Test 3's
admission fix was revalidated offline against preserved evidence, not rerun live.
Discovery Abort's generic CLI code remains a reporting limitation; its audit records
HANDOFF_ABORTED. Current regression: **44/44 passed**, run sequentially because
parallel runs previously exposed pattern-evaluation timeouts. No timeout threshold
was loosened. See [closure test log](evidence/discovery-handoff/closure/tests.log).

**Automated coverage:** Tests use real Chromium and the installed SDK runner with scripted
API responses and simulated operators. The successful test validates a hand-authored
candidate and performs a fresh Replay with a second intervention; it is not proof
of genuine LLM compilation. Abort, unresolved blocker, policy guard, stale refs,
driver fallback, human business-action rejection and API outage are covered.
See [verification evidence](evidence/discovery-handoff/README.md),
[control flow and limits](docs/discovery-handoff.md), and
[exact live acceptance commands](examples/discovery-handoff/README.md).

**Next slice:** Section 3.4 remains open. Review existing origin/action enforcement
and gaps for routes, define conservative trusted handling of risky actions, and
prevent secrets/raw sensitive data from entering every persisted evidence channel.
Validate policy denial before dispatch and redaction with synthetic sensitive-data
fixtures. Human approval must not bypass these controls. Concrete behavior choices
will be proposed before implementing that safety slice.

## D13 - Minimal safety policy and sanitized persistence

**Status:** Implemented, regression-tested and live-validated for the synthetic/public
web MVP, following the approved Section 3.4 implementation prompt. The final genuine
Claude Discovery -> separate Compilation -> validated artifact -> fresh Replay
passed with the unchanged policy: M-1005 / Term Deposit / $50,000.00, validated
outputs and zero Replay LLM calls. See [live evidence](evidence/safety-3-4/final-live-e2e/README.md).

**Decision:** Extend trusted policy with explicit routes, actual-target operation
rules and data classification. Unknown mutations and blocked operations deny by
default; risky operations require a narrow explicit permission. Enforce in both
Discovery and Replay, including navigation/redirect boundaries. Distinguish page
navigation routes from allowed-origin JS/CSS resource loading. No approval workflow
or new policy framework is introduced. Artifact/LLM risk labels grant no authority.

**Persistence:** Use one text/JSON sanitization boundary for production writers.
Learn classified DOM/input secret values, redact sensitive fields and their echoes,
known environment secrets, URL query values and common sensitive patterns. Refuse
raw image persistence; save sanitized DOM diagnostics instead. Refuse compilation
when redaction removes necessary evidence. Require trusted synthetic/public data
classification and refuse sensitive applications in this MVP.

**Why and trade-offs:** Blocking risky operations unless explicitly permitted is
smaller and easier to test than another approval system. Omitting screenshots is
more conservative than claiming reliable pixel redaction. It sacrifices persisted
visual diagnostics; structured DOM evidence remains. Route/operation/selector rules
require review when a UI changes; existing artifacts remain readable, but legacy
policy copies need explicit migration. No broad click permission is inferred.

**Limits:** Arbitrary PII still requires trusted classification; patterns are not
universal detection. A falsely classified sensitive application is outside the
supported boundary. Browser chrome, manual operator actions, arbitrary application
scripts and unrelated caller filesystem writes are not adversarially isolated.
Historical evidence uses synthetic fixtures and is not retroactively rewritten.
This is an automation safety boundary, not production DLP or a secrets vault.

**Verification:** Negative real-browser tests prove denied requests/mutations have
no side effects, including redirects, unknown risk, blocked risk and action denial.
Narrow risky permission still executes. Secret echoes, DOM, URL and tool-response
capture are checked for raw values; screenshots are refused. Discovery and Replay
deny independently. Regression covers handoff and the existing Banking Sandbox.
See [test evidence](evidence/safety-3-4/README.md) and [exact guarantees](docs/safety.md).
