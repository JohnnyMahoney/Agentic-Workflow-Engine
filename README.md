# Agentic Workflow Engine

This repository currently contains a technical spike for the interface.ai
[assignment](assignment/interface-ai-assignment.md). It evaluates Claude Browser
Use as the LLM discovery layer on [The Internet](https://the-internet.herokuapp.com/).
It does not yet implement saved capabilities or deterministic replay.

## Run the browser-use spike

Requirements: Node.js 22.18+, an Anthropic API key with access to a model supporting
the browser toolset, and network access to the Claude API and test site. Browser Use
is an Anthropic client toolset. The default local mode uses Playwright to drive
Chromium; the optional Browserbase mode uses `stagehand-claude-sdk` and needs a
Browserbase key.

Put your key in the repository root `.env` file (created from `.env.example`):

```dotenv
ANTHROPIC_API_KEY=your_key_here
```

The `.env` file is ignored by Git. Then run in PowerShell:

```powershell
npm.cmd ci
npx.cmd playwright install chromium
npm.cmd run spike:browser-use -- --scenario all --browser local
```

For an optional hosted Browserbase run, also set `BROWSERBASE_API_KEY` in `.env`:

```powershell
npm.cmd run spike:browser-use -- --scenario all --browser browserbase
```

The Stagehand local driver failed with `CDP websocket failed to open` on this
Windows machine. The Playwright local driver succeeded in live runs of all three
scenarios. It implements only the browser members needed for this spike, not the
full Browser Use toolset. Browserbase mode has not been tested.

Use `--scenario nested`, `--scenario challenging`, or `--scenario dynamic` to run
one case. Use `--model MODEL_ID` if your Anthropic account supports a different
browser-toolset model. `--headed` shows the local browser window.

| Scenario | Task |
| --- | --- |
| Nested Frames | Read the words inside the top child frames and bottom frame. |
| Challenging DOM | Read the Diceret value in the Iuvaret4 row and click that row's edit link. |
| Dynamic Loading | Click Start and wait until “Hello World!” appears. |

Each real run writes `events.jsonl` and `summary.json` under a timestamped
`evidence/browser-use-spike/` directory. The log records model replies,
observations, proposed browser calls, a hook immediately before driver execution,
outcomes, failures, and candidate replay targets. Screenshot calls also save PNGs.
Reference IDs and coordinates are recorded as *candidates*, not accepted as stable
replay locators. When a reference has a readable role and name, the log proposes
a Playwright role/name locator and notes whether the label is unique in that
observation; this is still not a replay verification. The Challenging DOM summary
marks the row click verified when the pre-action DOM inspection identifies the
`edit` link in the Iuvaret4 row. It also records a row-scoped replay candidate,
which still needs a fresh-session replay check.

The runner limits each scenario to 18 model turns and 35 browser actions, with a
three-minute abort timer for API calls. The host is restricted to
`the-internet.herokuapp.com`; typing and form
values are redacted in logs. See [DECISIONS.md](DECISIONS.md) for the live run
results and remaining limits. `npm.cmd run typecheck` checks the TypeScript
source without contacting Anthropic.
