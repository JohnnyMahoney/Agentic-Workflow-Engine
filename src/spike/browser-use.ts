import Anthropic from "@anthropic-ai/sdk";
import { ToolError, type BetaBrowserMemberResult, type BetaToolsetCallContext } from "@anthropic-ai/sdk/helpers/beta/toolsets";
import type { BetaBrowserMemberInput, BetaBrowserMemberName } from "@anthropic-ai/sdk/resources/beta";
import { StagehandBrowser } from "stagehand-claude-sdk";
import { chromium } from "playwright";
import { LocalPlaywrightBrowser } from "./local-browser.js";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const host = "the-internet.herokuapp.com";
const rootUrl = `https://${host}`;

type ScenarioName = "nested" | "challenging" | "dynamic";
type BrowserMode = "local" | "browserbase";
type Event = Record<string, unknown>;

const scenarios: Record<ScenarioName, { url: string; goal: string }> = {
  nested: {
    url: `${rootUrl}/nested_frames`,
    goal: "Open the nested frames example. Inspect the live page and report the exact words in the three top child frames and the bottom frame. Read the frames rather than guessing from the page name.",
  },
  challenging: {
    url: `${rootUrl}/challenging_dom`,
    goal: "Open the Challenging DOM example. Find the table row whose first cell is Iuvaret4, read its Diceret cell, then click the edit link in that same row. Report the cell value and the URL after the click. Explain which visible evidence you used to identify the row.",
  },
  dynamic: {
    url: `${rootUrl}/dynamic_loading/2`,
    goal: "Open Dynamic Loading example 2. Click Start, wait for the asynchronously rendered result, and report the exact text that appears. Do not report success before observing the result.",
  },
};

function options(): { scenarios: ScenarioName[]; mode: BrowserMode; model: string; headless: boolean } {
  const args = process.argv.slice(2);
  const value = (flag: string) => {
    const index = args.indexOf(flag);
    return index < 0 ? undefined : args[index + 1];
  };
  const scenario = value("--scenario") ?? "all";
  const mode = value("--browser") ?? "local";
  if (!["all", ...Object.keys(scenarios)].includes(scenario)) throw new Error(`Unknown scenario: ${scenario}`);
  if (mode !== "local" && mode !== "browserbase") throw new Error(`Unknown browser mode: ${mode}`);
  return {
    scenarios: scenario === "all" ? ["nested", "challenging", "dynamic"] : [scenario as ScenarioName],
    mode,
    model: value("--model") ?? "claude-sonnet-5-5",
    headless: !args.includes("--headed"),
  };
}

function safe(value: unknown, key = ""): unknown {
  if (/api.?key|authorization|cookie|password|token|secret/i.test(key)) return "[REDACTED]";
  if (key === "text" && typeof value === "string" && value.length > 20_000) return `${value.slice(0, 20_000)}…[truncated]`;
  if (Array.isArray(value)) return value.map((item) => safe(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, safe(item, name)]));
  }
  return value;
}

class Journal {
  readonly observations: Array<{ action: number; text: string }> = [];
  readonly actions: string[] = [];
  readonly clickActions: number[] = [];
  readonly candidates: Array<{ action: number; candidate: Event }> = [];
  readonly targetInspections: Array<{ action: number; target: Event }> = [];
  lastObservation = "";
  actionCount = 0;

  constructor(readonly directory: string) {
    mkdirSync(directory, { recursive: true });
  }

  add(kind: string, data: Event = {}): void {
    appendFileSync(join(this.directory, "events.jsonl"), JSON.stringify({ at: new Date().toISOString(), kind, ...(safe(data) as Event) }) + "\n");
  }

  candidate(input: BetaBrowserMemberInput): Event | undefined {
    const target = "target" in input ? input.target : undefined;
    if (!target || typeof target !== "object" || !("type" in target)) return undefined;
    if (target.type === "coordinate") return { kind: "coordinate", replayReady: false, reason: "Viewport coordinates alone are not stable replay targets." };
    if (target.type !== "ref" || !("ref" in target)) return undefined;
    const line = this.lastObservation.split("\n").find((part) => part.includes(String(target.ref)));
    const roleAndName = line?.match(/\b(button|link|textbox|checkbox|radio|combobox)\s+"([^"]+)"/i);
    const role = roleAndName?.[1]?.toLowerCase();
    const name = roleAndName?.[2];
    const duplicateLabels = role && name
      ? this.lastObservation.split("\n").filter((part) => part.includes(`${role} "${name}"`)).length
      : undefined;
    return {
      kind: "accessibility_ref",
      ref: target.ref,
      observedLine: line?.trim() ?? null,
      playwrightCandidate: role && name ? { role, name, uniqueInObservation: duplicateLabels === 1 } : null,
      replayReady: false,
      reason: "The ref is session-scoped. Any role/name candidate still needs frame or row context and an independent replay check.",
    };
  }
}

const journals = new WeakMap<LoggedBrowser, Journal>();

function loggedInput(name: string, input: unknown): unknown {
  if (!input || typeof input !== "object") return input;
  if (["type", "form_input", "key", "javascript_exec"].includes(name)) {
    return { ...input, text: "[REDACTED]", value: "[REDACTED]", code: "[REDACTED]" };
  }
  return input;
}

class LoggedBrowser extends StagehandBrowser {
  protected override async execute(
    context: BetaToolsetCallContext,
    name: BetaBrowserMemberName,
    input: BetaBrowserMemberInput,
  ): Promise<BetaBrowserMemberResult> {
    const journal = journals.get(this);
    if (!journal) throw new Error("Missing browser journal");
    return executeLogged(journal, context, name, input, () => super.execute(context, name, input));
  }
}

async function executeLogged(
  journal: Journal,
  context: BetaToolsetCallContext,
  name: BetaBrowserMemberName,
  input: BetaBrowserMemberInput,
  run: () => Promise<BetaBrowserMemberResult>,
): Promise<BetaBrowserMemberResult> {
    const action = ++journal.actionCount;
    const candidate = journal.candidate(input);
    journal.add("before_execution", { action, toolUseId: context.toolUse?.id, name, input: loggedInput(name, input), candidate });
    if (action > 35) {
      journal.add("failure", { action, name, message: "Spike stopped at the 35-action limit." });
      throw new ToolError("Spike stopped at the 35-action limit.");
    }
    const started = Date.now();
    try {
      const result = await run();
      journal.actions.push(name);
      if (name === "left_click") journal.clickActions.push(action);
      if (typeof result === "string") {
        journal.lastObservation = result;
        journal.observations.push({ action, text: result });
        journal.add("observation", { action, name, text: result.slice(0, 20_000), truncated: result.length > 20_000 });
      } else if (result && typeof result === "object" && "data" in result && typeof result.data === "string") {
        const filename = `screenshot-${action}.png`;
        writeFileSync(join(journal.directory, filename), Buffer.from(result.data, "base64"));
        journal.add("observation", { action, name, screenshot: filename });
      } else {
        journal.add("outcome", { action, name, result, durationMs: Date.now() - started });
      }
      if (candidate) {
        journal.candidates.push({ action, candidate });
        journal.add("replay_target_candidate", { action, name, candidate });
      }
      return result;
    } catch (error) {
      journal.add("failure", { action, name, message: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started });
      throw error;
    }
}

function assess(name: ScenarioName, journal: Journal, finalText: string, completed: boolean): Event {
  const allObserved = journal.observations.map((item) => item.text).join("\n");
  const clicked = journal.actions.includes("left_click");
  if (name === "nested") {
    const words = ["LEFT", "MIDDLE", "RIGHT", "BOTTOM"];
    const observedWords = words.filter((word) => new RegExp(`\\b${word}\\b`, "i").test(allObserved));
    return { completed, observedWords, passed: completed && observedWords.length === words.length && words.every((word) => new RegExp(`\\b${word}\\b`, "i").test(finalText)) };
  }
  if (name === "challenging") {
    const rowObserved = allObserved.includes("Iuvaret4") && allObserved.includes("Phaedrum4");
    const clickedRowProven = journal.targetInspections.some(({ action, target }) => journal.clickActions.includes(action) && target.rowFirstCell === "Iuvaret4" && target.tag === "a" && target.label === "edit");
    return { completed, clicked, rowObserved, clickedRowProven, reportedValue: finalText.includes("Phaedrum4"), passed: completed && clicked && clickedRowProven && rowObserved && finalText.includes("Phaedrum4"), targetStillNeedsReplayValidation: true };
  }
  const firstClick = journal.clickActions[0];
  const resultObservedAfterClick = firstClick !== undefined && journal.observations.some((item) => item.action > firstClick && item.text.includes("Hello World!"));
  return { completed, clicked, resultObservedAfterClick, reportedValue: finalText.includes("Hello World!"), passed: completed && clicked && resultObservedAfterClick && finalText.includes("Hello World!") };
}

async function runScenario(name: ScenarioName, mode: BrowserMode, model: string, headless: boolean, directory: string): Promise<Event> {
  const journal = new Journal(join(directory, name));
  const task = scenarios[name];
  journal.add("run_start", { name, mode, model, url: task.url, goal: task.goal, intent: "live_anthropic_api" });
  let browser: LoggedBrowser | LocalPlaywrightBrowser | undefined;
  let finalText = "";
  let completed = false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180_000);
  try {
    if (mode === "local") {
      const local = await LocalPlaywrightBrowser.launch(headless);
      local.onExecute = async (context, name, input, run) => {
        if (name === "left_click" && "target" in input) {
          const target = await local.inspectTarget(input.target);
          if (target) {
            const action = journal.actionCount + 1;
            journal.targetInspections.push({ action, target });
            journal.add("pre_action_target", { action, target });
            if (typeof target.rowFirstCell === "string" && target.tag === "a" && typeof target.label === "string") {
              journal.add("row_scoped_replay_candidate", {
                action,
                candidate: { rowFirstCell: target.rowFirstCell, role: "link", name: target.label, replayReady: false },
                reason: "Derived from the DOM before the click; requires a fresh-session replay check.",
              });
            }
          }
        }
        return executeLogged(journal, context, name, input, run);
      };
      browser = local;
    } else {
      browser = await LoggedBrowser.browserbase({ apiKey: process.env.BROWSERBASE_API_KEY!, allowedDomains: [host] });
      journals.set(browser, journal);
    }
    const runner = new Anthropic().beta.messages.toolRunner({
      model,
      max_tokens: 2_048,
      max_iterations: 18,
      tools: [browser],
      messages: [{ role: "user", content: `${task.goal}\nStart at ${task.url}. Use only this site's browser tools. If the page cannot be inspected, explain what failed rather than guessing.` }],
    }, { signal: controller.signal });
    for await (const message of runner) {
      const text = message.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
      journal.add("model_response", { stopReason: message.stop_reason, text: text.slice(0, 10_000), toolCalls: message.content.filter((block) => block.type === "tool_use").map((block) => ({ id: block.id, name: block.name, input: loggedInput(block.name, block.input) })), usage: message.usage });
      if (text) finalText = text;
      if (message.stop_reason === "end_turn") completed = true;
    }
    const assessment = assess(name, journal, finalText, completed);
    const summary = { name, mode, model, assessment, finalText, actionCount: journal.actionCount };
    writeFileSync(join(journal.directory, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
    journal.add("run_end", summary);
    return summary;
  } catch (error) {
    const summary = { name, mode, model, assessment: { passed: false, completed: false }, error: error instanceof Error ? error.message : String(error), actionCount: journal.actionCount };
    writeFileSync(join(journal.directory, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
    journal.add("run_failure", summary);
    return summary;
  } finally {
    clearTimeout(timeout);
    if (browser) await browser.close();
  }
}

async function main(): Promise<void> {
  const { scenarios: selected, mode, model, headless } = options();
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is required for a genuine LLM-driven run.");
  if (mode === "browserbase" && !process.env.BROWSERBASE_API_KEY) throw new Error("BROWSERBASE_API_KEY is required for a hosted Browserbase session.");
  if (mode === "local" && !existsSync(chromium.executablePath())) throw new Error("Playwright Chromium is missing. Run: npx.cmd playwright install chromium");
  const directory = join("evidence", "browser-use-spike", new Date().toISOString().replace(/[:.]/g, "-"));
  const results: Event[] = [];
  for (const name of selected) results.push(await runScenario(name, mode, model, headless, directory));
  console.log(JSON.stringify({ directory, results }, null, 2));
  if (results.some((result) => !(result.assessment as { passed: boolean }).passed)) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
