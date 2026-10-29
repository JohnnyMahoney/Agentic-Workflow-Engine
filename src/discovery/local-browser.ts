import { BetaAbstractBrowserToolset20260801, ToolError } from "@anthropic-ai/sdk/helpers/beta/toolsets";
import type { BetaBrowserMemberResult, BetaToolsetCallContext } from "@anthropic-ai/sdk/helpers/beta/toolsets";
import type { BetaBrowserClickTarget, BetaBrowserGetPageTextInput, BetaBrowserLeftClickInput, BetaBrowserMemberInput, BetaBrowserMemberName, BetaBrowserNavigateInput, BetaBrowserReadPageInput, BetaBrowserScreenshotInput, BetaBrowserWaitInput } from "@anthropic-ai/sdk/resources/beta";
import { chromium, type Browser, type BrowserContext, type Frame, type Page } from "playwright";

const host = "the-internet.herokuapp.com";

export class LocalPlaywrightBrowser extends BetaAbstractBrowserToolset20260801 {
  onExecute?: (context: BetaToolsetCallContext, name: BetaBrowserMemberName, input: BetaBrowserMemberInput, run: () => Promise<BetaBrowserMemberResult>) => Promise<BetaBrowserMemberResult>;
  private readonly refs = new Map<string, Frame>();
  private nextRef = 0;

  protected constructor(private readonly browser: Browser, private readonly context: BrowserContext, private readonly page: Page) {
    super({
      browserState: async () => ({ tabs: [{ tab_id: "tab-1", title: await page.title(), url: page.url(), active: true }] }),
      urlPolicy: (_context, url) => {
        if (["back", "forward", "reload"].includes(url)) return;
        const parsed = new URL(url.includes("://") ? url : `https://${url}`);
        if (parsed.protocol !== "https:" || parsed.hostname !== host) throw new ToolError(`Navigation outside https://${host} is blocked.`);
      },
      // Enable only the browser members supported by this web discovery driver.
      configs: Object.fromEntries([
        "zoom", "right_click", "middle_click", "double_click", "triple_click", "hover", "left_click_drag",
        "left_mouse_down", "left_mouse_up", "mouse_move", "scroll", "scroll_to", "type", "key", "hold_key",
        "form_input", "find", "file_upload", "read_console", "read_network", "javascript_exec",
        "new_tab", "list_tabs", "switch_tab", "close_tab",
      ].map((name) => [name, { enabled: false }])),
    });
  }

  static async launch(headless: boolean): Promise<LocalPlaywrightBrowser> {
    const browser = await chromium.launch({ headless });
    try {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      await context.route("**/*", (route) => {
        const url = new URL(route.request().url());
        return url.protocol === "https:" && url.hostname === host ? route.continue() : route.abort();
      });
      const page = await context.newPage();
      return new LocalPlaywrightBrowser(browser, context, page);
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
    const run = () => super.execute(context, name, input);
    return this.onExecute ? this.onExecute(context, name, input, run) : run();
  }

  protected override async navigate(_context: BetaToolsetCallContext, input: BetaBrowserNavigateInput) {
    this.checkTab(input.tab_id);
    this.refs.clear();
    const url = input.url;
    const response = url === "back" ? await this.page.goBack() : url === "forward" ? await this.page.goForward() : url === "reload" ? await this.page.reload() : await this.page.goto(url.includes("://") ? url : `https://${url}`, { waitUntil: "load" });
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
    if (input.target.type === "coordinate") await this.page.mouse.click(input.target.x, input.target.y);
    else {
      const frame = this.refs.get(input.target.ref);
      if (!frame) throw new ToolError(`Unknown or stale element reference: ${input.target.ref}`);
      await frame.locator(`[data-browser-ref="${input.target.ref}"]`).click();
    }
    this.refs.clear();
  }

  async inspectTarget(target: BetaBrowserClickTarget): Promise<Record<string, unknown> | null> {
    if (target.type === "coordinate") {
      return this.page.evaluate(({ x, y }) => {
        const element = document.elementFromPoint(x, y) as HTMLElement | null;
        if (!element) return null;
        const row = element.closest("tr");
        return {
          tag: element.tagName.toLowerCase(),
          label: element.innerText.trim(),
          href: element instanceof HTMLAnchorElement ? element.getAttribute("href") : null,
          rowText: row?.innerText.replace(/\s+/g, " ").trim() ?? null,
          rowFirstCell: row?.querySelector("td")?.textContent?.trim() ?? null,
          rowCells: row ? Array.from(row.querySelectorAll("td"), (cell) => cell.textContent?.trim() ?? "") : null,
          columnHeaders: row ? Array.from(row.closest("table")?.querySelectorAll("thead th") ?? [], (cell) => cell.textContent?.trim() ?? "") : null,
          replayReady: false,
        };
      }, { x: target.x, y: target.y });
    }
    const frame = this.refs.get(target.ref);
    if (!frame) return null;
    return frame.locator(`[data-browser-ref="${target.ref}"]`).evaluate((element) => {
      const html = element as HTMLElement;
      const row = html.closest("tr");
      return {
        tag: html.tagName.toLowerCase(),
        label: html.innerText.trim(),
        href: html instanceof HTMLAnchorElement ? html.getAttribute("href") : null,
        rowText: row?.innerText.replace(/\s+/g, " ").trim() ?? null,
        rowFirstCell: row?.querySelector("td")?.textContent?.trim() ?? null,
        rowCells: row ? Array.from(row.querySelectorAll("td"), (cell) => cell.textContent?.trim() ?? "") : null,
        columnHeaders: row ? Array.from(row.closest("table")?.querySelectorAll("thead th") ?? [], (cell) => cell.textContent?.trim() ?? "") : null,
        replayReady: false,
      };
    });
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
