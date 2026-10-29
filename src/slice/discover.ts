import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { runDiscovery } from "../discovery/run.js";
import { scenarios } from "../discovery/test-targets.js";
import { compileDiscovery } from "./artifact.js";

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is required for genuine discovery.");
  if (!existsSync(chromium.executablePath())) throw new Error("Playwright Chromium is missing. Run: npx.cmd playwright install chromium");
  const directory = join("evidence", "vertical-slice", new Date().toISOString().replace(/[:.]/g, "-"));
  mkdirSync(directory, { recursive: true });
  const summary = await runDiscovery({ name: "challenging", ...scenarios.challenging, model: "claude-sonnet-5-5", headless: true, directory: join(directory, "discovery", "challenging") });
  if ((summary.assessment as { passed?: boolean }).passed !== true) throw new Error(`Discovery did not pass. Inspect ${join(directory, "discovery", "challenging", "summary.json")}`);
  const artifact = compileDiscovery(join(directory, "discovery", "challenging"), directory);
  console.log(JSON.stringify({ directory, artifactPath: join(directory, "artifact.json"), steps: artifact.steps.length, discoveryPassed: true }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
