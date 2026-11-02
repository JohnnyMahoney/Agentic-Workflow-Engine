import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { requestSchema } from "./evidence.js";
import { CapabilityError, validateInputs, type Inputs } from "./contract.js";
import { policySchema, testPolicy } from "../surfaces/playwright.js";

const args = process.argv.slice(2);
const flag = (name: string) => args[args.indexOf(name) + 1];
function required(name: string): string {
  if (!args.includes(name) || !flag(name)) throw new Error(`Missing ${name}`);
  return flag(name)!;
}
async function main(): Promise<void> {
  const command = args[0];
  const policy = args.includes("--policy") ? policySchema.parse(JSON.parse(readFileSync(required("--policy"), "utf8"))) : testPolicy;
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
    const result = await runDiscovery({ name: request.id, url: request.url, goal: `${goal}\nRead the relevant page text both before acting and after the final state appears.`, model: process.env.CLAUDE_MODEL ?? "claude-sonnet-5-5", headless: true, directory, compilationRequest: request, policy });
    if (!(result.assessment as { completed: boolean }).completed || Number(result.toolFailures) > 0) throw new Error(`Discovery did not complete cleanly; inspect ${directory}`);
    console.log(JSON.stringify({ status: "recorded", evidence: join(directory, "discovery-v2.json") }));
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
    const result = await replayCapability(required("--artifact"), inputs, directory, policy);
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== "success") process.exitCode = 1;
  } else throw new Error("Expected discover, compile, validate, or replay");
}
main().catch((error) => {
  console.error(JSON.stringify({ status: "failure", code: error instanceof CapabilityError ? error.code : "COMMAND_FAILED", message: error instanceof Error ? error.message : String(error), ...(error instanceof CapabilityError ? { details: error.details } : {}) }));
  process.exitCode = 1;
});
