import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const inputRef = z.object({ input: z.string().min(1) }).strict();
const rowTarget = z.object({ firstCell: inputRef }).strict();
const step = z.discriminatedUnion("action", [
  z.object({ id: z.string().min(1), action: z.literal("navigate"), url: z.url() }).strict(),
  z.object({ id: z.string().min(1), action: z.literal("readTableCell"), target: rowTarget.extend({ columnHeader: z.string().min(1) }), saveAs: z.string().min(1) }).strict(),
  z.object({ id: z.string().min(1), action: z.literal("clickRowLink"), target: rowTarget.extend({ role: z.literal("link"), name: z.string().min(1) }) }).strict(),
]);
const outputSource = z.union([z.object({ savedValue: z.string().min(1) }).strict(), z.object({ page: z.literal("url") }).strict()]);
const checkpoint = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("urlHash"), value: z.string().startsWith("#") }).strict(),
  z.object({ kind: z.literal("nonEmptyOutput"), output: z.string().min(1) }).strict(),
]);

export const artifactSchema = z.object({
  schemaVersion: z.literal("1.0"),
  inputs: z.record(z.string().min(1), z.object({ type: z.literal("string"), required: z.literal(true) }).strict()),
  steps: z.array(step).min(1),
  outputs: z.record(z.string().min(1), z.object({ type: z.literal("string"), source: outputSource }).strict()),
  checkpoints: z.array(checkpoint).min(1),
}).strict();

export type Artifact = z.infer<typeof artifactSchema>;

type Event = Record<string, unknown>;

function eventsFrom(path: string): { events: Event[]; sha256: string } {
  const raw = readFileSync(path, "utf8");
  return { events: raw.trim().split(/\r?\n/).map((line) => JSON.parse(line) as Event), sha256: createHash("sha256").update(raw).digest("hex") };
}

export function compileDiscovery(discoveryDir: string, outputDir: string): Artifact {
  const summary = JSON.parse(readFileSync(join(discoveryDir, "summary.json"), "utf8")) as Event;
  if ((summary.assessment as Event | undefined)?.passed !== true || summary.name !== "challenging") throw new Error("Discovery did not pass the Challenging DOM checks.");
  const source = join(discoveryDir, "events.jsonl");
  const { events, sha256 } = eventsFrom(source);
  const click = events.find((event) => event.kind === "before_execution" && event.name === "left_click");
  if (!click || typeof click.action !== "number") throw new Error("Discovery has no executed click.");
  const clickAction = click.action;
  const clicked = events.some((event) => event.kind === "outcome" && event.name === "left_click" && event.action === clickAction);
  const inspected = events.find((event) => event.kind === "pre_action_target" && event.action === clickAction)?.target as Event | undefined;
  const postClickUrl = events.find((event) => event.kind === "post_action_state" && event.action === clickAction)?.url;
  const navigate = events.find((event) => event.kind === "outcome" && event.name === "navigate" && typeof (event.result as Event | undefined)?.url === "string");
  const goal = events.find((event) => event.kind === "run_start")?.goal;
  if (!clicked || !inspected || typeof postClickUrl !== "string" || !navigate || typeof goal !== "string") throw new Error("Discovery lacks click, target, URL, navigation, or goal evidence.");
  const rowKey = inspected.rowFirstCell;
  const rowCells = inspected.rowCells;
  const headers = inspected.columnHeaders;
  const linkName = inspected.label;
  if (inspected.tag !== "a" || typeof rowKey !== "string" || !Array.isArray(rowCells) || !Array.isArray(headers) || typeof linkName !== "string") throw new Error("Clicked target is not an evidenced table link.");
  const column = goal.match(/read its ([\w]+) cell/i)?.[1];
  if (!column) throw new Error("Could not identify the requested column from the discovery goal.");
  const columnIndex = headers.findIndex((header) => header === column);
  const recordedValue = rowCells[columnIndex];
  if (columnIndex < 0 || typeof recordedValue !== "string" || !recordedValue || !String(summary.finalText).includes(recordedValue)) throw new Error("Discovery did not confirm the requested cell value.");
  const observedBeforeClick = events.some((event) => event.kind === "observation" && typeof event.action === "number" && event.action < clickAction && typeof event.text === "string" && event.text.includes(rowKey) && event.text.includes(recordedValue));
  if (!observedBeforeClick) throw new Error("No browser observation of the target row and value preceded the click.");
  const url = (navigate.result as Event).url as string;
  const parsedUrl = new URL(url);
  const observedUrl = new URL(postClickUrl);
  if (parsedUrl.protocol !== "https:" || parsedUrl.hostname !== "the-internet.herokuapp.com" || !observedUrl.hash || observedUrl.pathname !== parsedUrl.pathname) throw new Error("Discovery URL or post-click checkpoint is invalid.");

  const artifact = artifactSchema.parse({
    schemaVersion: "1.0",
    inputs: { rowKey: { type: "string", required: true } },
    steps: [
      { id: "open-page", action: "navigate", url },
      { id: "read-cell", action: "readTableCell", target: { firstCell: { input: "rowKey" }, columnHeader: column }, saveAs: "cellValue" },
      { id: "click-row-link", action: "clickRowLink", target: { firstCell: { input: "rowKey" }, role: "link", name: linkName } },
    ],
    outputs: { cellValue: { type: "string", source: { savedValue: "cellValue" } }, url: { type: "string", source: { page: "url" } } },
    checkpoints: [{ kind: "nonEmptyOutput", output: "cellValue" }, { kind: "urlHash", value: observedUrl.hash }],
  });
  validateArtifact(artifact);
  writeFileSync(join(outputDir, "artifact.json"), JSON.stringify(artifact, null, 2) + "\n");
  writeFileSync(join(outputDir, "artifact-build.json"), JSON.stringify({ source: source.replaceAll("\\", "/"), eventsSha256: sha256, discoveryAction: clickAction, discoveredRowKey: rowKey, discoveredValue: recordedValue, columnHeader: column, postClickUrl }, null, 2) + "\n");
  return artifact;
}

export function validateArtifact(artifact: Artifact): void {
  const ids = artifact.steps.map((item) => item.id);
  if (new Set(ids).size !== ids.length) throw new Error("Artifact step IDs must be unique.");
  const saved = new Set(artifact.steps.filter((item) => item.action === "readTableCell").map((item) => item.saveAs));
  for (const item of artifact.steps) {
    if (item.action !== "navigate" && !(item.target.firstCell.input in artifact.inputs)) throw new Error(`Unknown input: ${item.target.firstCell.input}`);
  }
  for (const [name, output] of Object.entries(artifact.outputs)) {
    if ("savedValue" in output.source && !saved.has(output.source.savedValue)) throw new Error(`Output ${name} refers to an unknown saved value.`);
  }
  for (const item of artifact.checkpoints) {
    if (item.kind === "nonEmptyOutput" && !(item.output in artifact.outputs)) throw new Error(`Checkpoint refers to an unknown output: ${item.output}`);
  }
}
