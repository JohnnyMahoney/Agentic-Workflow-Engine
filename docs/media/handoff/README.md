# Human Handoff documentation screenshots

These are real screenshots captured manually by the author during the synthetic
Replay run `evidence/handoff-screenshots/20261109-222842/`. Original image bytes
were copied without editing; no images were generated.

| File | Capture and caption |
| --- | --- |
| `01-paused.png` | Automation browser and terminal showing the intervention reason, step and paused ownership. |
| `02-human-control.png` | After `take-control`, the same browser while the operator dismisses the synthetic access blocker. |
| `03-resumed-success.png` | Terminal showing Resume, deterministic verification/SAFE_RETRY and SUCCESS with the expected outputs. |

Follow the [README live demo](../../../README.md#human-handoff--live-demonstration).
Use synthetic data only; exclude keys, personal information, unrelated windows and
terminal history containing secrets. Runtime screenshot persistence remains disabled;
these are deliberate manual documentation captures, not engine-generated evidence.

The root README embeds all three files. The terminal shows the ordered lifecycle
and final SUCCESS with M-1001 / Checking / $2,450.75 and validated output readiness.
The [run events](../../../evidence/handoff-screenshots/20261109-222842/events.jsonl)
and [result](../../../evidence/handoff-screenshots/20261109-222842/result.json)
provide structured evidence. Earlier [live acceptance](../../../evidence/discovery-handoff/manual/README.md)
also remains available independently.
