import { chromium, type Browser, type Frame, type Locator, type Page } from "playwright";
import { CapabilityError, valueOf, actionNames, targetSchema, valueSchema, type Inputs, type Strategy, type Target, type ExtractProperty } from "../capability/contract.js";
import { z } from "zod";
import type { SurfaceAdapter } from "./adapter.js";

const detectorSchema = z.object({ code: z.string().min(1), status: z.enum(["BUSINESS_OUTCOME", "HARD_FAILURE", "RECOVERABLE_ERROR"]), target: targetSchema, value: valueSchema, resolvesMutations: z.array(z.string().min(1)).optional() }).strict();
export interface Policy { origins: string[]; actions: string[]; detectors?: z.infer<typeof detectorSchema>[] | undefined }
export const policySchema = z.object({
  origins: z.array(z.url().refine((value) => { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && url.origin === value; }, "Use an exact HTTP(S) origin without a path")).min(1),
  actions: z.array(z.enum(actionNames)).min(1),
  detectors: z.array(detectorSchema).optional(),
}).strict();
export const testPolicy: Policy = { origins: ["https://the-internet.herokuapp.com"], actions: ["navigate", "click", "fill", "selectOption", "extract", "wait", "assert"] };
export function checkUrl(url: string, policy: Policy): void {
  if (!policy.origins.includes(new URL(url).origin)) throw new CapabilityError("POLICY_DENIED", "Origin is not allowed");
}
export async function strategyLocator(root: Page | Frame, strategy: Strategy, inputs: Inputs): Promise<Locator> {
  let frame: Page | Frame = root;
  for (const selector of strategy.frames) {
    const element = frame.locator(selector);
    const count = await element.count();
    if (count !== 1) throw new CapabilityError(count ? "AMBIGUOUS_TARGET" : "TARGET_NOT_FOUND", "Frame selector must match exactly one element", { count });
    const handle = await element.elementHandle();
    const child = await handle?.contentFrame();
    if (!child) throw new CapabilityError("INVALID_TARGET", "Selected element is not a loaded frame");
    frame = child;
  }
  let scope: Locator | Page | Frame = frame;
  if (strategy.scope) {
    let container = frame.locator(strategy.scope.css);
    if (strategy.scope.has) {
      const filter = strategy.scope.has;
      const text = valueOf(filter.text, inputs);
      // Exact normalized descendant text, without interpolating input into CSS.
      const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      container = container.filter({ has: frame.locator(filter.css).filter({ hasText: new RegExp(`^\\s*${escaped}\\s*$`) }) });
    }
    scope = container;
  }
  return strategy.kind === "role" ? scope.getByRole(strategy.role, { name: valueOf(strategy.name, inputs), exact: true }) : scope.locator(strategy.selector);
}
export async function resolveTarget(root: Page | Frame, target: Target, inputs: Inputs): Promise<Locator> {
  let selected: Locator | undefined;
  for (const strategy of target.strategies) {
    const locator = await strategyLocator(root, strategy, inputs);
    const count = await locator.count();
    if (count > 1) throw new CapabilityError("AMBIGUOUS_TARGET", "Locator matches multiple elements", { count });
    if (count === 1) {
      if (selected) {
        const handle = await selected.elementHandle();
        const same = await locator.evaluate((element, other) => element === other, handle);
        if (!same) throw new CapabilityError("CONFLICTING_TARGETS", "Strategies identify different elements");
      }
      selected = locator;
    }
  }
  if (!selected) throw new CapabilityError("TARGET_NOT_FOUND", "No strategy resolved the target");
  return selected;
}
export class PlaywrightAdapter implements SurfaceAdapter {
  private dialogMessage: string | undefined;
  constructor(readonly browser: Browser, readonly page: Page, readonly inputs: Inputs, readonly policy: Policy) {
    page.on("dialog", (dialog) => { this.dialogMessage = `${dialog.type()}: ${dialog.message()}`; void dialog.dismiss().catch(() => {}); });
  }
  setOperationTimeout(timeoutMs: number): void { this.page.setDefaultTimeout(timeoutMs); this.page.setDefaultNavigationTimeout(timeoutMs); }
  unexpectedDialog(): string | undefined { return this.dialogMessage; }
  static async launch(inputs: Inputs, policy: Policy = testPolicy): Promise<PlaywrightAdapter> {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    await context.route("**/*", (route) => {
      try { checkUrl(route.request().url(), policy); return route.continue(); } catch { return route.abort(); }
    });
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    return new PlaywrightAdapter(browser, page, inputs, policy);
  }
  async navigate(url: string): Promise<void> {
    checkUrl(url, this.policy);
    const response = await this.page.goto(url, { waitUntil: "load" });
    checkUrl(this.page.url(), this.policy);
    if (!response?.ok()) throw new CapabilityError("NAVIGATION_FAILED", "Navigation did not return success", { status: response?.status() });
  }
  async click(target: Target): Promise<void> { await (await resolveTarget(this.page, target, this.inputs)).click(); }
  async fill(target: Target, value: string): Promise<void> { await (await resolveTarget(this.page, target, this.inputs)).fill(value); }
  async selectOption(target: Target, by: "label" | "value", value: string): Promise<void> {
    const locator = await resolveTarget(this.page, target, this.inputs);
    if (await locator.evaluate((element) => element.tagName.toLowerCase()) !== "select") throw new CapabilityError("INVALID_TARGET", "selectOption target must be a native select");
    await locator.selectOption({ [by]: value });
  }
  async extract(target: Target, property: ExtractProperty = "text"): Promise<string> {
    const locator = await resolveTarget(this.page, target, this.inputs);
    if (property === "text") return (await locator.innerText()).trim();
    const selection = await locator.evaluate(element => element instanceof HTMLSelectElement ? {multiple: element.multiple, labels: Array.from(element.selectedOptions, option => option.label.trim())} : null);
    if (!selection || !await locator.isVisible()) throw new CapabilityError("INVALID_TARGET", "selectedOptionLabel requires a visible native select");
    if (selection.multiple || selection.labels.length !== 1) throw new CapabilityError("INVALID_SELECTION", "selectedOptionLabel requires exactly one selected option in a single select");
    return selection.labels[0]!;
  }
  async visible(target: Target): Promise<boolean> { return (await resolveTarget(this.page, target, this.inputs)).isVisible(); }
  url(): string { return this.page.url(); }
  async captureFailure(path: string): Promise<void> { await this.page.screenshot({ path }); }
  async close(): Promise<void> { await this.browser.close(); }
}
