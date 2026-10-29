# Challenging DOM vertical slice evidence

The [2026-10-29T05-43-41-861Z run](2026-10-29T05-43-41-861Z/) contains:

| File | Purpose |
| --- | --- |
| [discovery events](2026-10-29T05-43-41-861Z/discovery/challenging/events.jsonl) and [summary](2026-10-29T05-43-41-861Z/discovery/challenging/summary.json) | Genuine Claude Browser Use run, including actions, observations, and pre-action DOM inspection. |
| [artifact.json](2026-10-29T05-43-41-861Z/artifact.json) | Five-field versioned capability contract derived from the discovery run. |
| [artifact-build.json](2026-10-29T05-43-41-861Z/artifact-build.json) | Discovery log SHA-256 and the evidence used to compile the artifact. |
| [replay Iuvaret4](2026-10-29T05-43-41-861Z/replay-Iuvaret4/result.json) | Fresh Playwright session; success, `Phaedrum4`. |
| [replay Iuvaret7](2026-10-29T05-43-41-861Z/replay-Iuvaret7/result.json) | Second fresh session; success, `Phaedrum7`. |
| [replay not found](2026-10-29T05-43-41-861Z/replay-not-found/result.json) | Separate run; structured `not_found` outcome for `Iuvaret42`. |

Each replay directory also has `events.jsonl`; successful runs include a final screenshot.
Replay uses only Playwright and the saved artifact. Its entry point does not load `.env`.

## Recorder refactor check

The [2026-10-29T06-03-25-721Z run](2026-10-29T06-03-25-721Z/) repeated live
discovery with the extracted recorder and driver. Its [discovery log](2026-10-29T06-03-25-721Z/discovery/challenging/events.jsonl)
produced a [versioned artifact](2026-10-29T06-03-25-721Z/artifact.json) and
[source hash](2026-10-29T06-03-25-721Z/artifact-build.json). Two new Playwright
sessions replayed it successfully for [Iuvaret4](2026-10-29T06-03-25-721Z/replay-Iuvaret4/result.json)
and [Iuvaret7](2026-10-29T06-03-25-721Z/replay-Iuvaret7/result.json).

The preceding [diagnostic run](2026-10-29T06-02-42-073Z/discovery/challenging/events.jsonl)
found a recorder timing issue: it captured the URL immediately after the `edit`
click, before the `#edit` fragment appeared. The driver now waits for the
fragment before recording that checkpoint.
