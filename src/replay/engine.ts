import { withSafety, sanitize } from "../safety/persistence.js";
import { appendFileSync, writeFileSync } from "../safety/persistence.js";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CapabilityError, validateCapability, validateInputs, valueOf, outputMatches, type Capability, type Condition, type Inputs, type Target, type ExtractProperty } from "../capability/contract.js";
import type { SurfaceAdapter } from "../surfaces/adapter.js";
import { PlaywrightAdapter, checkUrl, policySchema, testPolicy, type Policy } from "../surfaces/playwright.js";

import { eligibleForHandoff, recoveryConditions, requestIntervention, type HandoffOptions } from "./handoff.js";

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
async function extractReady(adapter: SurfaceAdapter, target: Target, outputs: [string, Capability["outputs"][string]][], inputs: Inputs, probe: () => Promise<boolean>, record: (fields: Record<string, unknown>) => void, property: ExtractProperty = "text"): Promise<string> {
  const started = Date.now();
  let observed: unknown;
  while (true) {
    const remaining = Math.min(...outputs.map(([,output]) => output.validation!.timeoutMs)) - (Date.now() - started);
    adapter.setOperationTimeout?.(Math.max(1, Math.min(1000, remaining)));
    const blocked = await probe();
    let text: string | undefined;
    try { if (await adapter.visible(target)) text = await adapter.extract(target, property); observed = {visible: text !== undefined, text}; }
    catch (error) {
      if (error instanceof CapabilityError && error.code === "TARGET_NOT_FOUND") observed = {code: error.code};
      else if (error instanceof Error && error.name === "TimeoutError") observed ??= {code: "TIMEOUT"};
      else throw error;
    }
    let ready = !blocked && text !== undefined;
    for (const [name, output] of outputs) {
      const validation = output.validation!;
      const matches = !blocked && text !== undefined && outputMatches(validation.condition, text, inputs);
      const elapsedMs = Date.now() - started;
      record({output: name, expected: validation.condition, observed, matches, elapsedMs});
      if (!matches && elapsedMs >= validation.timeoutMs) throw new CapabilityError("OUTPUT_VALIDATION_TIMEOUT", "Extracted output did not satisfy its declared readiness condition", {output: name, expected: validation.condition, observed, timeoutMs: validation.timeoutMs});
      ready = ready && matches;
    }
    // Save this exact validated sample; never re-read after checking readiness.
    if (ready) return text!;
    await sleep(Math.max(1, Math.min(50, remaining)));
  }
}
export async function observeCondition(adapter: SurfaceAdapter, capability: Capability, condition: Condition, inputs: Inputs): Promise<{matches: boolean; observed: unknown}> {
  if (condition.kind === "urlHash") { const observed = new URL(adapter.url()).hash; return {matches: observed === condition.value, observed}; }
  const target = capability.targets[condition.target]!;
  const visible = await adapter.visible(target);
  if (condition.kind === "visible") return {matches: visible, observed: {visible}};
  const text = visible ? await adapter.extract(target) : "";
  const expected = valueOf(condition.value, inputs);
  if (!expected.trim()) throw new CapabilityError("INVALID_INPUT", "Text conditions require nonempty text");
  return {matches: visible && (condition.kind === "textContains" ? text.includes(expected) : text === expected), observed: {visible, text}};
}
export async function checkCondition(adapter: SurfaceAdapter, capability: Capability, condition: Condition, inputs: Inputs): Promise<boolean> { return (await observeCondition(adapter, capability, condition, inputs)).matches; }
export async function waitForCondition(adapter: SurfaceAdapter, capability: Capability, condition: Condition, inputs: Inputs, timeoutMs: number, probe: () => Promise<boolean> = async () => false, record: (state: Record<string, unknown>) => void = () => {}): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let observed: unknown = {visible: false};
  do {
    adapter.setOperationTimeout?.(Math.max(1, Math.min(1000, deadline - Date.now())));
    const blocked = await probe();
    try { const state = await observeCondition(adapter, capability, condition, inputs); observed = state.observed; record({expected: condition, ...state, blocked}); if (!blocked && state.matches) return; }
    catch (error) { if (!(error instanceof CapabilityError) || error.code !== "TARGET_NOT_FOUND") throw error; observed = {code: error.code}; }
    await sleep(Math.max(0, Math.min(50, deadline - Date.now())));
  } while (Date.now() < deadline);
  throw new CapabilityError("WAIT_TIMEOUT", "Expected condition was not observed before timeout", { expected: condition, observed, timeoutMs });
}
export type ExecutionStatus = "SUCCESS" | "BUSINESS_OUTCOME" | "RECOVERABLE_ERROR" | "HARD_FAILURE" | "OUTCOME_UNKNOWN";
export interface ExecutionResult { status: ExecutionStatus; sessionId: string; code: string; stepId: string; retryable: boolean; evidenceRef: string; expected?: unknown; observed?: unknown; outputs?: Record<string, string>; message?: string; details?: Record<string, unknown>; reconciliationRequired?: boolean; outputReadiness?: "validated" | "legacy-unverified" }
export type ReplayResult = ExecutionResult;
async function replayInternal(artifactPath: string, inputs: Inputs, directory: string, policy: Policy = testPolicy, createAdapter: (inputs: Inputs, policy: Policy) => Promise<SurfaceAdapter> = PlaywrightAdapter.launch, handoff?: HandoffOptions): Promise<ExecutionResult> {
  mkdirSync(directory, { recursive: true });
  const sessionId = crypto.randomUUID();
  const log = (kind: string, fields: Record<string, unknown>) => appendFileSync(join(directory, "events.jsonl"), JSON.stringify({ at: new Date().toISOString(), kind, ...fields }) + "\n");
  let adapter: SurfaceAdapter | undefined;
  let stepId = "validation";
  let expected: unknown;
  const pending = new Set<string>();
  let writeDispatched = false;
  let result: ExecutionResult;
  const probe = async (): Promise<boolean> => {
    const dialog = adapter?.unexpectedDialog?.();
    if (dialog) throw new CapabilityError("UNEXPECTED_DIALOG", "Unexpected browser dialog", {observed: dialog});
    let blocked = false;
    const matches: {code: string; status: string; expected: string; observed: string; resolvesMutations: string[]}[] = [];
    for (const detector of policy.detectors ?? []) {
      let observed: string;
      try {
        if (!await adapter!.visible(detector.target)) continue;
        observed = await adapter!.extract(detector.target);
      } catch (error) { if (error instanceof CapabilityError && error.code === "TARGET_NOT_FOUND") continue; throw error; }
      const expected = valueOf(detector.value, inputs);
      if (!expected.trim()) throw new CapabilityError("INVALID_POLICY", "Detector text must be nonempty");
      if (!observed.includes(expected)) continue;
      log("detector", {stepId, code: detector.code, observed});
      if (detector.status === "RECOVERABLE_ERROR") { blocked = true; continue; }
      matches.push({code: detector.code, status: detector.status, expected, observed, resolvesMutations: detector.resolvesMutations ?? []});
    }
    if (matches.length > 1) throw new CapabilityError("AMBIGUOUS_OUTCOME", "Multiple terminal outcome detectors matched", {observed: matches});
    if (matches[0]) throw new CapabilityError(matches[0].code, "Explicit UI outcome detector matched", matches[0]);
    return blocked;
  };
  try {
    policy = policySchema.parse(policy);
    const capability = validateCapability(JSON.parse(readFileSync(artifactPath, "utf8")));
    validateInputs(capability, inputs);
    for (const step of capability.steps) if (!policy.actions.includes(step.action)) throw new CapabilityError("POLICY_DENIED", `Action ${step.action} is not allowed`);
    log("replay_start", { sessionId, capabilityId: capability.id, llmCalls: 0 });
    adapter = await createAdapter(inputs, policy);
    const saved: Record<string, string> = {};
    const completedSteps: string[] = [];
    for (const step of capability.steps) {
      stepId = step.id;
      expected = step;
      let recoveryRetry = false;
      const execution = {dispatch: "beforeDispatch" as "beforeDispatch" | "started" | "completed"};
      const execute = async () => {
        execution.dispatch = "beforeDispatch";
        const active = adapter!;
        active.setOperationTimeout?.(5000);
        log("step_start", { stepId, action: step.action });
        const transient = await probe();
        const outputChecks = step.action === "extract" ? Object.entries(capability.outputs).filter(([,output]) => "savedValue" in output.source && output.source.savedValue === step.saveAs && output.validation) : [];
        if (transient && step.action !== "wait" && !outputChecks.length) throw new CapabilityError("SLOW_LOADING", "Transient UI blocks action", {observed: "Configured transient detector matched"});
        const mutating = ["click", "fill", "selectOption"].includes(step.action) && (!("effect" in step) || step.effect !== "readOnly");
        const previouslyDispatched = writeDispatched;
        if (step.action === "click" || step.action === "fill" || step.action === "selectOption") await active.authorize?.(step.action, capability.targets[step.target]!);
        execution.dispatch = "started";
        log("step_dispatch", {stepId, action: step.action, dispatch: execution.dispatch});
        if (mutating) writeDispatched = true;
        if (mutating) pending.add(step.id);
        try {
          if (step.action === "navigate") await active.navigate(step.url);
          else if (step.action === "click") await active.click(capability.targets[step.target]!);
          else if (step.action === "fill") await active.fill(capability.targets[step.target]!, valueOf(step.value, inputs));
          else if (step.action === "selectOption") await active.selectOption(capability.targets[step.target]!, step.by, valueOf(step.value, inputs));
          else if (step.action === "extract") {
            if (outputChecks.length) saved[step.saveAs] = await extractReady(active, capability.targets[step.target]!, outputChecks, inputs, probe, fields => log("output_validation", {stepId, property: step.property ?? "text", ...fields}), step.property);
            else for (let attempt = 1; ; attempt++) {
              log("attempt", {stepId, attempt});
              try { saved[step.saveAs] = await active.extract(capability.targets[step.target]!, step.property); break; }
              catch (error) {
                if (!(error instanceof CapabilityError) || error.code !== "TARGET_NOT_FOUND" || attempt >= (recoveryRetry ? 1 : (step.retry?.maxAttempts ?? 1))) throw error;
                log("retry", {stepId, attempt, delayMs: step.retry!.delayMs});
                await sleep(step.retry!.delayMs);
                if (await probe()) throw new CapabilityError("SLOW_LOADING", "Transient UI blocks retry");
              }
            }
          } else if (step.action === "wait") await waitForCondition(active, capability, step.condition, inputs, step.timeoutMs, probe, state => log("condition", {stepId, ...state}));
          else {
            const state = await observeCondition(active, capability, step.condition, inputs);
            log("condition", {stepId, expected: step.condition, ...state});
            if (!state.matches) throw new CapabilityError("ASSERTION_FAILED", "Expected state was not observed", {expected: step.condition, observed: state.observed});
          }
        } catch (error) {
          if (mutating && error instanceof CapabilityError && ["TARGET_NOT_FOUND", "AMBIGUOUS_TARGET", "CONFLICTING_TARGETS", "INVALID_TARGET"].includes(error.code)) { pending.delete(step.id); writeDispatched = previouslyDispatched; }
          throw error;
        }
        execution.dispatch = "completed";
      };
      try { await execute(); }
      catch (failure) {
        const failedDispatch = execution.dispatch;
        log("step_failure", {stepId, dispatch: failedDispatch});
        if (!handoff || !eligibleForHandoff(failure)) throw failure;
        const cause = failure instanceof CapabilityError ? failure.code : "TIMEOUT";
        try {
          await requestIntervention(handoff, adapter, {
            sessionId, capabilityId: capability.id, description: capability.description, stepId, reason: cause,
            completedSteps: [...completedSteps], pendingMutations: [...pending],
            savedOutputNames: Object.keys(saved), expected: step, evidenceRef: join(directory, "events.jsonl"),
          }, directory, log);
          adapter.setOperationTimeout?.(5000);
          checkUrl(adapter.url(), policy);
          if (!policy.actions.includes(step.action)) throw new CapabilityError("POLICY_DENIED", "Action is not allowed on resume");
          if (step.action === "navigate") checkUrl(step.url, policy);
          if (await probe()) throw new CapabilityError("HANDOFF_UNRESOLVED", "UI remains blocked after intervention");
          const checks = recoveryConditions(capability, capability.steps.indexOf(step), pending);
          let verified = checks.length > 0;
          const observations: unknown[] = [];
          for (const check of checks) {
            const state = await observeCondition(adapter, capability, check.condition, inputs);
            observations.push({conditionStepId: check.id, ...state});
            log("handoff_verification", {stepId, conditionStepId: check.id, expected: check.condition, ...state});
            verified = verified && state.matches;
          }
          if (verified) {
            for (const check of checks) if (check.confirms) pending.delete(check.confirms);
            log("handoff_decision", {stepId, decision: "HUMAN_COMPLETED", verifiedSteps: checks.map(check => check.id)});
            handoff.controller.notify?.("HUMAN_COMPLETED: existing postconditions verified.");
          } else if (!pending.size && (failedDispatch === "beforeDispatch" || ["extract", "wait", "assert"].includes(step.action))) {
            if ("target" in step && !await adapter.visible(capability.targets[step.target]!)) throw new CapabilityError("TARGET_NOT_FOUND", "Retry target is not visible");
            log("handoff_decision", {stepId, decision: "SAFE_RETRY", dispatch: failedDispatch, reason: failedDispatch === "beforeDispatch" ? "Action never started; policy, detectors and target revalidated; no pending mutations" : "Observation-only operation; no pending mutations", maxAttempts: 1});
            handoff.controller.notify?.("SAFE_RETRY: executing this verified-safe step once.");
            recoveryRetry = true;
            // CDP and page guards also suppress Playwright clicks. Return input
            // to automation only after all recovery checks have passed.
            await adapter.setHumanInputEnabled?.(true);
            await execute();
          } else throw new CapabilityError("HANDOFF_UNRESOLVED", "No sufficient recorded postcondition or safe retry proof", {observed: observations});
          await adapter.setHumanInputEnabled?.(true);
          log("handoff_control", {stepId, owner: "automation"});
        } catch (error) {
          const code = error instanceof CapabilityError && error.code === "HANDOFF_ABORTED" ? "HANDOFF_ABORTED" : "HANDOFF_UNRESOLVED";
          log("handoff_decision", {stepId, decision: code === "HANDOFF_ABORTED" ? "ABORT" : "HANDOFF_UNRESOLVED", cause, pendingMutations: [...pending]});
          throw new CapabilityError(code, "Replay could not safely resume", {cause, failedDispatch, dispatch: execution.dispatch, recoveryCode: error instanceof CapabilityError ? error.code : "EXECUTION_FAILED", recoveryMessage: error instanceof Error ? error.message : "Unknown recovery error", observed: error instanceof CapabilityError ? error.details.observed : undefined});
        }
      }
      if ("confirms" in step && step.confirms) pending.delete(step.confirms);
      completedSteps.push(step.id);
      log("step_end", { stepId });
    }
    stepId = "checkpoints";
    for (const checkpoint of capability.checkpoints) { expected = checkpoint; await waitForCondition(adapter, capability, checkpoint, inputs, 5000, probe, state => log("condition", {stepId, ...state})); }
    if (capability.steps.some(step => "effect" in step && step.effect === "stateChanging" && pending.has(step.id))) throw new CapabilityError("UNCONFIRMED_MUTATION", "Explicit state-changing action requires a semantic confirmation", {observed: {pendingMutations: [...pending]}});
    const outputs = Object.fromEntries(Object.entries(capability.outputs).map(([name, output]) => [name, "page" in output.source ? adapter!.url() : saved[output.source.savedValue]! ]));
    const outputReadiness = Object.values(capability.outputs).every(output => !("savedValue" in output.source) || output.validation) ? "validated" : "legacy-unverified";
    result = { status: "SUCCESS", code: "SUCCESS", sessionId, stepId, outputs, outputReadiness, retryable: false, evidenceRef: join(directory, "events.jsonl") };
  } catch (error) {
    const code = error instanceof CapabilityError ? error.code : error instanceof Error && error.name === "TimeoutError" ? "TIMEOUT" : "EXECUTION_FAILED";
    const details = error instanceof CapabilityError ? error.details : {};
    const resolved = Array.isArray(details.resolvesMutations) ? details.resolvesMutations : [];
    const unknown = [...pending].some(id => !resolved.includes(id));
    const status: ExecutionStatus = unknown ? "OUTCOME_UNKNOWN" : details.status === "BUSINESS_OUTCOME" ? "BUSINESS_OUTCOME" : details.status === "HARD_FAILURE" ? "HARD_FAILURE" : ["WAIT_TIMEOUT", "TIMEOUT", "SLOW_LOADING", "OUTPUT_VALIDATION_TIMEOUT"].includes(code) ? "RECOVERABLE_ERROR" : "HARD_FAILURE";
    result = {status, code, sessionId, stepId, retryable: status === "RECOVERABLE_ERROR" && !writeDispatched, evidenceRef: join(directory, "events.jsonl"), expected: details.expected ?? expected, observed: details.observed ?? {code, ...details}, message: error instanceof Error ? error.message : String(error), details: {...details, pendingMutations: [...pending], writeDispatched}, ...(unknown ? {reconciliationRequired: true} : {})};
    if (adapter) {
      try { adapter.setOperationTimeout?.(5000); await adapter.captureFailure(join(directory, "failure.png")); log("failure_evidence", { screenshot: "failure.png" }); } catch (error) {
        if (error instanceof CapabilityError && error.code === "UNSAFE_IMAGE_OMITTED") log("failure_evidence", {screenshotOmitted: true, diagnostic: error.details.diagnostic});
        else log("failure_capture_error", {message: String(error)});
      }
    }
  } finally { try { await adapter?.close(); } catch (error) { log("cleanup_error", {message: String(error)}); } }
  writeFileSync(join(directory, "result.json"), JSON.stringify(result, null, 2) + "\n");
  log("replay_end", { ...result });
  return result;
}

export async function replayCapability(...args: Parameters<typeof replayInternal>): Promise<ExecutionResult> {
  return withSafety(args[3] ?? testPolicy, args[1], async () => sanitize(await replayInternal(...args)));
}
