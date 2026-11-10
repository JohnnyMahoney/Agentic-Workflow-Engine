import type { BrowserContext, Locator, Page } from "playwright";
import { z } from "zod";
import { CapabilityError } from "../capability/contract.js";

export const routeSchema = z.string().startsWith("/").refine(value => !value.includes("?") && !value.includes("#") && (!value.includes("*") || value.endsWith("/*") && value.indexOf("*") === value.length - 1), "Exact pathname or trailing /* only");
export const operationSchema = z.object({
  action: z.enum(["click", "fill", "selectOption"]),
  path: routeSchema, selector: z.string().min(1),
  framePath: routeSchema.optional(),
  risk: z.enum(["safe", "risky", "blocked"]), allow: z.boolean().default(false),
}).strict();
export const privacySchema = z.object({
  dataClass: z.enum(["synthetic", "public", "sensitive"]).default("sensitive"),
  sensitiveInputs: z.array(z.string()).default([]),
  sensitiveSelectors: z.array(z.string()).default([]),
  secretEnv: z.array(z.string()).default([]),
}).strict();
export interface SafetyPolicy {
  origins: string[]; actions: string[];
  routes?: string[] | undefined;
  operations?: z.infer<typeof operationSchema>[] | undefined;
  privacy?: z.infer<typeof privacySchema> | undefined;
}
export function pathMatches(path: string, rule: string): boolean {
  return rule.endsWith("/*") ? path === rule.slice(0, -2) || path.startsWith(rule.slice(0, -1)) : path === rule;
}
export function checkDestination(raw: string, policy: SafetyPolicy, resource = false): void {
  let url: URL;
  try { url = new URL(raw); } catch { throw new CapabilityError("POLICY_DENIED", "Invalid destination"); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !policy.origins.includes(url.origin)) throw new CapabilityError("POLICY_DENIED", "Origin or URL credentials are not allowed");
  if (/%(?:2f|5c|25)/i.test(url.pathname)) throw new CapabilityError("POLICY_DENIED", "Ambiguous encoded pathname");
  if (!resource && !(policy.routes ?? []).some(rule => pathMatches(url.pathname, rule))) throw new CapabilityError("POLICY_DENIED", "Route is not allowed");
}
export async function enforceOperation(page: Page, locator: Locator, action: "click" | "fill" | "selectOption", policy: SafetyPolicy): Promise<void> {
  checkDestination(page.url(), policy);
  if (!policy.actions.includes(action)) throw new CapabilityError("POLICY_DENIED", "Action type is not allowed");
  const frameUrl = await locator.evaluate(() => location.href);
  checkDestination(frameUrl, policy);
  const matches = [];
  for (const rule of policy.operations ?? []) {
    if (rule.action !== action || !pathMatches(new URL(page.url()).pathname, rule.path)) continue;
    if (frameUrl !== page.url() && (!rule.framePath || !pathMatches(new URL(frameUrl).pathname, rule.framePath))) continue;
    if (await locator.evaluate((element, selector) => element.matches(selector), rule.selector)) matches.push(rule);
  }
  if (!matches.length || matches.some(rule => rule.risk === "blocked" || !rule.allow)) throw new CapabilityError("POLICY_DENIED", "Operation is unknown, blocked, or lacks explicit trusted permission");
  // Validate navigational destinations before a click can begin. Network routing
  // separately checks JS navigation, frame loads and redirect responses.
  if (action === "click") {
    const href = await locator.evaluate(element => element.closest("a[href]")?.getAttribute("href"));
    if (href) checkDestination(new URL(href, frameUrl).href, policy);
  }
}

export async function installNetworkPolicy(context: BrowserContext, policy: SafetyPolicy): Promise<() => void> {
  let denied = false;
  await context.route("**/*", async route => {
    try {
      const navigation = route.request().isNavigationRequest();
      checkDestination(route.request().url(), policy, !navigation);
      // Never let route.fetch silently follow an unchecked redirect.
      const response = await route.fetch({maxRedirects: 0});
      const location = response.headers().location;
      if (response.status() >= 300 && response.status() < 400 && location) checkDestination(new URL(location, response.url()).href, policy, !navigation);
      await route.fulfill({response});
    } catch (error) {
      if (error instanceof CapabilityError && error.code === "POLICY_DENIED") denied = true;
      await route.abort().catch(() => {});
    }
  });
  return () => { if (denied) throw new CapabilityError("POLICY_DENIED", "A browser request or redirect was denied by policy"); };
}
