import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, errors, type Browser, type Locator, type Page } from "playwright";
import { artifactSchema, validateArtifact, type Artifact } from "./artifact.js";

type ReplayResult = {
  status: "success" | "not_found" | "failure";
  sessionId: string;
  inputs: Record<string, string>;
  outputs?: Record<string, string>;
  stepId?: string;
  category?: "business_outcome" | "recoverable" | "hard_failure";
  message?: string;
};

class RowNotFound extends Error {}

function journal(directory: string, kind: string, fields: Record<string, unknown>): void {
  appendFileSync(join(directory, "events.jsonl"), JSON.stringify({ at: new Date().toISOString(), kind, ...fields }) + "\n");
}

function rowFor(page: Page, key: string): Locator {
  return page.locator("table tbody tr").filter({ has: page.locator("td:first-child").getByText(key, { exact: true }) });
}

async function uniqueRow(page: Page, key: string): Promise<Locator> {
  const row = rowFor(page, key);
  const count = await row.count();
  if (count === 0) throw new RowNotFound(`No table row with first cell ${JSON.stringify(key)}.`);
  if (count !== 1) throw new Error(`Expected one row with first cell ${JSON.stringify(key)}, found ${count}.`);
  return row;
}

function outputValues(artifact: Artifact, saved: Record<string, string>, page: Page): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [name, spec] of Object.entries(artifact.outputs)) {
    values[name] = "savedValue" in spec.source ? saved[spec.source.savedValue] ?? "" : page.url();
  }
  return values;
}

export async function runReplay(artifactPath: string, inputs: Record<string, string>, directory: string): Promise<ReplayResult> {
  mkdirSync(directory, { recursive: true });
  const artifact = artifactSchema.parse(JSON.parse(readFileSync(artifactPath, "utf8")));
  validateArtifact(artifact);
  for (const name of Object.keys(artifact.inputs)) {
    if (typeof inputs[name] !== "string" || !inputs[name]?.trim()) throw new Error(`Required input ${name} is missing.`);
  }
  for (const name of Object.keys(inputs)) {
    if (!(name in artifact.inputs)) throw new Error(`Unknown input: ${name}`);
  }
  writeFileSync(join(directory, "events.jsonl"), "");
  const sessionId = crypto.randomUUID();
  const saved: Record<string, string> = {};
  let stepId = "startup";
  journal(directory, "replay_start", { sessionId, artifactPath, schemaVersion: artifact.schemaVersion, inputs, llmCalls: 0 });
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      return url.protocol === "https:" && url.hostname === "the-internet.herokuapp.com" ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    for (const step of artifact.steps) {
      stepId = step.id;
      journal(directory, "step_start", { stepId, action: step.action });
      if (step.action === "navigate") {
        const url = new URL(step.url);
        if (url.protocol !== "https:" || url.hostname !== "the-internet.herokuapp.com") throw new Error(`Navigation blocked: ${step.url}`);
        const response = await page.goto(step.url, { waitUntil: "load", timeout: 30000 });
        if (!response?.ok()) throw new Error(`Navigation returned HTTP ${response?.status() ?? "unknown"}.`);
        journal(directory, "step_end", { stepId, url: page.url(), status: response.status() });
      } else if (step.action === "readTableCell") {
        const rowKey = inputs[step.target.firstCell.input]!;
        const row = await uniqueRow(page, rowKey);
        const headers = (await page.locator("table thead th").allTextContents()).map((value) => value.trim());
        const columnIndex = headers.indexOf(step.target.columnHeader);
        if (columnIndex < 0 || headers.indexOf(step.target.columnHeader, columnIndex + 1) >= 0) throw new Error(`Column header ${JSON.stringify(step.target.columnHeader)} is missing or ambiguous.`);
        const cell = row.locator("td").nth(columnIndex);
        if (await cell.count() !== 1) throw new Error(`Column ${JSON.stringify(step.target.columnHeader)} is missing in the row.`);
        saved[step.saveAs] = (await cell.innerText()).trim();
        journal(directory, "step_end", { stepId, rowKey, columnHeader: step.target.columnHeader, value: saved[step.saveAs] });
      } else {
        const rowKey = inputs[step.target.firstCell.input]!;
        const row = await uniqueRow(page, rowKey);
        const link = row.getByRole(step.target.role, { name: step.target.name, exact: true });
        if (await link.count() !== 1) throw new Error(`Expected one ${step.target.name} link in row ${rowKey}.`);
        journal(directory, "before_click", { stepId, rowKey, linkName: step.target.name });
        await link.click();
        journal(directory, "step_end", { stepId, url: page.url() });
      }
    }
    stepId = "checkpoints";
    const outputs = outputValues(artifact, saved, page);
    for (const checkpoint of artifact.checkpoints) {
      const passed = checkpoint.kind === "urlHash" ? new URL(page.url()).hash === checkpoint.value : Boolean(outputs[checkpoint.output]?.trim());
      journal(directory, "checkpoint", { checkpoint, passed });
      if (!passed) throw new Error(`Checkpoint ${checkpoint.kind} failed.`);
    }
    writeFileSync(join(directory, "screenshot.png"), await page.screenshot());
    const result: ReplayResult = { status: "success", sessionId, inputs, outputs };
    writeFileSync(join(directory, "result.json"), JSON.stringify(result, null, 2) + "\n");
    journal(directory, "replay_end", result);
    await context.close();
    return result;
  } catch (error) {
    const result: ReplayResult = {
      status: error instanceof RowNotFound ? "not_found" : "failure",
      sessionId,
      inputs,
      stepId,
      category: error instanceof RowNotFound ? "business_outcome" : error instanceof errors.TimeoutError ? "recoverable" : "hard_failure",
      message: error instanceof Error ? error.message : String(error),
    };
    writeFileSync(join(directory, "result.json"), JSON.stringify(result, null, 2) + "\n");
    journal(directory, "replay_end", result);
    return result;
  } finally {
    if (browser) await browser.close();
  }
}

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

function inputFlags(): Record<string, string> {
  const inputs: Record<string, string> = {};
  for (let index = 0; index < process.argv.length; index++) {
    if (process.argv[index] !== "--input") continue;
    const pair = process.argv[index + 1] ?? "";
    const equal = pair.indexOf("=");
    if (equal <= 0) throw new Error(`Invalid input ${JSON.stringify(pair)}; expected name=value.`);
    const name = pair.slice(0, equal);
    if (name in inputs) throw new Error(`Duplicate input: ${name}`);
    inputs[name] = pair.slice(equal + 1);
  }
  return inputs;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const artifactPath = flag("--artifact");
  const outputDir = flag("--out");
  if (!artifactPath || !outputDir || !process.argv.includes("--input")) {
    console.error("Usage: npm run slice:replay -- --artifact PATH --input name=value --out DIRECTORY");
    process.exitCode = 1;
  } else {
    Promise.resolve().then(inputFlags).then((inputs) => runReplay(artifactPath, inputs, outputDir)).then((result) => {
      console.log(JSON.stringify(result, null, 2));
      if (result.status === "failure") process.exitCode = 1;
    }).catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
  }
}
