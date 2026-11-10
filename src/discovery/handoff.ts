import { z } from "zod";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { join } from "node:path";
import { CapabilityError } from "../capability/contract.js";
import { captureSnapshot, type DiscoveryEvidence, type DiscoveryIntervention } from "../capability/evidence.js";
import { checkUrl, testPolicy, type Policy } from "../surfaces/playwright.js";
import { requestIntervention, type HandoffOptions } from "../replay/handoff.js";
import { ActiveDiscoveryBudget, DiscoveryQueue } from "./execution-control.js";
import type { LocalPlaywrightBrowser } from "./local-browser.js";
import type { Journal } from "./recorder.js";

export const humanRequestSchema = z.object({
  reason: z.enum(["AUTH_REQUIRED", "UNKNOWN_BLOCKER", "ACTION_STUCK", "RISK_APPROVAL", "OTHER"]),
  description: z.string().min(1).max(2000),
  attemptedRecovery: z.string().max(2000).optional(),
}).strict();
export type HumanRequest = z.infer<typeof humanRequestSchema>;

export class DiscoveryHandoff {
  readonly queue = new DiscoveryQueue();
  needsFreshRead = false;
  count = 0;
  constructor(private readonly config: {
    browser: LocalPlaywrightBrowser; options: HandoffOptions; journal: Journal;
    evidence?: DiscoveryEvidence; save: () => void; budget: ActiveDiscoveryBudget;
    abort: AbortController; goal: string; sessionId: string; policy?: Policy;
  }) {}

  tool() {
    return betaZodTool({
      name: "request_human", inputSchema: humanRequestSchema,
      description: "Pause Discovery and transfer the same browser to a human when safe recovery is insufficient or authorization is needed. No browser business action is executed by this tool. Resume requires fresh browser observation. Policy cannot be overridden.",
      run: request => this.queue.run(() => this.request(request, "model")),
    });
  }

  async request(raw: HumanRequest, source: "model" | "driver"): Promise<string> {
    const c = this.config;
    if (c.abort.signal.aborted) throw new CapabilityError("DISCOVERY_STOPPED", "Discovery has stopped");
    if (++this.count > 3) { c.abort.abort(); throw new CapabilityError("HANDOFF_LIMIT", "Discovery reached the three-intervention limit"); }
    const request = humanRequestSchema.parse(raw);
    const id = `discovery-${this.count}`;
    const previous = c.evidence?.actions.at(-1);
    const precedingAction = previous ? {index: previous.index, name: previous.name, success: previous.success,
      dispatch: previous.success ? "completed" : previous.failure?.phase ?? "unknown"} : null;
    const entry: DiscoveryIntervention = {id, source, reason: request.reason, description: request.description,
      afterAction: c.journal.actionCount, outcome: "pending", before: await captureSnapshot(c.browser.page), humanActions: []};
    if (c.evidence) (c.evidence.interventions ??= []).push(entry);
    c.save();
    c.journal.add("discovery_intervention", {id, source, ...request, afterAction: entry.afterAction, originalAction: c.evidence?.actions.at(-1) ? {index: c.evidence.actions.at(-1)!.index, name: c.evidence.actions.at(-1)!.name, success: c.evidence.actions.at(-1)!.success, failure: c.evidence.actions.at(-1)!.failure} : null, browserActionExecutedByThisTool: false});
    c.budget.pause();
    try {
      await requestIntervention(c.options, c.browser.handoffSurface(), {
        phase: "Discovery", currentUrl: c.browser.page.url(), sessionId: c.sessionId,
        capabilityId: c.evidence?.request.id ?? "discovery", description: `${c.goal}\n${request.description}\nPreceding action: ${JSON.stringify(precedingAction)}`,
        stepId: id, reason: request.reason, completedSteps: [], pendingMutations: [], savedOutputNames: [],
        expected: {action: "human-intervention", browserActionExecutedByThisTool: false, precedingAction}, evidenceRef: join(c.journal.directory, "events.jsonl"),
      }, c.journal.directory, (kind, fields) => {
        c.journal.add(kind, fields);
        if (kind === "human_action") { entry.humanActions.push(fields); c.save(); }
      });
      checkUrl(c.browser.page.url(), c.policy ?? testPolicy);
      const observation = await c.browser.refreshAfterHuman();
      entry.after = await captureSnapshot(c.browser.page);
      entry.outcome = "resumed";
      this.queue.generation++;
      this.needsFreshRead = true;
      c.journal.add("discovery_handoff_resumed", {id, observation, browserActionExecutedByThisTool: false, requiresFreshRead: true});
      await c.browser.handoffSurface().setHumanInputEnabled(true);
      return JSON.stringify({status: "operator_resumed", browserActionExecutedByThisTool: false, precedingAction,
        message: "The operator returned control, not proof of success. Read the page again and reacquire references before acting. Policy remains unchanged; reassess any blocker.", observation});
    } catch (error) {
      entry.outcome = error instanceof CapabilityError && error.code === "HANDOFF_ABORTED" ? "aborted" : "unresolved";
      try { entry.after = await captureSnapshot(c.browser.page); } catch { /* Closed session. */ }
      c.journal.add("discovery_handoff_stopped", {id, outcome: entry.outcome});
      c.abort.abort(); // SDK tools return errors to Claude; the signal also stops further turns/actions.
      throw error;
    } finally {
      c.save();
      c.budget.resume();
    }
  }
}
