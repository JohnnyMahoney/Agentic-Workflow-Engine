# Output readiness (Capability v2.1)

The existing pipeline and Surface Adapter interface are unchanged. Add a
`validation` object to every output with a `savedValue` source:

```json
{
  "reference": {
    "type": "string",
    "description": "Displayed reference",
    "source": { "savedValue": "referenceValue" },
    "validation": {
      "condition": { "kind": "textMatches", "pattern": "ORD-[0-9]+" },
      "timeoutMs": 5000
    }
  }
}
```

For known input-bound identity use
`{"kind":"textEquals","value":{"input":"memberId"}}`.
Literal equality is also supported for genuine invariants. Do not freeze a
variable value to the discovery example. A valid zero is a string matching the
declared format, not a falsy numeric value.

Patterns match the full string without flags. Empty/blank-accepting or syntactically
invalid patterns are rejected. Evaluation is limited to 25 ms, 512 pattern
characters and 4096 sample characters; invalid/expensive evaluation fails closed
with `OUTPUT_PATTERN_ERROR`. The evaluator is a constant Node VM script; artifact
text is data, not executable JavaScript. The engine knows no application formats.

At the source extract step, Replay polls the actual target and applies all output
conditions attached to that saved value. Only the exact sample passing all checks
is stored; there is no second unchecked read. Each condition has a 1–30000 ms
timeout. Browser operations are bounded by the remaining budget (maximum 1000 ms)
and polling sleeps at most 50 ms. Browser scheduling/probes may add overhead.
Missing targets can appear during this bounded read; ambiguity remains a hard
failure. Explicit readiness replaces the older extract retry loop for that value.
Policy detectors continue to run during polling. No modifying action is repeated.

Timeout returns code `OUTPUT_VALIDATION_TIMEOUT`, step ID, output name,
expected condition, last observed value, evidence reference and retryability.
With an outstanding potentially modifying action, status is `OUTCOME_UNKNOWN`;
otherwise it is `RECOVERABLE_ERROR`. No partial outputs are reported as success.
Failure capture gets its own bounded timeout instead of inheriting the expired
read budget.

Builder checks the actual extraction's cited value, then known intermediate
samples since the preceding UI action. Contradictory conditions produce
`OUTPUT_EVIDENCE_MISMATCH`; an accepted distinct intermediate value produces
`PREMATURE_OUTPUT_VALIDATION`. `output-readiness-validation.json` records positive
samples, rejected intermediate values and limits. Discovery is unchanged.

Sparse evidence may have only a final value. That proves compatibility with the
sample, not complete readiness or format semantics. Format checks cannot detect
a stale but well-formed value; identity and other business checkpoints remain
necessary. A model-proposed pattern may allow formats never demonstrated in the
recording. Review its intended coverage; do not claim those formats were tested.

Version 2.0 remains parseable/replayable. Results distinguish `validated` from
`legacy-unverified` output readiness. New compilation rejects a downgrade to 2.0;
recompile saved evidence to obtain the new guarantee. Page URL outputs retain
their URL checkpoints and do not use extracted-value validation.

Run `npm.cmd test` for delayed-value, permanent-placeholder, zero-value, evidence
and compatibility regressions. Optional `OUTPUT_READINESS_EVIDENCE_DIR` retains
their evidence in a fresh directory; otherwise tests use a temporary directory.
See the [actual recompilation and replay](../evidence/output-readiness/README.md).

## Selected option labels

An extract step may declare `property: selectedOptionLabel`:

```json
{
  "id": "extractType",
  "action": "extract",
  "target": "accountTypeSelect",
  "property": "selectedOptionLabel",
  "saveAs": "accountTypeSaved"
}
```

The target is the visible native single `<select>`, not an option child. Omitted
property and `property: text` keep the existing innerText behavior. The adapter
returns the selected label (which can differ from its value), and output readiness
validates that exact sample as usual. Multiple selects and missing selections are
explicit failures.

Builder accepts an after-state from the actual form_input on that select, or a
read_page/get_page_text observation with selectedOption metadata. It checks target
identity, visibility, native select type and recorded label; it does not invent a
text observation for a hidden option. Legacy text extraction rules are unchanged.

This proves only the selection before submission. A workflow opening an account
must separately wait for post-action confirmation and verify the requested member
and type. A selected label alone cannot clear uncertainty after a creation action.
