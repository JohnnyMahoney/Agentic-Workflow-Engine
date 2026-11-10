import { withSafety, sanitize, assertUnredacted } from "../safety/persistence.js";
import { writeFileSync } from "../safety/persistence.js";
import { validateHumanEvidence } from "../discovery/human-evidence.js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { z } from "zod";
import { capabilitySchema, CapabilityError, validateCapability, validateInputs, valueOf, outputMatches, type Capability, type Condition, type Inputs, type Target } from "./contract.js";
import { requestSchema, type DiscoveryEvidence, type Snapshot, type NodeFacts } from "./evidence.js";
import { strategyLocator, checkUrl, testPolicy, type Policy } from "../surfaces/playwright.js";
import { checkDiscoveryEvidence, readDiscoveryAudit, type DiscoveryAudit } from "../discovery/acceptance.js";
export { checkDiscoveryEvidence } from "../discovery/acceptance.js";

const evidenceRefSchema = z.object({ action: z.number().int().positive(), phase: z.enum(["before", "after"]), node: z.object({ frame: z.number().int().nonnegative(), node: z.string().min(1) }).strict().optional() }).strict();
export const candidateSchema = z.object({ capability: capabilitySchema, stepEvidence: z.record(z.string(), evidenceRefSchema), checkpointEvidence: z.array(evidenceRefSchema) }).strict();
type EvidenceRef = z.infer<typeof evidenceRefSchema>;
export type Candidate = z.infer<typeof candidateSchema>;
const fail = (message: string): never => { throw new CapabilityError("UNSUPPORTED_EVIDENCE", message); };
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
const equal = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

// Resolve against the recorded DOM, with script execution and network disabled.
// Frame ancestry is checked against snapshots of the actual owning frame elements.
export async function inspectRecordedTarget(page: Page, snapshot: Snapshot, target: Target, inputs: Inputs): Promise<{ frame: number; node: string; tag: string; multiple: boolean } & NodeFacts> {
  let matched: ({ frame: number; node: string; tag: string; multiple: boolean } & NodeFacts) | undefined;
  for (const strategy of target.strategies) {
    let frame = snapshot.frames.find((item) => item.parent === null) ?? fail("Missing root frame snapshot");
    for (const selector of strategy.frames) {
      await page.setContent(frame.html);
      const element = page.locator(selector);
      if (await element.count() !== 1) fail("Frame locator is absent or ambiguous in recorded state");
      const node = await element.getAttribute("data-cap-node");
      frame = snapshot.frames.find((item) => item.parent === frame.id && item.elementNode === node) ?? fail("Missing child frame evidence");
    }
    await page.setContent(frame.html);
    const locator = await strategyLocator(page, { ...strategy, frames: [] }, inputs);
    const count = await locator.count();
    if (count === 0) throw new CapabilityError("RECORDED_TARGET_ABSENT", "Locator is absent in recorded state");
    if (count !== 1) fail("Locator must identify exactly one element in its evidence state");
    const node = await locator.getAttribute("data-cap-node") ?? fail("Target has no recorded identity");
    const facts = frame.nodes[node] ?? fail("Target has no recorded observations");
    const current = { frame: frame.id, node, tag: await locator.evaluate((element) => element.tagName.toLowerCase()), multiple: await locator.evaluate(element => element instanceof HTMLSelectElement && element.multiple), ...facts };
    if (matched && (matched.frame !== current.frame || matched.node !== current.node)) fail("Locator strategies point to different recorded elements");
    matched = current;
  }
  return matched ?? fail("No validated locator strategy");
}

export async function validateCandidate(raw: unknown, evidence: DiscoveryEvidence, policy: Policy = testPolicy, readinessEvidence: Record<string, unknown>[] = [], audit?: DiscoveryAudit): Promise<Capability> {
  const parsed = candidateSchema.safeParse(raw);
  if (!parsed.success) throw new CapabilityError("INVALID_CANDIDATE", "Compilation candidate schema validation failed", { issues: parsed.error.issues });
  const candidate = parsed.data;
  const cap = validateCapability(candidate.capability);
  const request = requestSchema.parse(evidence.request);
  const admission = checkDiscoveryEvidence(evidence, audit, policy);
  await validateHumanEvidence(evidence, policy);
  if (admission.recoveredFailures.length) {
    if (cap.schemaVersion !== "2.1" || !Object.keys(cap.outputs).length || !cap.checkpoints.some(condition => condition.kind !== "visible")) throw new CapabilityError("DISCOVERY_GOAL_UNPROVEN", "Recovered discovery requires validated outputs and semantic final checkpoints");
    for (const name of Object.keys(request.inputs)) if (!cap.checkpoints.some(condition => (condition.kind === "textContains" || condition.kind === "textEquals") && "input" in condition.value && condition.value.input === name)) throw new CapabilityError("DISCOVERY_GOAL_UNPROVEN", "Recovered discovery requires final semantic verification of every supplied input", {input: name});
  }
  validateInputs(cap, request.bindings);
  if (!equal(cap.inputs, request.inputs)) fail("Input definitions differ from the explicit compilation request");
  const declaredOutputs = Object.fromEntries(Object.entries(cap.outputs).map(([name, output]) => [name, { type: output.type, description: output.description }]));
  if (!equal(declaredOutputs, request.outputs)) fail("Output definitions differ from the explicit compilation request");
  if (!equal(Object.keys(candidate.stepEvidence).sort(), cap.steps.map((step) => step.id).sort())) fail("Every step must have exactly one evidence reference");
  if (candidate.checkpointEvidence.length !== cap.checkpoints.length) fail("Every checkpoint needs evidence");
  for (const name of Object.keys(request.inputs)) {
    if (!JSON.stringify({ targets: cap.targets, steps: cap.steps }).includes(`"input":"${name}"`)) fail(`Declared input ${name} is not bound in the workflow`);
  }
  const indices = evidence.actions.map((action) => action.index);
  if (indices.some((value, index) => index > 0 && value <= indices[index - 1]!)) fail("Discovery action indices must be strictly ordered");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ javaScriptEnabled: false });
  await context.route("**/*", (route) => route.abort());
  const page = await context.newPage();
  const consumed = new Set<number>();
  const verifiedTargets = new Set<string>();
  let latest = 0;
  const stateFor = (ref: EvidenceRef) => {
    const action = evidence.actions.find((item) => item.index === ref.action && item.success) ?? fail("Evidence reference does not identify a successful action");
    return { action, snapshot: action[ref.phase] };
  };
  const inspect = async (targetName: string, ref: EvidenceRef) => {
    const target = await inspectRecordedTarget(page, stateFor(ref).snapshot, cap.targets[targetName]!, request.bindings);
    if (!ref.node || ref.node.frame !== target.frame || ref.node.node !== target.node) fail("Locator does not match the cited evidence element");
    verifiedTargets.add(targetName);
    return target;
  };
  const condition = async (condition: Condition, ref: EvidenceRef) => {
    const { snapshot } = stateFor(ref);
    if (condition.kind === "urlHash") {
      if (new URL(snapshot.url).hash !== condition.value) fail("URL checkpoint is not supported by observed state");
    } else {
      const target = await inspect(condition.target, ref);
      if (!target.visible) fail("Condition target was not visible in recorded state");
      if (condition.kind === "textEquals" && target.text !== valueOf(condition.value, request.bindings)) fail("Text checkpoint contradicts the recorded element");
      if (condition.kind === "textContains" && !target.text.includes(valueOf(condition.value, request.bindings))) fail("Text checkpoint contradicts the recorded element");
      const position = ref.action * 2 + (ref.phase === "after" ? 1 : 0);
      const preceding = evidence.actions.filter(item => item.index * 2 + 1 < position && ["navigate", "left_click", "form_input"].includes(item.name)).at(-1);
      if (preceding) for (const item of evidence.actions) for (const phase of ["before", "after"] as const) {
        const earlier = item.index * 2 + (phase === "after" ? 1 : 0);
        if (earlier < preceding.index * 2 + 1 || earlier >= position) continue;
        try {
          const interim = await inspectRecordedTarget(page, item[phase], cap.targets[condition.target]!, request.bindings);
          const matches = interim.visible && (condition.kind === "visible" || (condition.kind === "textEquals" ? interim.text === valueOf(condition.value, request.bindings) : interim.text.includes(valueOf(condition.value, request.bindings))));
          if (matches && interim.text !== target.text) throw new CapabilityError("PREMATURE_CHECKPOINT", "Checkpoint also accepts a distinct earlier recorded state", {expected: target.text, observed: interim.text, action: item.index, phase, condition});
        } catch (error) { if (!(error instanceof CapabilityError) || error.code !== "RECORDED_TARGET_ABSENT") throw error; }
      }
    }
  };
  try {
    for (const step of cap.steps) {
      if (!policy.actions.includes(step.action)) throw new CapabilityError("POLICY_DENIED", `Action ${step.action} is not allowed`);
      const ref = candidate.stepEvidence[step.id]!;
      const { action } = stateFor(ref);
      const position = ref.action * 2 + (ref.phase === "after" ? 1 : 0);
      if (position < latest) fail("Artifact steps contradict discovery order");
      latest = position;
      if (step.action === "navigate") {
        checkUrl(step.url, policy);
        if (ref.phase !== "after" || action.name !== "navigate" || action.after.url !== step.url || action.input.url !== step.url || consumed.has(action.index)) fail("Navigation is not evidenced");
        consumed.add(action.index);
      } else if (step.action === "click" || step.action === "fill" || step.action === "selectOption") {
        const target = await inspect(step.target, ref);
        if (ref.phase !== "before" || action.name !== (step.action === "click" ? "left_click" : "form_input") || !equal(action.target, { frame: target.frame, node: target.node }) || !target.visible || consumed.has(action.index)) fail("Action does not match the actual discovery target");
        if (step.action === "fill" && target.tag === "select") fail("Native select requires selectOption, not fill");
        if (step.action === "fill" && !equal(step.value, action.input.value)) fail("Fill does not match the explicit recorded input binding");
        if (step.action === "selectOption") {
          if (target.tag !== "select" || !equal(step.value, action.input.value)) fail("Selection does not match a recorded native select input");
          const after = await inspectRecordedTarget(page, action.after, cap.targets[step.target]!, request.bindings);
          if (after.tag !== "select" || !after.selectedOption || after.selectedOption[step.by] !== valueOf(step.value, request.bindings)) fail("Selected option is not supported by recorded state");
        }
        consumed.add(action.index);
      } else if (step.action === "extract") {
        const target = await inspect(step.target, ref);
        let observedValue = target.text;
        if (step.property === "selectedOptionLabel") {
          const selectionAction = action.name === "form_input" && equal(action.target, {frame: target.frame, node: target.node});
          if (ref.phase !== "after" || !target.visible || target.tag !== "select" || target.multiple || !target.selectedOption?.label || (!selectionAction && !["read_page", "get_page_text"].includes(action.name))) fail("Selected option extraction requires a visible single select with recorded selectedOption evidence after its form_input or a textual observation");
          observedValue = target.selectedOption!.label;
        } else if (ref.phase !== "after" || !["read_page", "get_page_text"].includes(action.name) || !target.visible || !target.text || !action.observation?.includes(target.text)) fail("Extraction was not observed in a textual browser result");
        for (const [name, output] of Object.entries(cap.outputs)) {
          if (!("savedValue" in output.source) || output.source.savedValue !== step.saveAs || !output.validation) continue;
          const condition = output.validation.condition;
          if (!outputMatches(condition, observedValue, request.bindings)) throw new CapabilityError("OUTPUT_EVIDENCE_MISMATCH", "Output condition rejects the recorded successful value", {output: name, observed: observedValue, expected: condition});
          const preceding = evidence.actions.filter(item => item.index < ref.action && ["navigate", "left_click", "form_input"].includes(item.name)).at(-1);
          const distinct = new Set<string>();
          if (preceding) for (const item of evidence.actions) for (const phase of ["before", "after"] as const) {
            const earlier = item.index * 2 + (phase === "after" ? 1 : 0);
            if (earlier < preceding.index * 2 + 1 || earlier >= position) continue;
            try {
              const interim = await inspectRecordedTarget(page, item[phase], cap.targets[step.target]!, request.bindings);
              const interimValue = step.property === "selectedOptionLabel" ? interim.selectedOption?.label : interim.text;
              if (!interim.visible || interimValue === undefined || interimValue === observedValue) continue;
              distinct.add(interimValue);
              if (outputMatches(condition, interimValue, request.bindings)) throw new CapabilityError("PREMATURE_OUTPUT_VALIDATION", "Output condition accepts a distinct earlier recorded value", {output: name, expected: condition, observed: interimValue, action: item.index, phase});
            } catch (error) { if (!(error instanceof CapabilityError) || error.code !== "RECORDED_TARGET_ABSENT") throw error; }
          }
          readinessEvidence.push({output: name, stepId: step.id, property: step.property ?? "text", condition, positiveSample: observedValue, rejectedIntermediateValues: [...distinct], limitation: step.property === "selectedOptionLabel" ? "Selected label proves selection only; creation requires a separate post-action confirmation." : distinct.size ? "Only recorded intermediate values were checked; format does not prove freshness or business correctness." : "No distinct intermediate value was recorded for this output; only positive-sample compatibility is proven."});
        }
      } else await condition(step.condition, ref);
    }
    for (const action of evidence.actions) if (action.success && ["navigate", "left_click", "form_input"].includes(action.name) && !consumed.has(action.index)) fail("Candidate omits an executed navigation or mutation");
    for (const [index, checkpoint] of cap.checkpoints.entries()) {
      const ref = candidate.checkpointEvidence[index]!;
      if (ref.action * 2 + (ref.phase === "after" ? 1 : 0) < latest) fail("Final checkpoint cites an earlier state");
      await condition(checkpoint, ref);
    }
    if (Object.keys(cap.targets).some((name) => !verifiedTargets.has(name))) fail("Artifact contains targets without verified evidence");
    return cap;
  } finally { await browser.close(); }
}

async function buildArtifactInternal(candidatePath: string, evidencePath: string, directory: string, policy: Policy = testPolicy): Promise<Capability> {
  const evidenceText = readFileSync(evidencePath, "utf8");
  const candidateText = readFileSync(candidatePath, "utf8");
  const readinessEvidence: Record<string, unknown>[] = [];
  const evidence = JSON.parse(evidenceText) as DiscoveryEvidence;
  const audit = readDiscoveryAudit(evidencePath);
  const admission = checkDiscoveryEvidence(evidence, audit, policy);
  assertUnredacted(sanitize(JSON.parse(candidateText)));
  assertUnredacted(sanitize(JSON.parse(evidenceText)));
  const capability = await validateCandidate(JSON.parse(candidateText), evidence, policy, readinessEvidence, audit);
  writeFileSync(join(directory, "discovery-acceptance.json"), JSON.stringify({...admission, status: "accepted", goalVerification: "candidate-outputs-and-final-checkpoints-validated", excludedFailedActions: admission.recoveredFailures.map(failure => failure.action), limitation: "Goal verification is limited to the explicit request contract, observed outputs and checkpoints; it is not a general proof of arbitrary natural-language intent."}, null, 2) + "\n");
  writeFileSync(join(directory, "artifact.json"), JSON.stringify(capability, null, 2) + "\n");
  writeFileSync(join(directory, "output-readiness-validation.json"), JSON.stringify({schemaVersion: capability.schemaVersion, outputs: readinessEvidence, legacyUnverifiedOutputs: Object.entries(capability.outputs).filter(([,output]) => "savedValue" in output.source && !output.validation).map(([name]) => name)}, null, 2) + "\n");
  writeFileSync(join(directory, "validation.json"), JSON.stringify({ status: "validated", evidenceSha256: createHash("sha256").update(evidenceText).digest("hex"), candidateSha256: createHash("sha256").update(candidateText).digest("hex"), evidencePath, candidatePath, humanInterventionsVerified: (evidence.interventions ?? []).map(item => item.id), policySha256: createHash("sha256").update(JSON.stringify(policy)).digest("hex"), checks: ["human-blocker-policy-and-dom", "schema", "semantic", "explicit-bindings", "recorded-dom-targets", "action-identity-and-order", "observed-select-state", "observed-extraction", "observed-checkpoints", "policy"], limitation: "Recorded states prove observed identity; fresh-session replay must separately test stability." }, null, 2) + "\n");
  return capability;
}

export async function buildArtifact(...args: Parameters<typeof buildArtifactInternal>): Promise<Capability> {
  return withSafety(args[3] ?? testPolicy, {}, () => buildArtifactInternal(...args));
}
