import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { z } from "zod";
import { capabilitySchema, CapabilityError, validateCapability, validateInputs, valueOf, type Capability, type Condition, type Inputs, type Target } from "./contract.js";
import { requestSchema, type DiscoveryEvidence, type Snapshot, type NodeFacts } from "./evidence.js";
import { strategyLocator, checkUrl, testPolicy, type Policy } from "../surfaces/playwright.js";

const evidenceRefSchema = z.object({ action: z.number().int().positive(), phase: z.enum(["before", "after"]), node: z.object({ frame: z.number().int().nonnegative(), node: z.string().min(1) }).strict().optional() }).strict();
export const candidateSchema = z.object({ capability: capabilitySchema, stepEvidence: z.record(z.string(), evidenceRefSchema), checkpointEvidence: z.array(evidenceRefSchema) }).strict();
type EvidenceRef = z.infer<typeof evidenceRefSchema>;
export type Candidate = z.infer<typeof candidateSchema>;
const fail = (message: string): never => { throw new CapabilityError("UNSUPPORTED_EVIDENCE", message); };
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
const equal = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

export function checkDiscoveryEvidence(evidence: DiscoveryEvidence): void {
  if (evidence.evidenceVersion !== "2.0" || !evidence.completed || !evidence.actions.length) fail("Requires completed v2 discovery evidence");
  if (evidence.actions.some((action, index) => !action.success || action.index !== index + 1)) fail("Discovery has failed or missing actions; repeat discovery before compilation");
  if (!evidence.actions.some((action) => action.name === "navigate" && action.after.url === evidence.request.url)) fail("Discovery never reached the requested entry point");
}

// Resolve against the recorded DOM, with script execution and network disabled.
// Frame ancestry is checked against snapshots of the actual owning frame elements.
export async function inspectRecordedTarget(page: Page, snapshot: Snapshot, target: Target, inputs: Inputs): Promise<{ frame: number; node: string; tag: string } & NodeFacts> {
  let matched: ({ frame: number; node: string; tag: string } & NodeFacts) | undefined;
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
    if (await locator.count() !== 1) fail("Locator must identify exactly one element in its evidence state");
    const node = await locator.getAttribute("data-cap-node") ?? fail("Target has no recorded identity");
    const facts = frame.nodes[node] ?? fail("Target has no recorded observations");
    const current = { frame: frame.id, node, tag: await locator.evaluate((element) => element.tagName.toLowerCase()), ...facts };
    if (matched && (matched.frame !== current.frame || matched.node !== current.node)) fail("Locator strategies point to different recorded elements");
    matched = current;
  }
  return matched ?? fail("No validated locator strategy");
}

export async function validateCandidate(raw: unknown, evidence: DiscoveryEvidence, policy: Policy = testPolicy): Promise<Capability> {
  const parsed = candidateSchema.safeParse(raw);
  if (!parsed.success) throw new CapabilityError("INVALID_CANDIDATE", "Compilation candidate schema validation failed", { issues: parsed.error.issues });
  const candidate = parsed.data;
  const cap = validateCapability(candidate.capability);
  const request = requestSchema.parse(evidence.request);
  checkDiscoveryEvidence(evidence);
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
        if (ref.phase !== "after" || !["read_page", "get_page_text"].includes(action.name) || !target.visible || !target.text || !action.observation?.includes(target.text)) fail("Extraction was not observed in a textual browser result");
      } else await condition(step.condition, ref);
    }
    for (const action of evidence.actions) if (["navigate", "left_click", "form_input"].includes(action.name) && (!action.success || !consumed.has(action.index))) fail("Candidate omits an executed navigation or mutation");
    for (const [index, checkpoint] of cap.checkpoints.entries()) {
      const ref = candidate.checkpointEvidence[index]!;
      if (ref.action * 2 + (ref.phase === "after" ? 1 : 0) < latest) fail("Final checkpoint cites an earlier state");
      await condition(checkpoint, ref);
    }
    if (Object.keys(cap.targets).some((name) => !verifiedTargets.has(name))) fail("Artifact contains targets without verified evidence");
    return cap;
  } finally { await browser.close(); }
}

export async function buildArtifact(candidatePath: string, evidencePath: string, directory: string, policy: Policy = testPolicy): Promise<Capability> {
  const evidenceText = readFileSync(evidencePath, "utf8");
  const candidateText = readFileSync(candidatePath, "utf8");
  const capability = await validateCandidate(JSON.parse(candidateText), JSON.parse(evidenceText) as DiscoveryEvidence, policy);
  writeFileSync(join(directory, "artifact.json"), JSON.stringify(capability, null, 2) + "\n");
  writeFileSync(join(directory, "validation.json"), JSON.stringify({ status: "validated", evidenceSha256: createHash("sha256").update(evidenceText).digest("hex"), candidateSha256: createHash("sha256").update(candidateText).digest("hex"), evidencePath, candidatePath, checks: ["schema", "semantic", "explicit-bindings", "recorded-dom-targets", "action-identity-and-order", "observed-select-state", "observed-extraction", "observed-checkpoints", "policy"], limitation: "Recorded states prove observed identity; fresh-session replay must separately test stability." }, null, 2) + "\n");
  return capability;
}
