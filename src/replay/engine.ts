import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CapabilityError, validateCapability, validateInputs, valueOf, type Capability, type Condition, type Inputs } from "../capability/contract.js";
import type { SurfaceAdapter } from "../surfaces/adapter.js";
import { PlaywrightAdapter, testPolicy, type Policy } from "../surfaces/playwright.js";

export async function checkCondition(adapter: SurfaceAdapter, capability: Capability, condition: Condition, inputs: Inputs): Promise<boolean> {
  if (condition.kind === "urlHash") return new URL(adapter.url()).hash === condition.value;
  const target = capability.targets[condition.target]!;
  if (condition.kind === "visible") return adapter.visible(target);
  return await adapter.visible(target) && await adapter.extract(target) === valueOf(condition.value, inputs);
}
export async function waitForCondition(adapter: SurfaceAdapter, capability: Capability, condition: Condition, inputs: Inputs, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  do {
    try { if (await checkCondition(adapter, capability, condition, inputs)) return; }
    catch (error) { if (!(error instanceof CapabilityError) || error.code !== "TARGET_NOT_FOUND") throw error; }
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (Date.now() < deadline);
  throw new CapabilityError("WAIT_TIMEOUT", "Expected condition was not observed before timeout", { expected: condition });
}
export interface ReplayResult { status: "success" | "failure"; sessionId: string; outputs?: Record<string, string>; stepId?: string; code?: string; message?: string; details?: Record<string, unknown> }
export async function replayCapability(artifactPath: string, inputs: Inputs, directory: string, policy: Policy = testPolicy, createAdapter: (inputs: Inputs, policy: Policy) => Promise<SurfaceAdapter> = PlaywrightAdapter.launch): Promise<ReplayResult> {
  mkdirSync(directory, { recursive: true });
  const sessionId = crypto.randomUUID();
  const events = join(directory, "events.jsonl");
  const log = (kind: string, fields: Record<string, unknown>) => appendFileSync(events, JSON.stringify({ at: new Date().toISOString(), kind, ...fields }) + "\n");
  let adapter: SurfaceAdapter | undefined;
  let stepId = "validation";
  let result: ReplayResult;
  try {
    const capability = validateCapability(JSON.parse(readFileSync(artifactPath, "utf8")));
    validateInputs(capability, inputs);
    for (const step of capability.steps) if (!policy.actions.includes(step.action)) throw new CapabilityError("POLICY_DENIED", `Action ${step.action} is not allowed`);
    log("replay_start", { sessionId, capabilityId: capability.id, llmCalls: 0 });
    adapter = await createAdapter(inputs, policy);
    const saved: Record<string, string> = {};
    for (const step of capability.steps) {
      stepId = step.id;
      log("step_start", { stepId, action: step.action });
      if (step.action === "navigate") await adapter.navigate(step.url);
      else if (step.action === "click") await adapter.click(capability.targets[step.target]!);
      else if (step.action === "fill") await adapter.fill(capability.targets[step.target]!, valueOf(step.value, inputs));
      else if (step.action === "selectOption") await adapter.selectOption(capability.targets[step.target]!, step.by, valueOf(step.value, inputs));
      else if (step.action === "extract") saved[step.saveAs] = await adapter.extract(capability.targets[step.target]!);
      else if (step.action === "wait") await waitForCondition(adapter, capability, step.condition, inputs, step.timeoutMs);
      else if (!await checkCondition(adapter, capability, step.condition, inputs)) throw new CapabilityError("ASSERTION_FAILED", "Expected state was not observed", { expected: step.condition });
      log("step_end", { stepId });
    }
    stepId = "checkpoints";
    for (const checkpoint of capability.checkpoints) await waitForCondition(adapter, capability, checkpoint, inputs, 5000);
    // Read URL only after checkpoint waits; a hash change may follow the click asynchronously.
    const outputs = Object.fromEntries(Object.entries(capability.outputs).map(([name, output]) => [name, "page" in output.source ? adapter!.url() : saved[output.source.savedValue]! ]));
    result = { status: "success", sessionId, outputs };
  } catch (error) {
    result = { status: "failure", sessionId, stepId, code: error instanceof CapabilityError ? error.code : "EXECUTION_FAILED", message: error instanceof Error ? error.message : String(error), ...(error instanceof CapabilityError ? { details: error.details } : {}) };
    // Screenshot capture is restricted to the public/synthetic test surface of this slice.
    if (adapter) {
      try { await adapter.captureFailure(join(directory, "failure.png")); log("failure_evidence", { screenshot: "failure.png" }); } catch { /* Preserve original error. */ }
    }
  } finally { await adapter?.close(); }
  writeFileSync(join(directory, "result.json"), JSON.stringify(result, null, 2) + "\n");
  log("replay_end", { ...result });
  return result;
}
