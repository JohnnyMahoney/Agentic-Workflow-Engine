import { sanitize, writeFileSync } from "../safety/persistence.js";
import { readFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { requestSchema } from "./evidence.js";
import { CapabilityError, validateInputs, type Inputs } from "./contract.js";
import { PlaywrightAdapter, policySchema, testPolicy } from "../surfaces/playwright.js";
import { admitDiscoveryEvidence, readDiscoveryAudit } from "../discovery/acceptance.js";
import type { DiscoveryEvidence } from "./evidence.js";

import { cliHandoffController } from "../replay/handoff.js";

const args = process.argv.slice(2);
const flag = (name: string) => args[args.indexOf(name) + 1];
function required(name: string): string {
  if (!args.includes(name) || !flag(name)) throw new Error(`Missing ${name}`);
  return flag(name)!;
}
async function main(): Promise<void> {
  const command = args[0];
  if (args.includes("--handoff") && (!["replay", "discover"].includes(command!) || args.includes("--headless"))) throw new Error("--handoff requires visible Discovery or Replay");
  if (args.includes("--handoff") && !process.stdin.isTTY) throw new Error("--handoff requires an interactive terminal for take-control, resume, abort");
  const policy = policySchema.parse(JSON.parse(readFileSync(required("--policy"), "utf8")));
  if (!policy.privacy || policy.privacy.dataClass === "sensitive") throw new CapabilityError("SAFETY_CONFIGURATION_REQUIRED", "Trusted synthetic/public privacy classification is required");
  if (!policy.routes?.length) throw new CapabilityError("SAFETY_CONFIGURATION_REQUIRED", "Explicit routes are required");
  const directory = required("--out");
  if (existsSync(directory) && readdirSync(directory).length) throw new Error("Output directory must be empty; use a new directory to preserve evidence");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "policy.json"), JSON.stringify(policy, null, 2) + "\n");
  if (command === "discover") {
    const request = requestSchema.parse(JSON.parse(readFileSync(required("--request"), "utf8")));
    validateInputs(request, request.bindings);
    const { runDiscovery } = await import("../discovery/run.js");
    const goal = request.goal.replace(/\{\{([\w-]+)\}\}/g, (_, name: string) => {
      if (!(name in request.bindings)) throw new Error(`Missing explicit binding ${name}`);
      return String(request.bindings[name]);
    });
    const result = await runDiscovery({ name: request.id, url: request.url, goal: `${goal}\nRead the relevant page text both before acting and after the final state appears.`, model: process.env.CLAUDE_MODEL ?? "claude-sonnet-5-5", headless: args.includes("--headless"), directory, compilationRequest: request, policy, ...(args.includes("--handoff") ? {handoff: {controller: cliHandoffController()}} : {}) });
    if (!(result.assessment as { completed: boolean }).completed) throw new Error(`Discovery did not complete; inspect ${directory}`);
    const evidencePath = join(directory, "discovery-v2.json");
    let admission;
    try {
      admission = await admitDiscoveryEvidence(JSON.parse(readFileSync(evidencePath, "utf8")) as DiscoveryEvidence, readDiscoveryAudit(evidencePath), policy);
    } catch (error) {
      writeFileSync(join(directory, "discovery-admission.json"), JSON.stringify({status: "rejected", code: error instanceof CapabilityError ? error.code : "ADMISSION_FAILED", message: error instanceof Error ? error.message : String(error)}, null, 2) + "\n");
      throw error;
    }
    writeFileSync(join(directory, "discovery-admission.json"), JSON.stringify(admission, null, 2) + "\n");
    console.log(JSON.stringify({ status: "recorded-for-compilation", goalVerified: false, evidence: evidencePath, recoveredFailures: admission.recoveredFailures.length }));
  } else if (command === "compile") {
    const { compileEvidence } = await import("./compile.js");
    await compileEvidence(required("--evidence"), directory, process.env.CLAUDE_MODEL ?? "claude-sonnet-5-5", policy, args.includes("--feedback") ? required("--feedback") : undefined);
    console.log(JSON.stringify({ status: "validated", artifact: join(directory, "artifact.json") }));
  } else if (command === "validate") {
    const { buildArtifact } = await import("./builder.js");
    await buildArtifact(required("--candidate"), required("--evidence"), directory, policy);
    console.log(JSON.stringify({ status: "validated", artifact: join(directory, "artifact.json") }));
  } else if (command === "replay") {
    const inputs: Inputs = args.includes("--inputs") ? JSON.parse(required("--inputs")) as Inputs : {};
    for (let index = 0; index < args.length; index++) if (args[index] === "--input") {
      const pair = args[index + 1] ?? "";
      const separator = pair.indexOf("=");
      if (separator < 1 || pair.slice(0, separator) in inputs) throw new Error("Invalid or duplicate --input; expected name=value");
      inputs[pair.slice(0, separator)] = pair.slice(separator + 1);
    }
    const { replayCapability } = await import("../replay/engine.js");
    const result = await replayCapability(required("--artifact"), inputs, directory, policy, (values, rules) => PlaywrightAdapter.launch(values, rules, { headless: args.includes("--headless") }), args.includes("--handoff") ? { controller: cliHandoffController() } : undefined);
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== "SUCCESS") process.exitCode = 1;
  } else throw new Error("Expected discover, compile, validate, or replay");
}
main().catch((error) => {
  console.error(JSON.stringify(sanitize({ status: "failure", code: error instanceof CapabilityError ? error.code : "COMMAND_FAILED", message: error instanceof Error ? error.message : String(error), ...(error instanceof CapabilityError ? { details: error.details } : {}) })));
  process.exitCode = 1;
});
