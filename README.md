# Agentic Workflow Engine

This repository implements a web discovery and deterministic replay slice for the
interface.ai assignment. Claude Browser Use
explores a live page; the recorded run produces a versioned JSON artifact that
Playwright replays in a fresh browser session without Claude. Capability v2 adds a
separate Claude compilation call and deterministic validation against recorded evidence.

## Run Capability v2

Use Node.js 22.18+ and put `ANTHROPIC_API_KEY=...` in a root `.env` file. The file
is ignored by Git.

```powershell
npm.cmd ci
npx.cmd playwright install chromium
$run = Join-Path 'evidence/capability-v2' (Get-Date -Format 'yyyy-MM-ddTHH-mm-ss')
npm.cmd run capability:discover -- --request examples/challenging.json --out "$run/discovery"
npm.cmd run capability:compile -- --evidence "$run/discovery/discovery-v2.json" --out "$run/compilation"
npm.cmd run capability:replay -- --artifact "$run/compilation/artifact.json" --input rowKey=Iuvaret7 --out "$run/replay"
```

Each output directory must be empty. Discovery and compilation load `.env`;
validation and replay do not call Claude. The [implementation guide](docs/capability-v2.md)
includes both workflows, compilation retry, offline validation, and limitations.

```powershell
npm.cmd test
npm.cmd run typecheck
```

See [engineering decisions](DECISIONS.md) and [v2 evidence](evidence/capability-v2/README.md)
for the results. The original `slice:discover` and `slice:replay` commands and
[v1 evidence](evidence/vertical-slice/README.md) remain available. The earlier
[browser-use spike evidence](evidence/browser-use-spike/) covers three discovery cases.
