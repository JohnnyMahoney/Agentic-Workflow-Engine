import { chromium, type Browser, type Frame, type Locator, type Page, type CDPSession } from "playwright";
import { CapabilityError, valueOf, actionNames, targetSchema, valueSchema, type Inputs, type Strategy, type Target, type ExtractProperty } from "../capability/contract.js";
import { z } from "zod";
import { routeSchema, operationSchema, privacySchema, checkDestination, enforceOperation, installNetworkPolicy, type SafetyPolicy } from "../safety/policy.js";
import { writeFileSync, sanitize, learnPageSecrets } from "../safety/persistence.js";
import { captureSnapshot } from "../capability/evidence.js";
import type { SurfaceAdapter } from "./adapter.js";

const detectorSchema = z.object({ code: z.string().min(1), status: z.enum(["BUSINESS_OUTCOME", "HARD_FAILURE", "RECOVERABLE_ERROR"]), target: targetSchema, value: valueSchema, resolvesMutations: z.array(z.string().min(1)).optional() }).strict();
const humanBlockerSchema = z.object({url: z.url(), container: z.string().min(1), dismiss: z.string().min(1)}).strict();
// Installed before application scripts. A declared blocker cannot be dismissed
// during model thinking time, before request_human has reached the CLI pause.
export function installHumanBlockerGuard(rules: {url: string; container: string}[]): void {
  const host = window as typeof window & {__capabilityHumanOwner?: boolean};
  for (const name of ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "keydown", "keyup", "keypress", "beforeinput", "submit", "touchstart", "touchend", "paste", "drop"]) {
    window.addEventListener(name, event => {
      if (host.__capabilityHumanOwner === true) return;
      if (!rules.some(rule => rule.url === location.href && document.querySelector(rule.container))) return;
      event.preventDefault(); event.stopImmediatePropagation();
    }, {capture: true, passive: false});
  }
}
function installInputGuard(enabled: boolean): void {
  const host = window as typeof window & {__capabilityInputGuard?: {enabled: boolean}};
  if (host.__capabilityInputGuard) { host.__capabilityInputGuard.enabled = enabled; return; }
  const state = host.__capabilityInputGuard = {enabled};
  for (const name of ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "auxclick", "contextmenu", "keydown", "keyup", "keypress", "beforeinput", "input", "change", "submit", "touchstart", "touchend", "wheel", "paste", "cut", "drop", "dragstart"]) {
    window.addEventListener(name, event => {
      if (state.enabled) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, {capture: true, passive: false});
  }
}
export interface Policy extends SafetyPolicy { detectors?: z.infer<typeof detectorSchema>[] | undefined; humanBlockers?: z.infer<typeof humanBlockerSchema>[] | undefined }
export const policySchema = z.object({
  origins: z.array(z.url().refine((value) => { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && url.origin === value; }, "Use an exact HTTP(S) origin without a path")).min(1),
  actions: z.array(z.enum(actionNames)).min(1),
  detectors: z.array(detectorSchema).optional(),
  humanBlockers: z.array(humanBlockerSchema).max(10).optional(),
  routes: z.array(routeSchema).optional(),
  operations: z.array(operationSchema).optional(),
  privacy: privacySchema.optional(),
}).strict();
export const testPolicy: Policy = { origins: ["https://the-internet.herokuapp.com"], routes: ["/*"], operations: [], privacy: {dataClass: "synthetic", sensitiveInputs: [], sensitiveSelectors: [], secretEnv: []}, actions: ["navigate", "click", "fill", "selectOption", "extract", "wait", "assert"] };
export function checkUrl(url: string, policy: Policy): void {
  checkDestination(url, policy);
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
  private humanRecorder: ((event: Record<string, unknown>) => void) | undefined;
  private humanHooksInstalled = false;
  private inputControl: CDPSession | undefined;
  private inputGuardInstalled = false;
  private humanInputEnabled = true;
  private checkNetwork = () => {};
  constructor(readonly browser: Browser, readonly page: Page, readonly inputs: Inputs, readonly policy: Policy) {
    page.on("dialog", (dialog) => { this.dialogMessage = `${dialog.type()}: ${dialog.message()}`; void dialog.dismiss().catch(() => {}); });
  }
  setOperationTimeout(timeoutMs: number): void { this.page.setDefaultTimeout(timeoutMs); this.page.setDefaultNavigationTimeout(timeoutMs); }
  unexpectedDialog(): string | undefined { return this.dialogMessage; }
  static async launch(inputs: Inputs, policy: Policy = testPolicy, options: { headless?: boolean } = {}): Promise<PlaywrightAdapter> {
    const browser = await chromium.launch({ headless: options.headless ?? true });
    const context = await browser.newContext({serviceWorkers: "block"});
    await context.addInitScript(installHumanBlockerGuard, policy.humanBlockers ?? []);
    const checkNetwork = await installNetworkPolicy(context, policy);
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    const adapter = new PlaywrightAdapter(browser, page, inputs, policy);
    adapter.checkNetwork = checkNetwork;
    return adapter;
  }
  async navigate(url: string): Promise<void> {
    checkUrl(url, this.policy);
    let response;
    try { response = await this.page.goto(url, { waitUntil: "load" }); } catch (error) { this.checkNetwork(); throw error; }
    this.checkNetwork();
    checkUrl(this.page.url(), this.policy);
    if (!response?.ok()) throw new CapabilityError("NAVIGATION_FAILED", "Navigation did not return success", { status: response?.status() });
  }
  async click(target: Target): Promise<void> { const locator = await resolveTarget(this.page, target, this.inputs); await enforceOperation(this.page, locator, "click", this.policy); await locator.click(); this.checkNetwork(); }
  async authorize(action: "click" | "fill" | "selectOption", target: Target): Promise<void> {
    await enforceOperation(this.page, await resolveTarget(this.page, target, this.inputs), action, this.policy);
  }
  async fill(target: Target, value: string): Promise<void> { const locator = await resolveTarget(this.page, target, this.inputs); await enforceOperation(this.page, locator, "fill", this.policy); await locator.fill(value); this.checkNetwork(); }
  async selectOption(target: Target, by: "label" | "value", value: string): Promise<void> {
    await enforceOperation(this.page, await resolveTarget(this.page, target, this.inputs), "selectOption", this.policy);
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
  async captureFailure(path: string): Promise<void> {
    await learnPageSecrets(this.page);
    writeFileSync(path + ".json", JSON.stringify({kind: "sanitized-dom-diagnostic", screenshotOmitted: true, snapshot: sanitize(await captureSnapshot(this.page))}, null, 2));
    throw new CapabilityError("UNSAFE_IMAGE_OMITTED", "Screenshot omitted; sanitized DOM diagnostic saved", {diagnostic: path + ".json"});
  }
  isClosed(): boolean { return this.page.isClosed() || !this.browser.isConnected(); }
  async setHumanInputEnabled(enabled: boolean): Promise<void> {
    this.humanInputEnabled = enabled;
    if (!this.inputGuardInstalled) {
      // CDP alone is not a sufficient gate for physical desktop input.
      // Capture events without modifying DOM/snapshots used by evidence validation.
      await this.page.addInitScript(installInputGuard, false);
      this.page.on("framenavigated", frame => {
        void frame.evaluate(installInputGuard, this.humanInputEnabled).catch(() => {});
      });
      this.inputGuardInstalled = true;
    }
    await Promise.all(this.page.frames().map(frame => frame.evaluate(installInputGuard, enabled)));
    this.inputControl ??= await this.page.context().newCDPSession(this.page);
    await this.inputControl.send("Input.setIgnoreInputEvents", {ignore: !enabled});
  }
  async observeHuman(record: (event: Record<string, unknown>) => void): Promise<() => Promise<void>> {
    if (this.page.isClosed()) throw new CapabilityError("HANDOFF_UNRESOLVED", "Browser page is closed");
    if (!this.humanHooksInstalled) {
      await this.page.exposeBinding("__replayHumanEvent", (source, event: {kind?: unknown; tag?: unknown; inputType?: unknown; path?: unknown; trusted?: unknown}) => {
        if (!event || !["click", "input", "change", "submit"].includes(String(event.kind))) return;
        // No typed values, key presses, text, element IDs or URL query strings.
        const path = typeof event.path === "string" && /^[a-z0-9:()> -]*$/.test(event.path) ? event.path.slice(0, 512) : "";
        this.humanRecorder?.({action: event.kind, tag: String(event.tag).slice(0, 20), inputType: String(event.inputType).slice(0, 20), targetPath: path, trusted: event.trusted === true, frameIndex: this.page.frames().indexOf(source.frame), mainFrame: source.frame === this.page.mainFrame()});
      });
      const install = () => {
        for (const kind of ["click", "input", "change", "submit"]) document.addEventListener(kind, event => {
          const target = event.target;
          const parts: string[] = [];
          for (let node = target instanceof Element ? target : null; node && parts.length < 8; node = node.parentElement) {
            const position = node.parentElement ? Array.from(node.parentElement.children).filter(other => other.tagName === node!.tagName).indexOf(node) + 1 : 1;
            parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${position})`);
          }
          const emit = (window as unknown as {__replayHumanEvent: (event: unknown) => Promise<void>}).__replayHumanEvent;
          void emit({kind, tag: target instanceof Element ? target.tagName : "", inputType: target instanceof HTMLInputElement ? target.type : "", path: parts.join(" > "), trusted: event.isTrusted}).catch(() => {});
        }, true);
      };
      await this.page.addInitScript(install);
      for (const frame of this.page.frames()) await frame.evaluate(install);
      this.page.on("framenavigated", frame => { this.humanRecorder?.({action: "navigation", mainFrame: frame === this.page.mainFrame()}); });
      this.humanHooksInstalled = true;
    }
    this.humanRecorder = record;
    await Promise.all(this.page.frames().map(frame => frame.evaluate(() => {
      (window as typeof window & {__capabilityHumanOwner?: boolean}).__capabilityHumanOwner = true;
    })));
    // A native dialog was dismissed by the existing handler. The human now owns
    // remediation; any subsequent dialog will be observed afresh.
    this.dialogMessage = undefined;
    await this.page.bringToFront();
    return async () => {
      this.humanRecorder = undefined;
      await Promise.all(this.page.frames().map(frame => frame.evaluate(() => {
        (window as typeof window & {__capabilityHumanOwner?: boolean}).__capabilityHumanOwner = false;
      }).catch(() => {})));
    };
  }
  async close(): Promise<void> { await this.browser.close(); }
}
