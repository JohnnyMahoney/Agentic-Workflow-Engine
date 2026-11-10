import { writeFileSync, sanitizeText } from "../safety/persistence.js";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { CapabilityError, type Capability } from "../capability/contract.js";
import type { SurfaceAdapter } from "../surfaces/adapter.js";

export type HandoffCommand = "take-control" | "resume" | "abort";
export interface InterventionRequest {
  phase?: "Discovery" | "Replay";
  currentUrl?: string;
  sessionId: string; capabilityId: string; description: string; stepId: string; reason: string;
  completedSteps: string[]; pendingMutations: string[]; savedOutputNames: string[];
  expected: unknown; evidenceRef: string;
}
export interface HandoffController {
  open(request: InterventionRequest): void;
  nextCommand(): Promise<string>;
  close(): void;
  notify?(message: string): void;
}
export interface HandoffOptions { controller: HandoffController; timeoutMs?: number }

// Input is accepted only while an intervention is active; no commands queue up
// during automation and accidentally resume a future intervention.
export function cliHandoffController(): HandoffController {
  let reader: ReturnType<typeof createInterface> | undefined;
  let resolve: ((command: string) => void) | undefined;
  let ended = false;
  return {
    open(request) {
      ended = false;
      console.log(sanitizeText(`\n${request.description}\n${request.phase ?? "Replay"} paused at ${request.stepId}: ${request.reason}\n${request.currentUrl ? `URL: ${request.currentUrl}\n` : ""}Evidence: ${request.evidenceRef}\nDiagnostic: handoff-${request.stepId}-before.png.json (sanitized DOM; raw screenshot omitted)\nCommands: take-control, resume, abort. Resume requires take-control first.`));
      reader = createInterface({ input: process.stdin, output: process.stdout });
      reader.on("line", line => { const done = resolve; resolve = undefined; done?.(line.trim()); });
      reader.on("close", () => { ended = true; resolve?.("abort"); resolve = undefined; });
      reader.on("SIGINT", () => { ended = true; resolve?.("abort"); resolve = undefined; });
    },
    nextCommand() { return ended ? Promise.resolve("abort") : new Promise(done => { resolve = done; }); },
    close() { reader?.close(); reader = undefined; resolve = undefined; },
    notify(message) { console.log(message); },
  };
}

export function eligibleForHandoff(error: unknown): boolean {
  const code = error instanceof CapabilityError ? error.code : error instanceof Error && error.name === "TimeoutError" ? "TIMEOUT" : "";
  return ["TARGET_NOT_FOUND", "AMBIGUOUS_TARGET", "CONFLICTING_TARGETS", "WAIT_TIMEOUT", "TIMEOUT", "OUTPUT_VALIDATION_TIMEOUT", "ASSERTION_FAILED", "SLOW_LOADING", "SESSION_EXPIRED", "UNEXPECTED_DIALOG"].includes(code);
}

// Only existing conditions with an unbroken association to the failed step are
// eligible. Global checkpoints are not invented as postconditions for a click.
export function recoveryConditions(capability: Capability, index: number, pending: ReadonlySet<string>) {
  const step = capability.steps[index]!;
  if (step.action !== "wait" && step.action !== "assert" && !("effect" in step && step.effect === "stateChanging")) return [];
  let start = index;
  if (step.action === "wait" || step.action === "assert") {
    while (start > 0 && ["wait", "assert"].includes(capability.steps[start - 1]!.action)) start--;
  }
  const conditions: Extract<Capability["steps"][number], {action: "wait" | "assert"}>[] = [];
  for (let i = step.action === "wait" || step.action === "assert" ? start : index + 1; i < capability.steps.length; i++) {
    const item = capability.steps[i]!;
    if (item.action !== "wait" && item.action !== "assert") break;
    conditions.push(item);
  }
  if ("effect" in step && step.effect === "stateChanging" && !conditions.some(item => item.confirms === step.id)) return [];
  if ([...pending].some(id => !conditions.some(item => item.confirms === id))) return [];
  return conditions;
}

export async function requestIntervention(options: HandoffOptions, adapter: SurfaceAdapter, request: InterventionRequest, directory: string, log: (kind: string, fields: Record<string, unknown>) => void): Promise<void> {
  const prefix = `handoff-${request.stepId}`;
  const snapshot = async (phase: string) => {
    try { adapter.setOperationTimeout?.(5000); await adapter.captureFailure(join(directory, `${prefix}-${phase}.png`)); log("handoff_evidence", {stepId: request.stepId, phase, screenshot: `${prefix}-${phase}.png`}); }
    catch (error) {
      if (error instanceof CapabilityError && error.code === "UNSAFE_IMAGE_OMITTED") log("handoff_evidence", {stepId: request.stepId, phase, screenshotOmitted: true, diagnostic: error.details.diagnostic});
      else log("handoff_evidence_unavailable", {stepId: request.stepId, phase});
    }
  };
  writeFileSync(join(directory, `${prefix}-request.json`), JSON.stringify(request, null, 2) + "\n");
  await adapter.setHumanInputEnabled?.(false);
  log("handoff_requested", { ...request, owner: "paused" });
  await snapshot("before");
  let stopObservation: (() => Promise<void>) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closedPoll: ReturnType<typeof setInterval> | undefined;
  const timeoutMs = options.timeoutMs ?? 300_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 3_600_000) throw new CapabilityError("INVALID_HANDOFF_CONFIG", "Handoff timeout must be 1..3600000 ms");
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new CapabilityError("HANDOFF_UNRESOLVED", "Operator deadline expired")), timeoutMs);
    closedPoll = setInterval(() => { if (adapter.isClosed?.()) reject(new CapabilityError("HANDOFF_UNRESOLVED", "Browser session was closed")); }, 250);
  });
  let human = false;
  try {
    options.controller.open(request);
    while (true) {
      const command = await Promise.race([options.controller.nextCommand(), deadline]);
      if (command === "abort") throw new CapabilityError("HANDOFF_ABORTED", "Operator aborted replay");
      if (command === "take-control" && !human) {
        if (!adapter.observeHuman) throw new CapabilityError("HANDOFF_UNRESOLVED", "Surface cannot record human intervention");
        stopObservation = await adapter.observeHuman(event => log("human_action", {stepId: request.stepId, ...event}));
        await adapter.setHumanInputEnabled?.(true);
        human = true;
        log("handoff_control", {stepId: request.stepId, owner: "human"});
        options.controller.notify?.("Human control active. Work in the same browser, then type resume or abort.");
      } else if (command === "resume" && human) {
        await adapter.setHumanInputEnabled?.(false);
        await stopObservation?.(); stopObservation = undefined;
        log("handoff_control", {stepId: request.stepId, owner: "verifying"});
        options.controller.notify?.("Verifying current UI state. Stop interacting with the browser.");
        return;
      } else {
        log("handoff_command_rejected", {stepId: request.stepId, reason: "Expected take-control, then resume; or abort"});
        options.controller.notify?.("Command rejected: use take-control before resume, or abort.");
      }
    }
  } catch (error) {
    log("handoff_stopped", {stepId: request.stepId, code: error instanceof CapabilityError ? error.code : "HANDOFF_UNRESOLVED"});
    throw error instanceof CapabilityError ? error : new CapabilityError("HANDOFF_UNRESOLVED", "Intervention controller failed");
  } finally {
    if (timer) clearTimeout(timer);
    if (closedPoll) clearInterval(closedPoll);
    options.controller.close();
    await stopObservation?.();
    await snapshot("after");
  }
}
