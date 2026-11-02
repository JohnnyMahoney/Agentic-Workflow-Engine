import { Script } from "node:vm";
import { z } from "zod";

// Full-string regex matching is bounded even for a hostile generated expression.
const matchScript = new Script("const match = new RegExp(pattern).exec(text); !!match && match.index === 0 && match[0].length === text.length");
export function matchesPattern(pattern: string, text: string): boolean {
  if (pattern.length > 512 || text.length > 4096) throw new Error("Output pattern/value exceeds evaluation limits");
  return matchScript.runInNewContext({pattern: `^(?:${pattern})$`, text}, {timeout: 25}) as boolean;
}
export const patternSchema = z.string().min(1).max(512).refine(pattern => {
  try { return !matchesPattern(pattern, "") && !matchesPattern(pattern, " "); } catch { return false; }
}, "Pattern must be valid, bounded, and reject empty/blank values");
