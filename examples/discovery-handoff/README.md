# Discovery and Replay operator demo

Standalone synthetic UI with a temporary operator acknowledgement overlay. It
does not modify the Banking Sandbox. The acknowledgement only removes the overlay;
the trusted policy describes that exact control. It is not a real login system.

Live acceptance has not been run yet. The commands below call Claude during
Discovery and Compilation, requiring `ANTHROPIC_API_KEY` in the ignored root `.env`.
Replay makes no LLM calls. Run from the repository root.

Terminal 1:

```powershell
node scripts/serve-discovery-handoff-demo.mjs
```

Terminal 2 (interactive, on the operator's desktop):

```powershell
$run = Join-Path 'evidence/discovery-handoff/live' (Get-Date -Format 'yyyy-MM-ddTHH-mm-ss')
npm.cmd run capability:discover -- --request examples/discovery-handoff/request.json --policy examples/discovery-handoff/policy.json --out "$run/discovery" --handoff
```

When asked for intervention, enter `take-control`, click only **Acknowledge access
as operator** in the same browser, then enter `resume`. Before take-control, page
input is locked. To stop, enter `abort`. Do not interact after returning control.
If Discovery fails, inspect its evidence and stop; do not compile incomplete runs.

After successful Discovery, compile the saved evidence:

```powershell
npm.cmd run capability:compile -- --evidence "$run/discovery/discovery-v2.json" --policy examples/discovery-handoff/policy.json --out "$run/compilation"
```

Only after validation succeeds:

```powershell
npm.cmd run capability:replay -- --artifact "$run/compilation/artifact.json" --input memberId=M-1001 --policy examples/discovery-handoff/policy.json --out "$run/replay" --handoff
```

The fresh Replay session shows the overlay again. Repeat take-control, click the
acknowledgement, resume. The expected outputs are M-1001, Checking and $2,450.75;
these are expected results, not a claim of an executed live test.

Inspect each run's `events.jsonl`, screenshots and results. Discovery also saves
`discovery-v2.json` with separate interventions. Compilation saves its request,
response, candidate and validation artifacts. Never overwrite an earlier run.

Headful Chromium launched inside a coding-agent sandbox may be invisible on the
Windows desktop. Launch these commands from your own terminal, or have the agent
launch outside its sandbox. See [implementation limits](../../docs/discovery-handoff.md).
