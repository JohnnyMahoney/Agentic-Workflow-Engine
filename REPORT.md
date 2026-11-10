# Design report — Work in Progress

## Architecture

A modular TypeScript/Node.js monolith implements Claude Discovery → Discovery
Acceptance → separate Claude Compilation → Evidence Validator → Capability Artifact
→ deterministic Playwright Replay. Sections 3.1-3.3 are implemented and tested for
the current web MVP scope; this is not a completed assignment submission.

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

Only explicitly supported safe reads can retry. Writes are never reissued by the
engine. An unconfirmed potential mutation yields OUTCOME_UNKNOWN and requires
external reconciliation. Semantic checkpoints and output conditions reject known
premature states, but sparse observations cannot establish exhaustive correctness.
Effect annotations and conclusive rejection detectors still require trusted review.

Genuine E2E evidence includes parameterized table replays, member lookups and
independently verified Youth account creation. Separate real-browser runtime fixtures
cover business refusals, slowness, timeout, permission/session errors, unexpected
dialogs, ambiguous targets and committed-but-unverified writes. Fixtures are not
presented as Claude-generated capabilities. Original failures remain available.

## Heterogeneity & multi-tenant

Modern, iframe/table-based Legacy and non-semantic Awkward UIs share the same web
adapter. The contract → target registry → resolver → adapter boundary keeps browser
handles out of the workflow. CSS and roles remain web strategies, not universal
cross-surface locators. A desktop implementation would require explicit supported
strategies, observation evidence and an adapter; none exists yet.

A future tenant reuse design would separate vendor workflow/version from trusted
tenant entry points, policy and reviewed target overrides. Compatibility probes and
checkpoint validation would reject unknown variants instead of silently guessing;
changed versions would require evidence-backed revalidation or discovery. This is
a proposed direction, not an implemented registry, override system or drift service.

## Escalation & handoff

Replay now supports opt-in CLI handoff: take-control, resume, abort. Eligible step
failures pause in the same browser/context, preserving completed steps, outputs
and pending writes. Manual event metadata and before/after screenshots are recorded.
Resume checks existing artifact conditions and confirms relationships. Only safe
reads/checks may retry once; insufficient proof stops unresolved or OUTCOME_UNKNOWN.

Automated tests cover five-step continuation, unresolved/aborted handoff, uncertain
writes and real-browser session-expiry remediation with a simulated operator.
Live Replay operator runs demonstrate successful and unresolved recovery. Discovery
now registers a typed request_human SDK tool, serializes tool execution, pauses its
active budget during bounded human control, and requires fresh refs on return.
Compilation admits human changes only under a trusted temporary-blocker dismissal
policy with audit and offline DOM checks. Human-only business steps are rejected;
DOM checks cannot prove hidden server effects. Automated tests use scripted API
responses and simulated operators, not genuine Claude acceptance. Full live
Discovery -> Compilation -> Replay handoff acceptance remains pending. Other tabs,
crash-resume and OS-level control locking remain out of scope; no dashboard was added.

## Safety

Trusted origin/action allowlists apply to discovery and replay; model artifacts
cannot expand them. Mutation uncertainty is handled conservatively. This is partial
§3.4 coverage, not a production safety boundary: comprehensive risky-action approval,
route-level restrictions and sensitive-data sanitization need further work.

Form-input scrubbing is incomplete protection. Page text, screenshots, model replies
and declared outputs may contain data. Current evidence uses synthetic banking or
public demo data only. Keys belong in ignored .env files, not artifacts. Do not use
this capture pipeline with real credentials or financial PII.

## Cuts

No distributed services, database, plugin framework, desktop automation, tenant
infrastructure or conditional workflow engine. The Banking Sandbox is a local,
client-storage fixture with known defects preserved, not a banking backend.

Next priorities are live full-pipeline handoff acceptance, safety completion and focused acceptance
coverage. Sections 3.4-3.7 are not collectively claimed complete. Reviewer cleanup
changes documentation/navigation only and does not substitute for those deliverables.
