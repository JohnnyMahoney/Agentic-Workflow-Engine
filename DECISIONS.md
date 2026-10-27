# Engineering Decisions

This is a short record of our choices for the first vertical slice. The
[assignment](assignment/interface-ai-assignment.pdf) defines the requirements;
this file explains our implementation choices. We will update it after the slice
has been tested.

| Area | Current choice | Reason and limit |
| --- | --- | --- |
| Architecture | **Chosen:** TypeScript and Node.js in one modular application. | Simple to run and review. Distributed execution and scaling infrastructure are outside the MVP. |
| Artifact validation | **Planned:** Zod for saved artifacts and other external data. | TypeScript types alone do not validate JSON at runtime. Add Zod when we implement the artifact contract. |
| Browser execution | **Chosen for the web slice:** Playwright. | It provides browser actions, inspection, and assertions. Native desktop control is outside this implementation. |
| LLM discovery | **Experimental:** Claude Browser Use with a small local Playwright driver. | Live runs passed three test scenarios. Replay and human handoff remain unverified. |

## Browser-use experiment

In the first slice, run a real LLM-driven task against a live UI. Check behavior
on a straightforward page and an intentionally awkward page or flow where useful
(for example, no test IDs, nested tables, or an iframe). Record whether we can:

- observe and intercept actions well enough to build a reusable artifact;
- keep control of the same live session for inspection and human handoff;
- separate discovery from later Playwright replay without an LLM in the replay loop.

The first spike completed real Claude API runs against the live test site:

| Scenario | Result | Evidence |
| --- | --- | --- |
| Nested Frames | Passed: Claude read LEFT, MIDDLE, RIGHT, and BOTTOM from the frames. | [run summary](evidence/browser-use-spike/2026-10-27T06-17-53-492Z/nested/summary.json) |
| Challenging DOM | Passed: Claude read Phaedrum4 and clicked `edit` in the Iuvaret4 row. A pre-action DOM inspection proved which row received the coordinate click. | [run summary](evidence/browser-use-spike/2026-10-27T06-17-24-314Z/challenging/summary.json), [action log](evidence/browser-use-spike/2026-10-27T06-17-24-314Z/challenging/events.jsonl) |
| Dynamic Loading | Passed: Claude clicked Start, waited, and observed `Hello World!`. | [run summary](evidence/browser-use-spike/2026-10-27T06-15-57-039Z/dynamic/summary.json) |

The SDK's `execute` hook lets us log actions before execution. The local browser
also records the DOM element under a coordinate click before acting. The same
Playwright page stays open throughout each scenario. Coordinate clicks are not
stable replay targets; row text and link role/name provide a possible locator,
but it has not been tested in a fresh session. Human handoff has not been tested.

The Stagehand local driver failed to open a CDP WebSocket on this Windows machine,
so the spike uses a small Playwright driver for the supported members. Browserbase
remains optional and untested. Keep Claude Browser Use experimental until a saved
artifact, deterministic replay, and handoff are checked.
