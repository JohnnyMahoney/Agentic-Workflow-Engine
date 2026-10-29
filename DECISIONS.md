# Engineering Decisions

This records the engineering choices behind the current web slice. The
interface.ai assignment defines the requirements.

| Area | Current choice | Reason and limit |
| --- | --- | --- |
| Architecture | **Chosen:** TypeScript and Node.js in one modular application. | Simple to run and review. Distributed execution and scaling infrastructure are outside the MVP. |
| Artifact validation | **Chosen:** Zod for the minimal versioned artifact. | Replay validates JSON at runtime before browser execution. |
| Browser execution | **Chosen for the web slice:** Playwright. | It provides browser actions, inspection, and assertions. Native desktop control is outside this implementation. |
| LLM discovery | **Accepted for web discovery:** Claude Browser Use with a local Playwright driver. | See [D3](#d3--browser-use-for-discovery) for evidence and limits. |

## D3 — Browser Use for Discovery

**Status:** Accepted for web discovery.

**Decision:** Use Claude Browser Use for the LLM-driven discovery loop, backed by
our local Playwright browser driver. Record each observation and proposed action
before execution. Compile a versioned capability artifact from a successful run;
execute that artifact with Playwright without an LLM in the replay loop.

**Why:** Claude completed live UI tasks across frames, repeated table links, and
asynchronous loading. The toolset lets us intercept actions, inspect their DOM
targets, and retain control of the browser session. One real Challenging DOM run
produced an artifact that replayed successfully with two different row inputs.
This meets the agreed GO criterion for the web discovery layer.

**Evidence:** The [initial browser-use runs](evidence/browser-use-spike/) cover
Nested Frames, Challenging DOM, and Dynamic Loading. The
[vertical-slice evidence index](evidence/vertical-slice/README.md) links the
genuine discovery logs, source hashes, versioned artifacts, and two successful
fresh-session replays with distinct row inputs. It also records a structured
not-found outcome and the URL timing issue found during the recorder refactor.

**Trade-offs and limits:** We maintain a small Playwright driver because the
Stagehand local CDP connection failed on this Windows machine. Browserbase was
not evaluated. Session-scoped refs and screen coordinates are unsuitable as
replay targets on their own; the artifact uses a unique row key, column header,
and link name. Hash links need an explicit URL wait before recording a
post-action checkpoint. The current replay executor supports the demonstrated table
operations. Interaction with a genuinely non-semantic control, native desktop
surfaces, and same-session pause, human takeover, and resume are still untested.

**Alternatives considered:** Custom Claude tool definitions with Playwright
would give us control but require maintaining our own tool protocol. Stagehand
local was attempted and failed during browser startup. The current driver is
the smallest tested integration for this web slice.
