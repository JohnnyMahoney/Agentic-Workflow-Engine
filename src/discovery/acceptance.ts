import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { CapabilityError } from "../capability/contract.js";
import type { DiscoveryEvidence, Snapshot } from "../capability/evidence.js";
import { FORM_INPUT_REJECTED_MESSAGE } from "./failures.js";

export interface DiscoveryAudit { events: Record<string, unknown>[]; summary: {assessment?: {completed?: boolean}; toolFailures?: number}; sourceHashes?: Record<string, string> }
export interface DiscoveryAdmission {
  status: "eligible-for-compilation";
  goalVerification: "pending-builder-validation";
  recoveredFailures: {action: number; code: string; recoveryAction: number; target: {frame: number; node: string}; proof: "typed-before-dispatch" | "legacy-driver-guard-and-audit"; unchangedSnapshotSha256: string}[];
  auditHashes?: Record<string, string>;
}
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
function reject(code: string, message: string, details: Record<string, unknown> = {}): never { throw new CapabilityError(code, message, details); }

export function readDiscoveryAudit(evidencePath: string): DiscoveryAudit | undefined {
  const directory = dirname(evidencePath);
  const eventsPath = join(directory, "events.jsonl"), summaryPath = join(directory, "summary.json");
  if (!existsSync(eventsPath) || !existsSync(summaryPath)) return undefined;
  const events = readFileSync(eventsPath, "utf8"), summary = readFileSync(summaryPath, "utf8");
  return {events: events.trim().split("\n").filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>), summary: JSON.parse(summary), sourceHashes: {events: hash(events), summary: hash(summary)}};
}

function referenceTarget(snapshot: Snapshot, raw: unknown): {frame: number; node: string} | undefined {
  if (!raw || typeof raw !== "object" || !("type" in raw) || raw.type !== "ref" || !("ref" in raw) || typeof raw.ref !== "string" || !/^ref_\d+$/.test(raw.ref)) return;
  const matches: {frame: number; node: string}[] = [];
  for (const frame of snapshot.frames) for (const tag of frame.html.match(/<[^>]+>/g) ?? []) {
    if (!tag.includes(`data-browser-ref="${raw.ref}"`)) continue;
    const node = tag.match(/data-cap-node="([^"]+)"/)?.[1];
    if (node && frame.nodes[node]) matches.push({frame: frame.id, node});
  }
  return matches.length === 1 ? matches[0] : undefined;
}

// This is eligibility, not a declaration that an arbitrary natural-language goal succeeded.
// Builder must still verify the candidate's outputs and post-action checkpoints.
export function checkDiscoveryEvidence(evidence: DiscoveryEvidence, audit?: DiscoveryAudit): DiscoveryAdmission {
  if (evidence.evidenceVersion !== "2.0" || !evidence.actions.length) reject("UNSUPPORTED_EVIDENCE", "Requires completed v2 discovery evidence");
  if (evidence.actions.some((action, index) => action.index !== index + 1)) reject("UNSUPPORTED_EVIDENCE", "Discovery has failed or missing actions; preserve original consecutive audit indices");
  if (!evidence.actions.some(action => action.success && action.name === "navigate" && action.after.url === evidence.request.url)) reject("UNSUPPORTED_EVIDENCE", "Discovery never reached the requested entry point");
  const failed = evidence.actions.filter(action => !action.success);
  if (!failed.length && !evidence.completed) reject("UNSUPPORTED_EVIDENCE", "Requires completed v2 discovery evidence");
  const report: DiscoveryAdmission = {status: "eligible-for-compilation", goalVerification: "pending-builder-validation", recoveredFailures: [], ...(audit?.sourceHashes ? {auditHashes: audit.sourceHashes} : {})};
  if (!failed.length) return report;
  const lastAction = evidence.actions.at(-1)!;
  const auditEnded = audit?.summary.assessment?.completed === true && audit.summary.toolFailures === failed.length && audit.events.some(event => event.kind === "run_end" && event.name === evidence.request.id && (event.assessment as {completed?: boolean} | undefined)?.completed === true && event.toolFailures === failed.length && event.actionCount === lastAction.index) && !audit.events.some(event => event.kind === "run_failure");
  if (!(evidence.modelCompleted === true || auditEnded)) reject("DISCOVERY_INCOMPLETE", "Recovered failures require evidence that the model ended normally");
  if (audit && !auditEnded) reject("DISCOVERY_AUDIT_MISMATCH", "Companion audit does not corroborate normal completion and the recorded failures");
  for (const failure of failed) {
    const typed = failure.failure?.phase === "beforeDispatch" && failure.failure.code === "FORM_INPUT_REJECTED";
    const errors = audit?.events.filter(event => event.kind === "failure" && event.action === failure.index && event.name === failure.name) ?? [];
    const legacy = !failure.failure && auditEnded && errors.length === 1 && errors[0]!.message === FORM_INPUT_REJECTED_MESSAGE;
    if (failure.name !== "form_input" || (!typed && !legacy)) reject("UNCONFIRMED_DISCOVERY_EFFECT", "Failed action may have dispatched a state change; cannot admit it from a later success or unchanged DOM", {action: failure.index, name: failure.name});
    const before = JSON.stringify(failure.before);
    if (before !== JSON.stringify(failure.after)) reject("DISCOVERY_STATE_CHANGED", "Pre-dispatch failure snapshots differ; recovery needs explicit reconciliation", {action: failure.index});
    const call = audit?.events.find(event => event.kind === "before_execution" && event.action === failure.index && event.name === failure.name);
    const rawTarget = failure.input.target ?? (call?.input as {target?: unknown} | undefined)?.target;
    const target = referenceTarget(failure.before, rawTarget);
    if (!target) reject("DISCOVERY_RECOVERY_UNPROVEN", "Cannot identify the failed reference in recorded DOM", {action: failure.index});
    const later = evidence.actions.filter(action => action.index > failure.index && action.success);
    const recovery = later.find(action => !["read_page", "get_page_text", "screenshot", "wait"].includes(action.name));
    if (!recovery || recovery.name !== "form_input" || recovery.target?.frame !== target.frame || recovery.target.node !== target.node || recovery.before.url !== failure.before.url) reject("DISCOVERY_RECOVERY_UNPROVEN", "No successful correction on the same recorded field before another interaction", {action: failure.index});
    const binding = recovery.input.value as {input?: string} | undefined;
    if (!binding?.input || !Object.hasOwn(evidence.request.bindings, binding.input)) reject("DISCOVERY_RECOVERY_UNPROVEN", "Corrected input is not bound to the explicit request", {action: failure.index});
    if (!later.some(action => action.index > recovery.index && ["read_page", "get_page_text"].includes(action.name) && action.observation?.trim())) reject("DISCOVERY_RECOVERY_UNPROVEN", "No textual result was recorded after recovery", {action: failure.index});
    report.recoveredFailures.push({action: failure.index, code: "FORM_INPUT_REJECTED", recoveryAction: recovery.index, target, proof: typed ? "typed-before-dispatch" : "legacy-driver-guard-and-audit", unchangedSnapshotSha256: hash(before)});
  }
  return report;
}
