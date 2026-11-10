import { chromium } from "playwright";
import { CapabilityError } from "../capability/contract.js";
import type { DiscoveryEvidence, Snapshot } from "../capability/evidence.js";
import { checkUrl, type Policy } from "../surfaces/playwright.js";

export function sameObservedState(a: Snapshot, b: Snapshot): boolean {
  const normalize = (s: Snapshot) => JSON.stringify({...s, frames: s.frames.map(frame => ({...frame, html: frame.html.replace(/\sdata-browser-ref="[^"]*"/g, "")}))});
  return normalize(a) === normalize(b);
}

// Trusted policy certifies that this control ONLY dismisses a temporary blocker.
// Offline verification checks that observed human actions and DOM agree with it;
// DOM alone cannot establish the absence of hidden server-side effects.
export async function validateHumanEvidence(evidence: DiscoveryEvidence, policy: Policy): Promise<void> {
  if (!evidence.interventions?.length) return;
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({javaScriptEnabled: false});
    await context.route("**/*", route => route.abort());
    const before = await context.newPage(), after = await context.newPage();
    for (const intervention of evidence.interventions) {
      const fail = () => { throw new CapabilityError("HUMAN_EVIDENCE_UNVERIFIED", "Human action is not a proven policy-scoped blocker dismissal; cannot compile essential human-only steps", {intervention: intervention.id}); };
      if (intervention.outcome !== "resumed" || !intervention.after) fail();
      const end = intervention.after!;
      if (!intervention.humanActions.length && sameObservedState(intervention.before, end)) {
        await after.setContent(end.frames.find(frame => frame.id === 0)?.html ?? "");
        for (const rule of policy.humanBlockers ?? []) if (rule.url === end.url && await after.locator(rule.container).count()) fail();
        continue;
      }
      if (intervention.before.url !== end.url || intervention.before.frames.length !== end.frames.length) fail();
      checkUrl(end.url, policy);
      if (!intervention.humanActions.length || intervention.humanActions.some(event => event.action !== "click" || event.frameIndex !== 0 || event.trusted !== true || typeof event.targetPath !== "string")) fail();
      // Only top-document dismissals in this MVP; all other frames must remain identical.
      for (let i = 1; i < end.frames.length; i++) if (!sameObservedState({url: end.url, frames: [intervention.before.frames[i]!]}, {url: end.url, frames: [end.frames[i]!]})) fail();
      const initial = intervention.before.frames.find(frame => frame.id === 0);
      const final = end.frames.find(frame => frame.id === 0);
      if (!initial || !final) fail();
      let proven = false;
      for (const rule of policy.humanBlockers ?? []) {
        if (rule.url !== end.url) continue;
        await before.setContent(initial!.html); await after.setContent(final!.html);
        const container = before.locator(rule.container), dismiss = before.locator(rule.dismiss);
        if (await container.count() !== 1 || await dismiss.count() !== 1 || await after.locator(rule.container).count() !== 0) continue;
        const button = await dismiss.elementHandle();
        if (!await container.evaluate((element, candidate) => element.contains(candidate), button)) continue;
        let allowed = true;
        for (const event of intervention.humanActions) {
          const target = before.locator(String(event.targetPath));
          if (await target.count() !== 1 || !await target.evaluate((element, candidate) => candidate?.contains(element) ?? false, button)) { allowed = false; break; }
        }
        if (!allowed) continue;
        await container.evaluate(element => element.remove());
        const normalized = async (page: typeof before) => page.evaluate(() => {
          for (const element of document.querySelectorAll("*")) { element.removeAttribute("data-cap-node"); element.removeAttribute("data-browser-ref"); }
          return document.documentElement.outerHTML;
        });
        if (await normalized(before) === await normalized(after)) { proven = true; break; }
      }
      if (!proven) fail();
    }
  } finally { await browser.close(); }
}
