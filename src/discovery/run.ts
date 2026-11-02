import Anthropic from "@anthropic-ai/sdk";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { LocalPlaywrightBrowser } from "./local-browser.js";
import { Journal, executeLogged, loggedInput, type Event } from "./recorder.js";
import { captureSnapshot, type CompilationRequest, type DiscoveryEvidence, type Snapshot } from "../capability/evidence.js";
import { type Policy } from "../surfaces/playwright.js";

export interface DiscoveryTask {
  name: string;
  url: string;
  goal: string;
  model: string;
  headless: boolean;
  directory: string;
  assess?: (journal: Journal, finalText: string, completed: boolean) => Event;
  compilationRequest?: CompilationRequest;
  policy?: Policy;
}

export async function runDiscovery(task: DiscoveryTask): Promise<Event> {
  const journal = new Journal(task.directory);
  journal.add("run_start", { name: task.name, mode: "local", model: task.model, url: task.url, goal: task.goal, intent: "live_anthropic_api" });
  let browser: LocalPlaywrightBrowser | undefined;
  let finalText = "";
  let completed = false;
  let toolFailures = 0;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180_000);
  const evidence: DiscoveryEvidence | undefined = task.compilationRequest ? { evidenceVersion: "2.0", request: task.compilationRequest, completed: false, actions: [] } : undefined;
  const saveEvidence = () => { if (evidence) writeFileSync(join(task.directory, "discovery-v2.json"), JSON.stringify(evidence, null, 2) + "\n"); };
  try {
    browser = await LocalPlaywrightBrowser.launch(task.headless, task.policy);
    const active = browser;
    active.onExecute = async (context, name, input, run) => {
      let before: Snapshot | undefined;
      try {
        before = evidence ? await captureSnapshot(active.page) : undefined;
        let target: Record<string, unknown> | null = null;
        if ((name === "left_click" || name === "form_input") && "target" in input) {
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
        if (evidence && before) {
          const recordedInput: Record<string, unknown> = { ...input };
          if (name === "form_input" && "value" in input) {
            const binding = Object.entries(evidence.request.bindings).filter(([, value]) => String(value) === input.value);
            recordedInput.value = binding.length === 1 ? { input: binding[0]![0] } : "[UNBOUND]";
          }
          evidence.actions.push({ index: journal.actionCount, name, before, after: await captureSnapshot(active.page), target: typeof target?.node === "string" && typeof target.frame === "number" ? { node: target.node, frame: target.frame } : null, input: recordedInput, ...(typeof result === "string" ? { observation: result } : {}), success: true });
          saveEvidence();
        }
        return result;
      } catch (error) {
        toolFailures++;
        if (evidence && before) {
          let after = before;
          try { after = await captureSnapshot(active.page); } catch { /* Failed navigation may destroy the execution context. */ }
          evidence.actions.push({ index: Math.max(journal.actionCount, (evidence.actions.at(-1)?.index ?? 0) + 1), name, before, after, target: null, input: {}, success: false });
          saveEvidence();
        }
        throw error;
      }
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
    const assessment = task.assess ? task.assess(journal, finalText, completed) : { completed, goalVerified: false };
    if (evidence) { evidence.completed = completed && toolFailures === 0; saveEvidence(); }
    const summary = { name: task.name, mode: "local", model: task.model, assessment, toolFailures, finalText, actionCount: journal.actionCount };
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
