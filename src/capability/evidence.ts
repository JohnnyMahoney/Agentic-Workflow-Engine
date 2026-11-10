import { z } from "zod";
import type { Page } from "playwright";
import { inputSchema } from "./contract.js";

export const requestSchema = z.object({
  id: z.string().min(1), goal: z.string().min(1), url: z.url(),
  // This slice captures DOM only on public demo pages or synthetic local fixtures.
  dataMode: z.enum(["public-test", "synthetic-test"]),
  inputs: z.record(z.string(), inputSchema),
  bindings: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  outputs: z.record(z.string(), z.object({ type: z.literal("string"), description: z.string().min(1) }).strict()),
}).strict();
export type CompilationRequest = z.infer<typeof requestSchema>;
export interface NodeFacts { text: string; visible: boolean; selectedOption?: { label: string; value: string } }
export interface FrameSnapshot { id: number; parent: number | null; elementNode: string | null; html: string; nodes: Record<string, NodeFacts> }
export interface Snapshot { url: string; frames: FrameSnapshot[] }
export interface RecordedAction {
  index: number; name: string; before: Snapshot; after: Snapshot;
  target: { frame: number; node: string } | null;
  input: Record<string, unknown>; observation?: string; success: boolean;
  failure?: { phase: "beforeDispatch" | "unknown"; code: string };
}
export interface DiscoveryEvidence {
  evidenceVersion: "2.0"; request: CompilationRequest; completed: boolean; modelCompleted?: boolean; actions: RecordedAction[];
  interventions?: DiscoveryIntervention[];
}
export interface DiscoveryIntervention {
  id: string; source: "model" | "driver"; reason: string; description: string;
  afterAction: number; outcome: "pending" | "resumed" | "aborted" | "unresolved";
  before: Snapshot; after?: Snapshot; humanActions: Record<string, unknown>[];
}

export async function captureSnapshot(page: Page): Promise<Snapshot> {
  const frames = page.frames();
  const snapshots: FrameSnapshot[] = [];
  for (const [id, frame] of frames.entries()) {
    const captured = await frame.evaluate(() => {
      let counter = 0;
      const nodes: Record<string, NodeFacts> = {};
      for (const element of document.querySelectorAll("*")) {
        const node = `n${++counter}`;
        element.setAttribute("data-cap-node", node);
        const html = element as HTMLElement;
        const style = getComputedStyle(element);
        const selected = element instanceof HTMLSelectElement ? element.selectedOptions[0] : undefined;
        nodes[node] = { text: element.matches("input, textarea, script, style") ? "" : (html.innerText ?? "").trim(), visible: Boolean(element.getClientRects().length) && style.visibility !== "hidden" && style.display !== "none", ...(selected ? { selectedOption: { label: selected.label.trim(), value: selected.value } } : {}) };
      }
      const clone = document.documentElement.cloneNode(true) as HTMLElement;
      const originalSelects = document.querySelectorAll("select");
      const clonedSelects = clone.querySelectorAll("select");
      originalSelects.forEach((select, index) => {
        const options = clonedSelects[index]?.querySelectorAll("option") ?? [];
        options.forEach((option, optionIndex) => {
          if (select.options[optionIndex]?.selected) option.setAttribute("selected", "");
          else option.removeAttribute("selected");
        });
      });
      for (const element of clone.querySelectorAll("script, noscript, link[rel=preload], meta[http-equiv]")) element.remove();
      for (const element of clone.querySelectorAll("*")) {
        for (const attribute of Array.from(element.attributes)) {
          if (/^on/i.test(attribute.name) || /token|secret|password|authorization|cookie/i.test(attribute.name)) element.removeAttribute(attribute.name);
        }
        if (element.matches("input, textarea")) { element.removeAttribute("value"); element.textContent = ""; }
        if (element.matches("iframe, frame")) { element.removeAttribute("src"); element.removeAttribute("srcdoc"); }
      }
      return { html: "<!doctype html>" + clone.outerHTML, nodes };
    });
    const parent = frame.parentFrame();
    const elementNode = parent ? await (await frame.frameElement()).getAttribute("data-cap-node") : null;
    snapshots.push({ id, parent: parent ? frames.indexOf(parent) : null, elementNode, ...captured });
  }
  return { url: page.url(), frames: snapshots };
}
