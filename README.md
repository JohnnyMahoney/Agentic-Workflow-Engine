# Agentic Workflow Engine

This repository implements a web discovery and deterministic replay slice for the
interface.ai assignment. Claude Browser Use
explores a live page; the recorded run produces a versioned JSON artifact that
Playwright replays in a fresh browser session without Claude.

## Run the Challenging DOM slice

Use Node.js 22.18+ and put `ANTHROPIC_API_KEY=...` in a root `.env` file. The file
is ignored by Git.

```powershell
npm.cmd ci
npx.cmd playwright install chromium
npm.cmd run slice:discover
```

The command prints an `artifactPath`. Replay the artifact with two row inputs:

```powershell
$run = (Get-ChildItem evidence/vertical-slice -Directory | Where-Object { Test-Path (Join-Path $_.FullName 'artifact.json') } | Sort-Object Name | Select-Object -Last 1).FullName
$artifact = Join-Path $run 'artifact.json'
npm.cmd run slice:replay -- --artifact $artifact --input rowKey=Iuvaret4 --out (Join-Path $run 'replay-Iuvaret4')
npm.cmd run slice:replay -- --artifact $artifact --input rowKey=Iuvaret7 --out (Join-Path $run 'replay-Iuvaret7')
```

See the [engineering decision](DECISIONS.md) and [vertical-slice evidence](evidence/vertical-slice/README.md)
for the tested outcome and current limits. The earlier [browser-use spike evidence](evidence/browser-use-spike/)
contains the three initial site scenarios.
