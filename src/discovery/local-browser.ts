import { BetaAbstractBrowserToolset20260801, ToolError } from "@anthropic-ai/sdk/helpers/beta/toolsets";
import type { BetaBrowserMemberResult, BetaToolsetCallContext } from "@anthropic-ai/sdk/helpers/beta/toolsets";
import type { BetaBrowserClickTarget, BetaBrowserGetPageTextInput, BetaBrowserLeftClickInput, BetaBrowserMemberInput, BetaBrowserMemberName, BetaBrowserNavigateInput, BetaBrowserReadPageInput, BetaBrowserScreenshotInput, BetaBrowserWaitInput } from "@anthropic-ai/sdk/resources/beta";
import { chromium, type Browser, type BrowserContext, type Frame, type Page } from "playwright";
import { checkUrl, testPolicy, PlaywrightAdapter, installHumanBlockerGuard, type Policy } from "../surfaces/playwright.js";
import { BeforeDispatchError } from "./failures.js";
import { enforceOperation, installNetworkPolicy } from "../safety/policy.js";
import { learnPageSecrets } from "../safety/persistence.js";
import { captureSnapshot } from "../capability/evidence.js";
import { CapabilityError } from "../capability/contract.js";

export class LocalPlaywrightBrowser extends BetaAbstractBrowserToolset20260801 {
  onExecute?: (context: BetaToolsetCallContext, name: BetaBrowserMemberName, input: BetaBrowserMemberInput, run: () => Promise<BetaBrowserMemberResult>) => Promise<BetaBrowserMemberResult>;
  private readonly refs = new Map<string, Frame>();
  private nextRef = 0;
  private handoffAdapter: PlaywrightAdapter | undefined;
  private checkNetwork = () => {};
  async isHumanOnlyTarget(target: BetaBrowserClickTarget): Promise<boolean> {
    for (const rule of this.policy.humanBlockers ?? []) {
      if (rule.url !== this.page.url()) continue;
      const container = this.page.locator(rule.container);
      if (await container.count() !== 1) continue;
      if (target.type === "coordinate") {
        if (await container.evaluate((root, point) => root.contains(document.elementFromPoint(point.x, point.y)), target)) return true;
      } else {
        const frame = this.refs.get(target.ref);
        if (frame !== this.page.mainFrame()) continue;
        const element = await frame.locator(`[data-browser-ref="${target.ref}"]`).elementHandle();
        if (element && await container.evaluate((root, candidate) => root.contains(candidate), element)) return true;
      }
    }
    return false;
  }

  handoffSurface(): PlaywrightAdapter {
    return this.handoffAdapter ??= new PlaywrightAdapter(this.browser, this.page, {}, this.policy);
  }
  async refreshAfterHuman(): Promise<string> {
    this.refs.clear();
    for (const frame of this.page.frames()) await frame.locator("[data-browser-ref]").evaluateAll(elements => elements.forEach(element => element.removeAttribute("data-browser-ref")));
    return this.get_page_text({} as BetaToolsetCallContext, {tab_id: "tab-1"});
  }

  protected constructor(private readonly browser: Browser, private readonly context: BrowserContext, readonly page: Page, private readonly policy: Policy) {
    super({
      browserState: async () => ({ tabs: [{ tab_id: "tab-1", title: await page.title(), url: page.url(), active: true }] }),
      urlPolicy: (_context, url) => {
        if (["back", "forward", "reload"].includes(url)) return;
        const parsed = new URL(url.includes("://") ? url : `https://${url}`);
        checkUrl(parsed.href, policy);
      },
      // Enable only the browser members supported by this web discovery driver.
      configs: Object.fromEntries([
        "zoom", "right_click", "middle_click", "double_click", "triple_click", "hover", "left_click_drag",
        "left_mouse_down", "left_mouse_up", "mouse_move", "scroll", "scroll_to", "type", "key", "hold_key",
        "find", "file_upload", "read_console", "read_network", "javascript_exec",
        "new_tab", "list_tabs", "switch_tab", "close_tab",
      ].map((name) => [name, { enabled: false }])),
    });
  }

  static async launch(headless: boolean, policy: Policy = testPolicy): Promise<LocalPlaywrightBrowser> {
    const browser = await chromium.launch({ headless });
    try {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: "block" });
      await context.addInitScript(installHumanBlockerGuard, policy.humanBlockers ?? []);
      const checkNetwork = await installNetworkPolicy(context, policy);
      const page = await context.newPage();
      const driver = new LocalPlaywrightBrowser(browser, context, page, policy);
      driver.checkNetwork = checkNetwork;
      return driver;
    } catch (error) {
      await browser.close();
      throw error;
    }
  }

  override async close(): Promise<void> {
    await super.close();
    await this.context.close();
    await this.browser.close();
  }

  protected override async execute(context: BetaToolsetCallContext, name: BetaBrowserMemberName, input: BetaBrowserMemberInput): Promise<BetaBrowserMemberResult> {
    const action = name === "left_click" ? "click" : name === "form_input" ? "fill" : ["read_page", "get_page_text", "screenshot"].includes(name) ? "extract" : name;
    this.checkNetwork();
    if (name !== "form_input" && ["navigate", "click", "fill", "wait", "extract"].includes(action) && !this.policy.actions.includes(action)) throw new CapabilityError("POLICY_DENIED", "Action type is not allowed");
    const run = () => super.execute(context, name, input);
    return this.onExecute ? this.onExecute(context, name, input, run) : run();
  }

  protected override async navigate(_context: BetaToolsetCallContext, input: BetaBrowserNavigateInput) {
    this.checkTab(input.tab_id);
    this.refs.clear();
    const url = input.url;
    if (!['back','forward','reload'].includes(url)) checkUrl(url.includes("://") ? url : `https://${url}`, this.policy);
    let response;
    try { response = url === "back" ? await this.page.goBack() : url === "forward" ? await this.page.goForward() : url === "reload" ? await this.page.reload() : await this.page.goto(url.includes("://") ? url : `https://${url}`, { waitUntil: "load" }); }
    catch (error) { this.checkNetwork(); throw error; }
    this.checkNetwork(); checkUrl(this.page.url(), this.policy);
    await learnPageSecrets(this.page);
    return { url: this.page.url(), title: await this.page.title(), status: response?.status() };
  }

  protected override async read_page(_context: BetaToolsetCallContext, input: BetaBrowserReadPageInput): Promise<string> {
    this.checkTab(input.tab_id);
    this.refs.clear();
    const parts: string[] = [];
    for (const frame of this.page.frames()) {
      const frameId = `frame-${parts.length + 1}`;
      try {
        if (await frame.locator("body").count() === 0) continue;
        const body = await frame.locator("body").innerText({ timeout: 5000 });
        const controls = await frame.locator("a, button, input, select, textarea, [role=button], [role=link]").evaluateAll((elements) => elements.map((element) => {
          const html = element as HTMLElement;
          const label = (html.innerText || html.getAttribute("aria-label") || html.getAttribute("value") || "").trim();
          const row = html.closest("tr")?.innerText.replace(/\s+/g, " ").trim() ?? "";
          return { label, row, tag: html.tagName.toLowerCase(), visible: Boolean(html.getClientRects().length) };
        }));
        const lines = [`${frameId} ${frame.url()}`, body.slice(0, 25000)];
        for (let index = 0; index < controls.length; index++) {
          const control = controls[index]!;
          if (!control.visible || (input.filter === "interactive" && !control.label)) continue;
          const ref = `ref_${++this.nextRef}`;
          await frame.locator("a, button, input, select, textarea, [role=button], [role=link]").nth(index).evaluate((element, id) => element.setAttribute("data-browser-ref", id), ref);
          this.refs.set(ref, frame);
          const role = control.tag === "a" ? "link" : control.tag === "button" ? "button" : control.tag;
          lines.push(`${role} "${control.label}" [${ref}]${control.row ? ` row "${control.row}"` : ""}`);
        }
        parts.push(lines.join("\n"));
      } catch (error) {
        parts.push(`${frameId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return parts.join("\n\n").slice(0, 50000);
  }

  protected override async get_page_text(_context: BetaToolsetCallContext, input: BetaBrowserGetPageTextInput): Promise<string> {
    this.checkTab(input.tab_id);
    const parts: string[] = [];
    for (const frame of this.page.frames()) {
      try { parts.push(`${frame.url()}\n${await frame.locator("body").innerText({ timeout: 5000 })}`); }
      catch { /* A frame may be navigating; the next read can retry. */ }
    }
    return parts.join("\n\n").slice(0, 50000);
  }

  protected override async left_click(_context: BetaToolsetCallContext, input: BetaBrowserLeftClickInput): Promise<void> {
    this.checkTab(input.tab_id);
    if (!this.policy.actions.includes("click")) throw new CapabilityError("POLICY_DENIED", "Click is not allowed");
    await captureSnapshot(this.page);
    const facts = await this.inspectTarget(input.target);
    if (!facts || typeof facts.frame !== "number" || typeof facts.node !== "string") throw new CapabilityError("POLICY_DENIED", "Cannot classify unresolved click target");
    const resolved = this.page.frames()[facts.frame]!.locator(`[data-cap-node="${facts.node}"]`);
    await enforceOperation(this.page, resolved, "click", this.policy);
    if (input.target.type === "coordinate") await this.page.mouse.click(input.target.x, input.target.y);
    else {
      const frame = this.refs.get(input.target.ref);
      if (!frame) throw new ToolError(`Unknown or stale element reference: ${input.target.ref}`);
      await frame.locator(`[data-browser-ref="${input.target.ref}"]`).click();
    }
    this.refs.clear();
    this.checkNetwork();
  }

  async inspectTarget(target: BetaBrowserClickTarget): Promise<Record<string, unknown> | null> {
    if (target.type === "coordinate") {
      let frame = this.page.mainFrame();
      let x = target.x;
      let y = target.y;
      // Hit testing stops at frame elements; descend to the actual clicked node.
      while (true) {
        const handle = await frame.evaluateHandle(({ x, y }) => document.elementFromPoint(x, y), { x, y });
        try {
          const element = handle.asElement();
          if (!element) return null;
          const child = await element.contentFrame();
          if (!child) break;
          const geometry = await element.evaluate((node) => {
            const html = node as HTMLElement;
            const rect = html.getBoundingClientRect();
            return { left: rect.left, top: rect.top, borderX: html.clientLeft, borderY: html.clientTop,
              transformed: getComputedStyle(html).transform !== "none" || Math.abs(rect.width - html.offsetWidth) > 1 || Math.abs(rect.height - html.offsetHeight) > 1 };
          });
          if (geometry.transformed) throw new ToolError("Coordinate recording through transformed frames is unsupported");
          x -= geometry.left + geometry.borderX;
          y -= geometry.top + geometry.borderY;
          frame = child;
        } finally { await handle.dispose(); }
      }
      return frame.evaluate(({ x, y, frameId }) => {
        const element = document.elementFromPoint(x, y) as HTMLElement | null;
        if (!element) return null;
        const row = element.closest("tr");
        return {
          node: element.getAttribute("data-cap-node"), frame: frameId,
          tag: element.tagName.toLowerCase(),
          label: element.innerText.trim(),
          href: element instanceof HTMLAnchorElement ? element.getAttribute("href") : null,
          rowText: row?.innerText.replace(/\s+/g, " ").trim() ?? null,
          rowFirstCell: row?.querySelector("td")?.textContent?.trim() ?? null,
          rowCells: row ? Array.from(row.querySelectorAll("td"), (cell) => cell.textContent?.trim() ?? "") : null,
          columnHeaders: row ? Array.from(row.closest("table")?.querySelectorAll("thead th") ?? [], (cell) => cell.textContent?.trim() ?? "") : null,
          replayReady: false,
        };
      }, { x, y, frameId: this.page.frames().indexOf(frame) });
    }
    const frame = this.refs.get(target.ref);
    if (!frame) return null;
    return frame.locator(`[data-browser-ref="${target.ref}"]`).evaluate((element, frameId) => {
      const html = element as HTMLElement;
      const row = html.closest("tr");
      return {
        node: element.getAttribute("data-cap-node"), frame: frameId,
        tag: html.tagName.toLowerCase(),
        label: html.innerText.trim(),
        href: html instanceof HTMLAnchorElement ? html.getAttribute("href") : null,
        rowText: row?.innerText.replace(/\s+/g, " ").trim() ?? null,
        rowFirstCell: row?.querySelector("td")?.textContent?.trim() ?? null,
        rowCells: row ? Array.from(row.querySelectorAll("td"), (cell) => cell.textContent?.trim() ?? "") : null,
        columnHeaders: row ? Array.from(row.closest("table")?.querySelectorAll("thead th") ?? [], (cell) => cell.textContent?.trim() ?? "") : null,
        replayReady: false,
      };
    }, this.page.frames().indexOf(frame));
  }

  protected override async form_input(_context: BetaToolsetCallContext, input: import("@anthropic-ai/sdk/resources/beta").BetaBrowserFormInputInput): Promise<void> {
    this.checkTab(input.tab_id);
    const frame = this.refs.get(input.target.ref);
    if (!frame || typeof input.value !== "string") throw new BeforeDispatchError();
    const target = frame.locator(`[data-browser-ref="${input.target.ref}"]`);
    if (await target.getAttribute("type") === "password") throw new ToolError("Secret entry is outside this public-data slice");
    if (await target.evaluate((element) => element.tagName.toLowerCase()) === "select") {
      await enforceOperation(this.page, target, "selectOption", this.policy);
      const matchesLabel = await target.locator("option").evaluateAll((options, value) => options.some((option) => (option as HTMLOptionElement).label.trim() === value), input.value);
      await target.selectOption(matchesLabel ? { label: input.value } : { value: input.value });
    } else { await enforceOperation(this.page, target, "fill", this.policy); await target.fill(input.value); }
  }

  currentUrl(): string {
    return this.page.url();
  }

  async waitForUrlHash(timeout = 3000): Promise<void> {
    await this.page.waitForURL((url) => Boolean(url.hash), { timeout });
  }

  protected override async screenshot(_context: BetaToolsetCallContext, input: BetaBrowserScreenshotInput) {
    this.checkTab(input.tab_id);
    return { data: (await this.page.screenshot()).toString("base64"), mediaType: "image/png" as const };
  }

  protected override async wait(_context: BetaToolsetCallContext, input: BetaBrowserWaitInput): Promise<void> {
    this.checkTab(input.tab_id);
    await this.page.waitForTimeout(Math.min(input.duration, 30) * 1000);
  }

  private checkTab(tabId: string | null | undefined): void {
    if (tabId && tabId !== "tab-1") throw new ToolError(`Unknown tab: ${tabId}`);
  }
}
