import { z } from "zod";
import { matchesPattern, patternSchema } from "./output-validation.js";

const key = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/);
export const valueSchema = z.union([
  z.object({ input: key }).strict(),
  z.object({ literal: z.string() }).strict(),
]);
const strategyFields = {
  frames: z.array(z.string().min(1)).max(5).default([]),
  scope: z.object({
    css: z.string().min(1),
    has: z.object({ css: z.string().min(1), text: valueSchema }).strict().optional(),
  }).strict().optional(),
};
export const strategySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("role"), role: z.enum(["button", "link", "textbox", "heading", "cell", "row", "checkbox", "combobox"]), name: valueSchema, ...strategyFields }).strict(),
  z.object({ kind: z.literal("css"), selector: z.string().min(1), ...strategyFields }).strict(),
]);
export const targetSchema = z.object({ strategies: z.array(strategySchema).min(1).max(3) }).strict();
export const conditionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("visible"), target: key }).strict(),
  z.object({ kind: z.literal("textEquals"), target: key, value: valueSchema }).strict(),
  z.object({ kind: z.literal("textContains"), target: key, value: valueSchema }).strict(),
  z.object({ kind: z.literal("urlHash"), value: z.string().startsWith("#") }).strict(),
]);
export const actionNames = ["navigate", "click", "fill", "selectOption", "extract", "wait", "assert"] as const;
export const extractPropertySchema = z.enum(["text", "selectedOptionLabel"]);
export type ExtractProperty = z.infer<typeof extractPropertySchema>;
const stepSchema = z.discriminatedUnion("action", [
  z.object({ id: key, action: z.literal("navigate"), url: z.url() }).strict(),
  z.object({ id: key, action: z.literal("click"), target: key, effect: z.enum(["readOnly", "stateChanging"]).optional() }).strict(),
  z.object({ id: key, action: z.literal("fill"), target: key, value: valueSchema, effect: z.enum(["readOnly", "stateChanging"]).optional() }).strict(),
  z.object({ id: key, action: z.literal("selectOption"), target: key, by: z.enum(["label", "value"]), value: valueSchema, effect: z.enum(["readOnly", "stateChanging"]).optional() }).strict(),
  z.object({ id: key, action: z.literal("extract"), target: key, property: extractPropertySchema.optional(), saveAs: key, retry: z.object({ maxAttempts: z.number().int().min(1).max(3), delayMs: z.number().int().min(1).max(1000) }).strict().optional() }).strict(),
  z.object({ id: key, action: z.literal("wait"), condition: conditionSchema, timeoutMs: z.number().int().min(1).max(30000), confirms: key.optional() }).strict(),
  z.object({ id: key, action: z.literal("assert"), condition: conditionSchema, confirms: key.optional() }).strict(),
]);
export const inputSchema = z.object({ type: z.enum(["string", "number", "boolean"]), required: z.literal(true), description: z.string().min(1) }).strict();
export const outputConditionSchema = z.discriminatedUnion("kind", [
  z.object({kind: z.literal("textEquals"), value: valueSchema}).strict(),
  z.object({kind: z.literal("textMatches"), pattern: patternSchema}).strict(),
]);
export const outputSchema = z.object({ type: z.literal("string"), description: z.string().min(1), source: z.union([z.object({ savedValue: key }).strict(), z.object({ page: z.literal("url") }).strict()]), validation: z.object({condition: outputConditionSchema, timeoutMs: z.number().int().min(1).max(30000)}).strict().optional() }).strict();
export const capabilitySchema = z.object({
  schemaVersion: z.enum(["2.0", "2.1"]), id: key, version: z.string().regex(/^\d+\.\d+\.\d+$/), description: z.string().min(1),
  inputs: z.record(key, inputSchema), targets: z.record(key, targetSchema), steps: z.array(stepSchema).min(1).max(50),
  outputs: z.record(key, outputSchema), checkpoints: z.array(conditionSchema).min(1),
}).strict();
export type Capability = z.infer<typeof capabilitySchema>;
export type Target = z.infer<typeof targetSchema>;
export type Strategy = z.infer<typeof strategySchema>;
export type Condition = z.infer<typeof conditionSchema>;
export type Value = z.infer<typeof valueSchema>;
export type Inputs = Record<string, string | number | boolean>;
export type OutputCondition = z.infer<typeof outputConditionSchema>;
export function outputMatches(condition: OutputCondition, text: string, inputs: Inputs): boolean {
  if (condition.kind === "textEquals") return text === valueOf(condition.value, inputs) && text.trim().length > 0;
  try { return matchesPattern(condition.pattern, text); }
  catch { throw new CapabilityError("OUTPUT_PATTERN_ERROR", "Output pattern exceeded evaluation limits or is invalid"); }
}

export class CapabilityError extends Error {
  constructor(readonly code: string, message: string, readonly details: Record<string, unknown> = {}) { super(message); }
}
export function valueOf(value: Value, inputs: Inputs): string {
  if ("literal" in value) return value.literal;
  if (!Object.hasOwn(inputs, value.input)) throw new CapabilityError("INVALID_INPUT", `Missing input ${value.input}`);
  return String(inputs[value.input]);
}
export function validateInputs(capability: Pick<Capability, "inputs">, inputs: Inputs): void {
  for (const [name, spec] of Object.entries(capability.inputs)) {
    if (typeof inputs[name] !== spec.type || (typeof inputs[name] === "string" && !String(inputs[name]).trim()) || (typeof inputs[name] === "number" && !Number.isFinite(inputs[name]))) throw new CapabilityError("INVALID_INPUT", `Invalid input ${name}; expected ${spec.type}`);
  }
  if (Object.keys(inputs).some((name) => !Object.hasOwn(capability.inputs, name))) throw new CapabilityError("INVALID_INPUT", "Unknown input supplied");
}
export function validateCapability(raw: unknown): Capability {
  const result = capabilitySchema.safeParse(raw);
  if (!result.success) throw new CapabilityError("INVALID_ARTIFACT", "Artifact does not match Capability v2", { issues: result.error.issues });
  const capability = result.data;
  const requireTarget = (name: string) => { if (!Object.hasOwn(capability.targets, name)) throw new CapabilityError("INVALID_REFERENCE", `Unknown target ${name}`); };
  const checkValue = (value: Value) => { if ("input" in value && !Object.hasOwn(capability.inputs, value.input)) throw new CapabilityError("INVALID_REFERENCE", `Unknown input ${value.input}`); };
  const checkCondition = (condition: Condition) => {
    if ("target" in condition) requireTarget(condition.target);
    if (condition.kind === "textEquals" || condition.kind === "textContains") {
      checkValue(condition.value);
      if (condition.kind === "textContains" && "literal" in condition.value && !condition.value.literal.trim()) throw new CapabilityError("INVALID_ARTIFACT", "textContains requires nonempty text");
    }
  };
  for (const target of Object.values(capability.targets)) for (const strategy of target.strategies) {
    if (/data-(browser-ref|cap-node)/.test(JSON.stringify(strategy))) throw new CapabilityError("UNSTABLE_TARGET", "Session identifiers cannot be replay locators");
    if (strategy.kind === "role") checkValue(strategy.name);
    if (strategy.scope?.has) checkValue(strategy.scope.has.text);
  }
  const ids = new Set<string>();
  const saved = new Set<string>();
  for (const step of capability.steps) {
    if (ids.has(step.id)) throw new CapabilityError("INVALID_ARTIFACT", `Duplicate step ${step.id}`);
    ids.add(step.id);
    if ("target" in step) requireTarget(step.target);
    if (step.action === "fill" || step.action === "selectOption") checkValue(step.value);
    if (step.action === "wait" || step.action === "assert") {
      checkCondition(step.condition);
      if (step.confirms) {
        const mutation = capability.steps.find((item) => item.id === step.confirms);
        if (!mutation || mutation.id === step.id || !ids.has(mutation.id) || !("effect" in mutation) || mutation.effect !== "stateChanging" || step.condition.kind === "visible") throw new CapabilityError("INVALID_REFERENCE", "confirms requires an earlier explicit stateChanging action and a semantic condition");
      }
    }
    if (step.action === "extract") {
      if (saved.has(step.saveAs)) throw new CapabilityError("INVALID_ARTIFACT", `Duplicate saved value ${step.saveAs}`);
      saved.add(step.saveAs);
    }
  }
  for (const output of Object.values(capability.outputs)) {
    if ("savedValue" in output.source && !saved.has(output.source.savedValue)) throw new CapabilityError("INVALID_REFERENCE", `Unknown saved value ${output.source.savedValue}`);
    if (capability.schemaVersion === "2.1" && "savedValue" in output.source && !output.validation) throw new CapabilityError("OUTPUT_VALIDATION_REQUIRED", "Every extracted output requires validation in v2.1");
    if (output.validation && "page" in output.source) throw new CapabilityError("INVALID_ARTIFACT", "Output validation currently applies to extracted values only; use URL checkpoints for page outputs");
    if (output.validation?.condition.kind === "textEquals") {
      checkValue(output.validation.condition.value);
      if ("literal" in output.validation.condition.value && !output.validation.condition.value.literal.trim()) throw new CapabilityError("INVALID_ARTIFACT", "Output validation requires nonempty expected text");
    }
  }
  capability.checkpoints.forEach(checkCondition);
  return capability;
}
