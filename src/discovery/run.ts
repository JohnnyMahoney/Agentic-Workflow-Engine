import Anthropic from "@anthropic-ai/sdk";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { LocalPlaywrightBrowser } from "./local-browser.js";
import { Journal, executeLogged, loggedInput, type Event } from "./recorder.js";

export interface DiscoveryTask {
  name: string;
  url: string;
  goal: string;
  model: string;
  headless: boolean;
  directory: string;
  assess?: (journal: Journal, finalText: string, completed: boolean) => Event;
}

export async function runDiscovery(task: DiscoveryTask): Promise<Event> {
  const journal = new Journal(task.directory);
  journal.add("run_start", { name: task.name, mode: "local", model: task.model, url: task.url, goal: task.goal, intent: "live_anthropic_api" });
  let browser: LocalPlaywrightBrowser | undefined;
  let finalText = "";
  let completed = false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180_000);
  try {
    browser = await LocalPlaywrightBrowser.launch(task.headless);
    const active = browser;
    active.onExecute = async (context, name, input, run) => {
      let target: Record<string, unknown> | null = null;
      if (name === "left_click" && "target" in input) {
        target = await active.inspectTarget(input.target);
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
      const result = await executeLogged(journal, context, name, input, run);
      if (name === "left_click") {
        if (typeof target?.href === "string" && target.href.startsWith("#")) await active.waitForUrlHash();
        journal.add("post_action_state", { action: journal.actionCount, url: active.currentUrl() });
      }
      return result;
    };
    const runner = new Anthropic().beta.messages.toolRunner({
      model: task.model,
      max_tokens: 2_048,
      max_iterations: 18,
      tools: [active],
      messages: [{ role: "user", content: `${task.goal}\nStart at ${task.url}. Use only this site's browser tools. If the page cannot be inspected, explain what failed rather than guessing.` }],
    }, { signal: controller.signal });
    for await (const message of runner) {
      const text = message.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
      journal.add("model_response", { stopReason: message.stop_reason, text: text.slice(0, 10_000), toolCalls: message.content.filter((block) => block.type === "tool_use").map((block) => ({ id: block.id, name: block.name, input: loggedInput(block.name, block.input) })), usage: message.usage });
      if (text) finalText = text;
      if (message.stop_reason === "end_turn") completed = true;
    }
    const assessment = task.assess ? task.assess(journal, finalText, completed) : { completed, passed: completed };
    const summary = { name: task.name, mode: "local", model: task.model, assessment, finalText, actionCount: journal.actionCount };
    writeFileSync(join(task.directory, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
    journal.add("run_end", summary);
    return summary;
  } catch (error) {
    const summary = { name: task.name, mode: "local", model: task.model, assessment: { passed: false, completed: false }, error: error instanceof Error ? error.message : String(error), actionCount: journal.actionCount };
    writeFileSync(join(task.directory, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
    journal.add("run_failure", summary);
    return summary;
  } finally {
    clearTimeout(timeout);
    if (browser) await browser.close();
  }
}
