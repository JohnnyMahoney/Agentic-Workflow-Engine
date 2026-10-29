import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ToolError, type BetaBrowserMemberResult, type BetaToolsetCallContext } from "@anthropic-ai/sdk/helpers/beta/toolsets";
import type { BetaBrowserMemberInput, BetaBrowserMemberName } from "@anthropic-ai/sdk/resources/beta";

export type Event = Record<string, unknown>;

function safe(value: unknown, key = ""): unknown {
  if (/api.?key|authorization|cookie|password|token|secret/i.test(key)) return "[REDACTED]";
  if (key === "text" && typeof value === "string" && value.length > 20_000) return `${value.slice(0, 20_000)}...[truncated]`;
  if (Array.isArray(value)) return value.map((item) => safe(item));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, safe(item, name)]));
  return value;
}

export function loggedInput(name: string, input: unknown): unknown {
  if (!input || typeof input !== "object") return input;
  if (["type", "form_input", "key", "javascript_exec"].includes(name)) {
    return { ...input, text: "[REDACTED]", value: "[REDACTED]", code: "[REDACTED]" };
  }
  return input;
}

export class Journal {
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
    const duplicateLabels = role && name ? this.lastObservation.split("\n").filter((part) => part.includes(`${role} "${name}"`)).length : undefined;
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

export async function executeLogged(
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
    journal.add("failure", { action, name, message: "Discovery stopped at the 35-action limit." });
    throw new ToolError("Discovery stopped at the 35-action limit.");
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
