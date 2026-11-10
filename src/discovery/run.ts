import { withSafety, sanitize, learnPageSecrets } from "../safety/persistence.js";
import { writeFileSync } from "../safety/persistence.js";
import { ToolError } from "@anthropic-ai/sdk/helpers/beta/toolsets";
import { ActiveDiscoveryBudget } from "./execution-control.js";
import { DiscoveryHandoff } from "./handoff.js";
import type { HandoffOptions } from "../replay/handoff.js";
import Anthropic from "@anthropic-ai/sdk";
import { join } from "node:path";
import { LocalPlaywrightBrowser } from "./local-browser.js";
import { Journal, executeLogged, loggedInput, type Event } from "./recorder.js";
import { captureSnapshot, type CompilationRequest, type DiscoveryEvidence, type Snapshot } from "../capability/evidence.js";
import { BeforeDispatchError } from "./failures.js";
import { testPolicy, type Policy } from "../surfaces/playwright.js";

export interface DiscoveryTask {
  name: string;
  url: string;
  goal: string;
  model: string;
  headless: boolean;
  handoff?: HandoffOptions;
  client?: Anthropic;
  createBrowser?: typeof LocalPlaywrightBrowser.launch;
  directory: string;
  assess?: (journal: Journal, finalText: string, completed: boolean) => Event;
  compilationRequest?: CompilationRequest;
  policy?: Policy;
}

export async function runDiscovery(task: DiscoveryTask): Promise<Event> {
  return withSafety(task.policy ?? testPolicy, task.compilationRequest?.bindings ?? {}, async () => sanitize(await runDiscoveryInternal(task)));
}
async function runDiscoveryInternal(task: DiscoveryTask): Promise<Event> {
  const journal = new Journal(task.directory);
  journal.add("run_start", { name: task.name, mode: "local", model: task.model, url: task.url, goal: task.goal, intent: task.client ? "injected_client_test" : "live_anthropic_api" });
  let browser: LocalPlaywrightBrowser | undefined;
  let finalText = "";
  let completed = false;
  let toolFailures = 0;
  const controller = new AbortController();
  const budget = new ActiveDiscoveryBudget(controller);
  const evidence: DiscoveryEvidence | undefined = task.compilationRequest ? { evidenceVersion: "2.0", request: task.compilationRequest, completed: false, actions: [] } : undefined;
  const saveEvidence = () => { if (evidence) writeFileSync(join(task.directory, "discovery-v2.json"), JSON.stringify(evidence, null, 2) + "\n"); };
  try {
    browser = await (task.createBrowser ?? LocalPlaywrightBrowser.launch)(task.headless, task.policy);
    const active = browser;
    const callGenerations = new Map<string, number>();
    const human = task.handoff ? new DiscoveryHandoff({browser: active, options: task.handoff, journal, ...(evidence ? {evidence} : {}), save: saveEvidence, budget, abort: controller, goal: task.goal, sessionId: crypto.randomUUID(), ...(task.policy ? {policy: task.policy} : {})}) : undefined;
    let repeatedFailures = 0;
    let unchangedReads = 0;
    let lastRead = "";
    let fallbackNeeded = false;
    const recordAction: NonNullable<LocalPlaywrightBrowser["onExecute"]> = async (context, name, input, run) => {
      let before: Snapshot | undefined;
      try {
        await learnPageSecrets(active.page);
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
        repeatedFailures = 0;
        if (["read_page", "get_page_text"].includes(name) && typeof result === "string") {
          const normalized = result.replace(/ref_\d+/g, "ref");
          unchangedReads = normalized === lastRead ? unchangedReads + 1 : 0;
          lastRead = normalized;
          if (unchangedReads >= 4) fallbackNeeded = true;
        } else if (["navigate", "left_click", "form_input"].includes(name)) { unchangedReads = 0; lastRead = ""; }
        return result;
      } catch (error) {
        toolFailures++;
        if (++repeatedFailures >= 2) fallbackNeeded = true;
        if (evidence && before) {
          let after = before;
          try { after = await captureSnapshot(active.page); } catch { /* Failed navigation may destroy the execution context. */ }
          evidence.actions.push({ index: Math.max(journal.actionCount, (evidence.actions.at(-1)?.index ?? 0) + 1), name, before, after, target: null, input: "target" in input ? {target: input.target} : {}, success: false, failure: error instanceof BeforeDispatchError ? {phase: error.phase, code: error.code} : {phase: "unknown", code: "TOOL_EXECUTION_FAILED"} });
          saveEvidence();
        }
        throw error;
      }
    };
    active.onExecute = (context, name, input, run) => {
      const generation = callGenerations.get(context.toolUse?.id ?? "") ?? human?.queue.generation;
      const execute = async () => {
        if (controller.signal.aborted) throw new ToolError("Discovery stopped; action not executed");
        if (journal.actionCount >= 35) { controller.abort(); throw new ToolError("Discovery action limit; action not executed"); }
        if ((name === "left_click" || name === "form_input") && "target" in input && await active.isHumanOnlyTarget(input.target)) {
          journal.add("browser_action_not_executed", {name, reason: "Trusted policy reserves this blocker for a human", phase: "beforeDispatch"});
          throw new ToolError("Action NOT EXECUTED. This control is reserved for a human by trusted policy; request_human is required. Approval does not allow automation to operate it.");
        }
        if (human && fallbackNeeded) {
          fallbackNeeded = false; repeatedFailures = 0; unchangedReads = 0;
          await human.request({reason: "ACTION_STUCK", description: "Driver detected repeated tool failures or repeated unchanged textual observations."}, "driver");
        }
        if (human && (generation !== human.queue.generation || (human.needsFreshRead && !["read_page", "get_page_text", "screenshot"].includes(name)))) {
          journal.add("browser_action_not_executed", {name, reason: "Human intervention invalidated observations; read_page is required"});
          throw new ToolError("Action NOT EXECUTED. Human intervention invalidated references. Call read_page again before acting.");
        }
        const result = await recordAction(context, name, input, run);
        if (human && name === "read_page") human.needsFreshRead = false;
        return result;
      };
      return human ? human.queue.run(execute) : execute();
    };
    const runner = (task.client ?? new Anthropic()).beta.messages.toolRunner({
      model: task.model,
      max_tokens: 2_048,
      max_iterations: 18,
      tools: human ? [active, human.tool()] : [active],
      ...(human ? {tool_choice: {type: "auto" as const, disable_parallel_tool_use: true}} : {}),
      messages: [{ role: "user", content: `${task.goal}\nStart at ${task.url}. Use only this site's browser tools. If the page cannot be inspected, explain what failed rather than guessing.${human ? " Handle routine dialogs autonomously. Attempt only bounded safe recovery. Call request_human when blocked, authentication needs a person, or a risky operation lacks authorization. Never execute an unauthorized risky action. Human approval cannot override policy. After handoff, read_page again, reacquire references and reassess; operator resume is not proof of success. Do not claim a failed or unexecuted action succeeded." : ""}` }],
    }, { signal: controller.signal });
    for await (const message of runner) {
      for (const block of message.content) if (block.type === "tool_use") callGenerations.set(block.id, human?.queue.generation ?? 0);
      const text = message.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
      journal.add("model_response", { stopReason: message.stop_reason, text: text.slice(0, 10_000), toolCalls: message.content.filter((block) => block.type === "tool_use").map((block) => ({ id: block.id, name: block.name, input: loggedInput(block.name, block.input) })), usage: message.usage });
      if (text) finalText = text;
      if (message.stop_reason === "end_turn") completed = true;
    }
    const assessment = task.assess ? task.assess(journal, finalText, completed) : { completed, goalVerified: false };
    if (evidence) { evidence.modelCompleted = completed; evidence.completed = completed && toolFailures === 0; saveEvidence(); }
    const summary = { name: task.name, mode: "local", model: task.model, assessment, toolFailures, finalText, actionCount: journal.actionCount };
    writeFileSync(join(task.directory, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
    journal.add("run_end", summary);
    return summary;
  } catch (error) {
    if (evidence) { evidence.completed = false; evidence.modelCompleted = false; saveEvidence(); }
    const summary = { name: task.name, mode: "local", model: task.model, assessment: { passed: false, completed: false }, error: error instanceof Error ? error.message : String(error), actionCount: journal.actionCount };
    writeFileSync(join(task.directory, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
    journal.add("run_failure", summary);
    return summary;
  } finally {
    budget.close();
    if (browser) await browser.close();
  }
}
