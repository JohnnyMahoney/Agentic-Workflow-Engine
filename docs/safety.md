# Safety and policy guardrails - Section 3.4

The current MVP enforces trusted policy during Discovery and Replay. The CLI
requires an explicit `--policy`; model instructions and artifact effect annotations
cannot grant permission. Use the updated example policies, not old evidence copies.

## Policy

`origins` and `actions` remain explicit allowlists. `routes` contains exact
pathnames or trailing `/*` patterns. Missing routes deny page navigation. URL
credentials, non-HTTP(S) schemes, ambiguous encoded path separators and unlisted
destinations are denied. Query values are not a route permission mechanism.

Navigation requests, frame loads and redirect destinations are checked before
the destination request. Resource requests may load JS/CSS from allowed origins
without matching a page route. Redirect fetching never automatically follows an
unchecked Location. Service workers are disabled in managed contexts.

`operations` grants narrow mutation permissions using the actual resolved element:

```json
{
  "action": "click",
  "path": "/modern.html",
  "selector": "#w button:not([type])",
  "risk": "risky",
  "allow": true
}
```

Every click/fill/selectOption requires a matching rule. An unknown operation,
`risk: blocked`, or missing explicit `allow: true` is denied. Deny takes precedence
over matching allows. Frame operations additionally require an explicit framePath.
Policy authors classify safe/reversible versus risky operations; the model does
not. The banking example deliberately permits the synthetic creation operation
above. No blanket approval of all page clicks is added.

Replay authorizes before marking a mutation dispatched, then rechecks inside the
adapter. Pre-dispatch policy denial reports POLICY_DENIED with no write. A policy
denial is not a reason for handoff, and Resume cannot expand trusted permissions.
The current Modern example covers Modern controls; other pages/versions need their
own reviewed narrow operation rules. Artifact compatibility does not imply that an
old policy without these permissions remains executable.

## Persistence

Production writers share a sanitizer for JSON, JSONL and text. It removes sensitive
key values and their echoes, known secret environment values, explicitly sensitive
inputs, marked/password fields, configured sensitive DOM selectors, URL query
values, authorization strings and common token/email/SSN/card patterns. Known-value
matching covers raw, URL-encoded and HTML-escaped variants. It is not universal PII
recognition; authors must classify additional sensitive data before capture.

Trusted `privacy` declares `dataClass: synthetic` or `public`, `sensitiveInputs`,
`sensitiveSelectors` and `secretEnv` (environment variable names, not their values).
Missing classification and `dataClass: sensitive` stop the MVP before the run.
This intentionally refuses production sensitive applications instead of asserting
that pattern matching can safely capture them. Public classification is a trusted
assertion about the target and must not be used to bypass that restriction.

Raw screenshots are never persisted by current production writers. Discovery may
use screenshots in memory with its LLM; the journal records omission. Replay and
handoff save sanitized DOM diagnostics as `failure.png.json` and
`handoff-<step>-<phase>.png.json`, with explicit image-omission events. These are JSON
diagnostics, not images. Page state is not modified for redaction.

Compilation refuses evidence/candidates containing redaction markers when saving
an artifact. Removed locator/checkpoint evidence cannot be invented or accepted by
weakening validation. Runtime output values returned by Replay are also sanitized.

## Tests and limits

```powershell
npm.cmd run build
node --test --test-concurrency=1 dist/tests/safety.test.js
node --test --test-concurrency=1 dist/tests/*.test.js
npm.cmd run test:banking
```

Banking tests require the bundled sandbox server. See
[saved verification](../evidence/safety-3-4/README.md) for exact local commands.

These are deterministic and real-browser tests, including scripted SDK tests for
Discovery/handoff. A [genuine final Claude E2E](../evidence/safety-3-4/final-live-e2e/README.md) also passed
with the unchanged current policy and a fresh deterministic Replay. Historical
synthetic evidence remains unchanged, including earlier screenshots. This work does
not certify those historical writers or arbitrary caller code using filesystem or
browser APIs directly. Browser chrome, human actions and application scripts are
outside adversarial isolation; this is an automation guardrail, not an application
security sandbox or production data-loss-prevention system.
