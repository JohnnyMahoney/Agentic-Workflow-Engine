# AGENTS.md — Engineering Instructions

## 1. Source of Truth

The primary source of requirements is `assignment/interface-ai-assignment.pdf`.

**Goal:** Build a correct, focused MVP of the computer-use automation system described in the interface.ai assignment, satisfying the requirements in the provided PDF.

Before implementing a feature, consult the relevant assignment sections. Do not replace explicit requirements with assumptions or generic best practices.

The assignment takes precedence over this file, `DECISIONS.md`, and development prompts.

## 2. Engineering Philosophy

- Prefer simplicity over overengineering.
- Build a small, modular, easy-to-review system.
- Use a modular monolith unless there is a demonstrated need for more.
- Prioritize working end-to-end behavior over additional features.
- Keep module responsibilities and interfaces clear.
- Design for the required use cases, not hypothetical production infrastructure.
- Implement incrementally through small vertical slices.
- Do not silently expand the scope.

## 3. Decision-Making Rules

Follow the current development prompt and accepted decisions in `DECISIONS.md`.

Do not independently introduce significant architectural decisions, frameworks, dependencies, abstractions, or scope changes.

When a meaningful decision is required:

1. Explain the decision briefly.
2. Present the relevant alternatives.
3. Describe the practical trade-offs.
4. State which alternative you recommend and why.
5. Ask the developer before proceeding.

Do not silently choose an outcome when requirements are ambiguous or conflicting.

Minor implementation details that do not affect architecture, scope, or behavior may follow existing conventions.

Record approved architectural decisions in `DECISIONS.md`.

## 4. Initial Technology Direction

Current direction:

- TypeScript / Node.js.
- Claude Browser Use as the first discovery candidate.
- Playwright as the proposed browser execution layer.
- Zod as the proposed runtime schema validation library.
- Local mock banking application as the initial test target.

These are initial choices, not permission to implement the entire architecture upfront.

First, validate the actual Claude Browser Use integration and determine whether it supports the control, observation, recording, and session requirements of the assignment.

Do not assume compatibility with legacy surfaces, multiple LLM providers, or deterministic replay until demonstrated or explicitly documented.

Maintain a clear boundary between LLM discovery and browser execution.

## 5. Assignment Requirements

The final MVP must cover all core requirements in Section 3.

### Discovery
- Accept a natural-language goal and application target.
- Execute a genuine LLM-driven observe → decide → act loop against a live UI.
- Implement stopping conditions such as step limits, timeouts, and dead ends.
- Preserve evidence of at least one actual LLM-driven run.

### Capability Artifact
- Save a typed, serialized, versioned, reusable artifact.
- Represent ordered actions, element targeting, typed inputs, typed outputs, and success checkpoints.
- Keep the artifact independent of the raw LLM transcript.

### Deterministic Replay
- Replay with supplied input parameters and no LLM in the decision loop.
- Verify successful execution and return declared outputs.
- Distinguish expected business outcomes, recoverable runtime conditions, and hard failures.
- Report failures with useful execution context.

### Safety
- Enforce configurable domain/route and action allowlists.
- Handle risky or irreversible operations conservatively.
- Do not persist API keys, credentials, tokens, or unredacted sensitive financial information.
- Apply safety checks to both discovery and replay.

### Evidence
- Maintain structured execution logs.
- Preserve diagnostic evidence for failures.
- Never fabricate successful runs, test results, screenshots, or logs.

### Human Handoff
- Detect blocked or unsafe execution.
- Create an intervention request with relevant context.
- Pause automation and transfer control of the same live session to a human.
- Record manual intervention and support explicit control return and resumption.
- A sophisticated operator dashboard is not required.

### Heterogeneity
- Implement one concrete surface.
- Keep browser-specific behavior separate from the reusable capability contract where practical.
- Explain how the approach could extend to legacy web, desktop, and multi-tenant environments.
- Do not implement desktop or multi-tenant infrastructure unless separately approved.

## 6. Development Workflow

For each requested vertical slice:

1. Identify the relevant assignment requirements.
2. State the smallest implementation scope.
3. Flag unresolved architectural decisions.
4. Implement only the approved scope.
5. Validate the implemented behavior with appropriate tests.
6. Report what works, what failed, and what remains.
7. Update documentation when a decision or behavior changes.

Keep `AGENTS.md` stable. Change it only after a vertical slice has been completed
and validated, or when an approved trade-off or concrete concern needs to be
recorded. Limit the edit to the affected instructions; do not rewrite this file
for speculative plans.

Do not treat a prototype or simulated execution as proof of an actual LLM-driven run.

## 7. Required Deliverables

Follow Section 6 of the assignment.

`README.md` must explain setup and exact discovery/replay commands.

`REPORT.md` must use these exact seven headings:

1. Architecture
2. Artifact schema
3. Determinism & error handling
4. Heterogeneity & multi-tenant
5. Escalation & handoff
6. Safety
7. Cuts

Keep the final report approximately 1–3 pages.

`evidence/` must include a saved example artifact, genuine discovery logs, and replay logs. Include an exceptional replay case where feasible.

The final public repository must be easy for a reviewer to understand and run.

## 8. Scope Control

Do not introduce microservices, queues, distributed infrastructure, databases, complex dashboards, or optional stretch goals without a clear need and explicit approval.

Do not sacrifice any core requirement merely to make another part more polished.

Prioritize artifact design, deterministic replay, runtime error handling, safety, and the human-control transfer model.

**Guiding principle:** Minimal implementation scope, complete requirement coverage, clear engineering decisions.
