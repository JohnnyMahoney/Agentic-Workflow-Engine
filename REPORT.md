# Design report

## Architecture

A modular TypeScript/Node.js monolith implements Claude Discovery → Discovery
Acceptance → separate Claude Compilation → Evidence Validator → Capability Artifact
→ deterministic Playwright Replay. The MVP is completed and validated within its
documented synthetic/public web scope: Sections 3.1–3.6 have implementation and
test evidence, and Section 3.7 is covered by the extension design below.
This does not imply production readiness or implemented desktop/multi-tenant
support. The [final review](docs/reviewer-readiness.md) records remaining
pre-submission concerns separately.

Claude Browser Use operates through a small local Playwright driver. Separate
compilation receives the goal, explicit parameter/output definitions, recorded
observations and schema. This costs another model call but lets us recompile
without repeating UI mutations. Deterministic Builder checks gate artifact saving.
Discovery admission is eligibility, not proof of goal completion. A narrowly
proven pre-dispatch input failure may be recovered; unknown failed writes are rejected.

[DECISIONS.md](DECISIONS.md) is the primary decision record. The
[evidence index](evidence/README.md) separates genuine model runs from test fixtures.

## Artifact schema

Capability v2.1 describes ordered steps, logical targets, primitive typed inputs,
string outputs and semantic checkpoints. Seven operations are supported: navigate,
click, fill, selectOption, extract, wait and assert. Values can bind explicit inputs.
Targets contain role/CSS strategies, frame paths and optional parameterized scopes;
session references and screen coordinates are not reusable replay locators.

The artifact is independent of the transcript. Candidate evidence references are
validated against captured DOM and successful action order before the workflow is
saved. Every locator strategy must uniquely identify the cited node. This checks
recorded consistency, not future stability or unrestricted natural-language intent.

Output readiness uses bounded exact-value or full-string pattern checks. Native
select extraction can read selectedOptionLabel. v2.0 remains readable but does not
receive new guarantees automatically. Testing exposed weak checkpoints, delayed
outputs, selected-option extraction and recovered tool failures; each led to generic
contract/validation extensions rather than banking-specific engine patches.

## Determinism & error handling

Replay resolves logical targets through the SurfaceAdapter and uses no LLM.
Bounded waits check actual state; ambiguity fails closed. Structured results contain
status, code, step, retryability and evidence, with expected/observed values where
applicable. Outcomes are SUCCESS, BUSINESS_OUTCOME, RECOVERABLE_ERROR, HARD_FAILURE
and OUTCOME_UNKNOWN. Authentication/permission errors need explicit UI detectors;
a timeout alone does not imply either.

Safe reads may retry; after handoff, an action proven blocked before dispatch
may execute once after policy, detector and target checks, with no pending mutation.
Potentially dispatched writes are never automatically reissued. An unconfirmed potential mutation yields OUTCOME_UNKNOWN and requires
external reconciliation. Semantic checkpoints and output conditions reject known
premature states, but sparse observations cannot establish exhaustive correctness.
Effect annotations and conclusive rejection detectors still require trusted review.

Genuine E2E evidence includes parameterized table replays, member lookups and
independently verified Youth account creation. Separate real-browser runtime fixtures
cover business refusals, slowness, timeout, permission/session errors, unexpected
dialogs, ambiguous targets and committed-but-unverified writes. Fixtures are not
presented as Claude-generated capabilities. Original failures remain available.

## Heterogeneity & multi-tenant

This section addresses assignment §3.7, Design for Heterogeneity & Scale.

**Surface abstraction and extensibility.** Discovery, admission, separate Claude
Compilation, evidence validation and deterministic Replay have distinct roles.
`LocalPlaywrightBrowser` supplies Claude Browser Use with live observations/actions;
`replayCapability` executes the saved Capability v2.1 contract through
`SurfaceAdapter`, currently implemented by `PlaywrightAdapter`. Logical targets
live in the artifact's target registry; the resolver interprets their strategies.
Browser handles and session refs do not enter the reusable flow. Replacing a model
or driver still requires integration and evidence tests, but not a new workflow engine.

[Modern, Legacy and Awkward evidence](evidence/e2e-round-2/README.md) demonstrates
different web structures, including non-semantic controls and table-based layouts.
The Legacy lookup used a direct content page; frame handling has separate driver
tests, and Legacy account creation exposed a real fixture defect. These results
do not establish compatibility with arbitrary applications or current safety
permissions for every surface.

A desktop extension would need an adapter for accessibility or screenshot-based
observation and mouse/keyboard actions, new typed target strategies, and matching
Discovery/Builder validation. CSS and roles are web-specific; existing selectors
would not transfer unchanged. Ordered actions, typed inputs/outputs, checkpoints
and dispatch/recovery concepts could remain. Desktop support is not implemented.

**Multi-tenant reuse.** A proposed capability family would identify vendor product,
supported application version and capability version. Each tenant would supply a
trusted entry URL, policy and reviewed logical-target overrides. Institutions using
the same vendor workflow could share its steps and input/output contract while
specializing locators and configuration. Overrides must not silently change business
semantics or expand policy; changed steps require a separately validated capability
version. No tenant registry or override loader exists today.

**Drift and compatibility.** Current Replay fails closed on missing/ambiguous targets
and unmet semantic/output conditions; these signals can also indicate runtime faults,
so they do not automatically identify version drift. A future compatibility probe
would check version/surface markers and required targets before modifying actions.
Tenant-specific changes would require recorded evidence and regression Replay;
reuse saved evidence for recompilation when sufficient, otherwise run targeted
Discovery. Quarantine an incompatible configuration rather than guess or invoke
an LLM during Replay. Cross-tenant reuse still requires independent validation.

**Trade-offs.** The MVP demonstrates a modular web implementation and extensible
contract without a desktop runtime, fleet management platform or distributed
infrastructure. Shared capability families could reduce repeated discovery across
many tenants and apps, but compatibility review, policy isolation and evidence
validation remain essential costs. This describes a future deployment path,
not demonstrated multi-tenant scaling.

## Escalation & handoff

Replay now supports opt-in CLI handoff: take-control, resume, abort. Eligible step
failures pause in the same browser/context, preserving completed steps, outputs
and pending writes. Manual event metadata and before/after diagnostics are recorded;
current safety policy persists sanitized DOM instead of raw screenshots.
Resume checks existing artifact conditions and confirms relationships. Only safe
reads/checks or proven beforeDispatch operations may retry once; insufficient
proof stops unresolved or OUTCOME_UNKNOWN.

Automated tests cover five-step continuation, unresolved/aborted handoff, uncertain
writes and real-browser session-expiry remediation with a simulated operator.
Live Replay operator runs demonstrate successful and unresolved recovery. Discovery
now registers a typed request_human SDK tool, serializes tool execution, pauses its
active budget during bounded human control, and requires fresh refs on return.
Compilation admits human changes only under a trusted temporary-blocker dismissal
policy with audit and offline DOM checks. Human-only business steps are rejected;
DOM checks cannot prove hidden server effects. Automated tests use scripted API
responses and simulated operators. Separately, [live acceptance](evidence/discovery-handoff/manual/README.md)
confirms genuine Claude Discovery -> Compilation -> fresh Replay with a real
operator, plus unresolved, abort and manual-business-action rejection scenarios.
Section 3.6 is accepted for this controlled web MVP. Other tabs,
crash-resume and OS-level control locking remain out of scope; no dashboard was added.

## Safety

Trusted origins, page routes, action types and operation rules apply in both
Discovery and Replay. Actual resolved targets need narrow safe/risky permission;
unknown or blocked operations are denied before dispatch. Redirect destinations
are checked before following them; allowed JS/CSS resources do not need page routes.
Artifact effect annotations cannot grant permission. Risky operations are blocked
unless a trusted rule explicitly permits them; no approval UI was added.

Centralized text/JSON persistence removes known secrets, sensitive-key values and
echoes, classified inputs/DOM values and common sensitive patterns. Raw screenshots
are omitted, with sanitized DOM diagnostics retained. Compilation fails if redaction
removes required evidence. Trusted synthetic/public classification is required;
sensitive applications are refused. Classification remains necessary for arbitrary
PII: this is not universal detection or production DLP. Deterministic/real-browser
verification passed, including permitted synthetic account creation. A final genuine
Claude Discovery -> separate Compilation -> fresh deterministic Replay also passed
with the unchanged current policy: M-1005, Term Deposit, $50,000.00. See
[live evidence](evidence/safety-3-4/final-live-e2e/README.md) and [safety limits](docs/safety.md).

## Cuts

No distributed services, database, plugin framework, desktop automation, tenant
infrastructure or conditional workflow engine. The Banking Sandbox is a local,
client-storage fixture with known defects preserved, not a banking backend.

Section 3.7's design is documented above; desktop and multi-tenant implementations
remain deliberate cuts. Final live E2E acceptance with the current safety policy
is recorded under Safety. Section 3.4 is implemented and regression-tested
within the documented synthetic/public MVP boundary.
Section 3.6 is closed for the documented web MVP. Final reviewer checks and
remaining pre-submission concerns are recorded in [reviewer readiness](docs/reviewer-readiness.md).
