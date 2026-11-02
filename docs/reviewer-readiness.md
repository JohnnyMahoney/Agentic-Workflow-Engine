# Reviewer readiness cleanup

Documentation/navigation only. No source, contract, test or CLI changes; no new
Claude call, commit or push. The assignment PDF and current implementation were
reviewed. No provided architecture screenshot was found in the repository; README
uses Mermaid rather than substituting an unrelated image.

## Repository layout

```text
README.md                  reviewer entry point and exact demo commands
REPORT.md                  seven-section WIP design report
DECISIONS.md               architecture decisions and trade-offs
docs/                      contract, runtime, readiness and acceptance details
src/                       working implementation and tests (unchanged)
examples/banking/          explicit request and origin/action policy
banking-sandbox/           original synthetic UI, including legacy iframe
scripts/                   Node static fixture server
evidence/README.md         curated evidence navigation
evidence/e2e-round-2/       genuine model runs, retries and verified replays
evidence/runtime-3-3/      labeled real-browser runtime fixtures
evidence/reviewer-readiness/  this cleanup's verification
```

Existing directory names are retained. The supplied assignment stays locally in
ignored assignment/; it is not a public repository dependency for running the demo.

## Retention and cleanup disposition

The original evidence inventory contained 780 files, about 16.6 MB. The retained
representatives are linked from [evidence/README.md](../evidence/README.md): Modern
and Legacy lookups, Awkward zero/readiness recovery, Modern/Awkward Youth creation,
original negative Case 2 replay and the structured runtime-error suite.

Moved files: **none**. Removed files: **none**. No backup was necessary. Historical
failures and intermediate compilations remain because they explain validation
rejections, recovery and test dependencies. Navigation was simplified instead.

The tracked root debug.log is browser diagnostic noise, not curated evidence.
It was retained, including browser-generated additions during verification. Suggested
future cleanup, requiring deletion approval: remove only debug.log from Git tracking
while keeping a local copy, then ignore /debug.log. No such removal was performed.
Do not blanket-ignore evidence logs, since they are required audit material.

.gitignore already excludes .env/.env.*, dependencies, build output and assignment,
while retaining .env.example. A recognized-secret-pattern scan found no matches in
tracked text files; this is not an exhaustive PII or Git-history security audit.
No actual key values were printed. Technical docs retain separate responsibilities;
stale runtime-future wording was corrected, and the six-case index now explicitly
acknowledges stopped pipelines rather than claiming every stage ran for every case.

## Verification

- TypeScript build: passed.
- Typecheck: passed.
- Unit/regression tests: 24 passed, 0 failed.
- Banking runtime suite: 12 passed, 0 failed, using the bundled fixture served at
  localhost:18082 in isolated browser contexts. No Reset of the user's browser.
- Saved genuine Modern artifact replayed without Claude on localhost:8080: SUCCESS,
  M-1005, Term Deposit, $50,000.00. The old artifact reports legacy-unverified
  readiness; this is not a new v2.1 compilation or readiness guarantee.
- README script names/flags checked against package.json and capability/cli.ts.
  Full live Discovery/Compilation commands were not executed: no new Claude run
  was authorized for cleanup. Python is an optional documented static-server
  alternative; the Node server was the one actually exercised.
- Logs and runtime artifacts: [verification evidence](../evidence/reviewer-readiness/).

Remaining gaps: same-session handoff, production safety/redaction, conditional
existing-account handling, desktop and tenant-specific reuse. This cleanup does
not close those assignment requirements or certify arbitrary-site reliability.
