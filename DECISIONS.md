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
| LLM discovery | **Experimental:** Claude Browser Use. | Its fit for this project depends on a real run; installing the SDK is not proof that it works. |

## Browser-use experiment

In the first slice, run a real LLM-driven task against a live UI. Check behavior
on a straightforward page and an intentionally awkward page or flow where useful
(for example, no test IDs, nested tables, or an iframe). Record whether we can:

- observe and intercept actions well enough to build a reusable artifact;
- keep control of the same live session for inspection and human handoff;
- separate discovery from later Playwright replay without an LLM in the replay loop.

After the slice, add the evidence and observed limitations here. Then decide
whether to keep Claude Browser Use or try another driver. Do not mark the
experiment accepted before those checks are demonstrated.
