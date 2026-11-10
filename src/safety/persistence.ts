import { AsyncLocalStorage } from "node:async_hooks";
import { writeFileSync as rawWrite, appendFileSync as rawAppend } from "node:fs";
import type { Page } from "playwright";
import { CapabilityError } from "../capability/contract.js";
import type { SafetyPolicy } from "./policy.js";

const state = new AsyncLocalStorage<{secrets: Set<string>; selectors: string[]}>();
const secretKey = /password|passwd|credential|authorization|cookie|api[_-]?key|access[_-]?token|refresh[_-]?token|session[_-]?(?:token|id)|secret/i;
const marker = "[REDACTED]";
function environmentSecrets(): string[] {
  return Object.entries(process.env).filter(([key, value]) => secretKey.test(key) && value && value.length >= 4).map(([,value]) => value!);
}
export async function withSafety<T>(policy: SafetyPolicy, inputs: Record<string, unknown>, run: () => Promise<T>): Promise<T> {
  if (!policy.privacy || policy.privacy.dataClass === "sensitive") throw new CapabilityError("SAFETY_CONFIGURATION_REQUIRED", "This MVP requires trusted synthetic/public data classification; sensitive applications are refused");
  const secrets = new Set([...environmentSecrets(), ...(state.getStore()?.secrets ?? [])]);
  for (const key of policy.privacy.secretEnv) {
    const value = process.env[key];
    if (!value) throw new CapabilityError("SAFETY_CONFIGURATION_REQUIRED", "Required sensitive environment value is missing");
    secrets.add(value);
  }
  for (const [key, value] of Object.entries(inputs)) if (secretKey.test(key) || policy.privacy.sensitiveInputs.includes(key)) secrets.add(String(value));
  return state.run({secrets, selectors: policy.privacy.sensitiveSelectors}, async () => {
    try { return await run(); }
    catch (error) {
      if (error instanceof CapabilityError) throw new CapabilityError(error.code, sanitizeText(error.message), sanitize(error.details));
      if (error instanceof Error) { error.message = sanitizeText(error.message); throw error; }
      throw new Error(sanitizeText(String(error)));
    }
  });
}
export function registerSensitive(values: string[]): void { for (const value of values) if (value) state.getStore()?.secrets.add(value); }
export async function learnPageSecrets(page: Page): Promise<string[]> {
  const selectors = state.getStore()?.selectors ?? [];
  const discovered: string[] = [];
  for (const frame of page.frames()) {
    const values = await frame.evaluate((configured) => {
      const selected = new Set<Element>();
      for (const element of document.querySelectorAll("input,textarea,meta,[data-sensitive]")) {
        if (element.matches('[type=password],[data-sensitive]') || /password|passwd|secret|token|credential|authorization|cookie/i.test([element.getAttribute('name'),element.id,element.getAttribute('autocomplete')].join(' '))) selected.add(element);
      }
      for (const selector of configured) for (const element of document.querySelectorAll(selector)) selected.add(element);
      return [...selected].flatMap(element => [element.textContent ?? '', element.getAttribute('content') ?? '', 'value' in element ? String(element.value) : '']).filter(Boolean);
    }, selectors);
    registerSensitive(values);
    discovered.push(...values);
  }
  return discovered;
}
export function sanitizeText(value: string, additional: string[] = []): string {
  let result = value;
  const values = new Set([...environmentSecrets(), ...(state.getStore()?.secrets ?? []), ...additional]);
  for (const secret of [...values].sort((a,b) => b.length-a.length)) {
    if (!secret) continue;
    for (const variant of new Set([secret, encodeURIComponent(secret), encodeURIComponent(encodeURIComponent(secret)), secret.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')])) result = result.split(variant).join(marker);
  }
  return result
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer '+marker)
    .replace(/\b(?:sk-(?:ant-)?[\w-]{12,}|eyJ[\w-]+\.[\w-]+\.[\w-]+)\b/g, marker)
    .replace(/((?:password|passwd|api[_-]?key|access[_-]?token|refresh[_-]?token|session[_-]?token|secret)\s*[=:]\s*)[^\s&<>"']+/gi, '$1'+marker)
    .replace(/([?&][^=&#\s]+)=([^&#\s"<>]*)/g, '$1='+marker)
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1'+marker+'@')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, marker)
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, marker)
    .replace(/\b(?:\d[ -]?){13,19}\b/g, marker);
}
export function sanitize<T>(value: T, known: string[] = []): T {
  const discovered: string[] = [...known];
  function collect(item: unknown): void {
    if (!item || typeof item !== 'object') return;
    for (const [key, entry] of Object.entries(item)) {
      if (secretKey.test(key) && key !== 'secretEnv' && typeof entry === 'string') discovered.push(entry);
      else collect(entry);
    }
  }
  collect(value); registerSensitive(discovered);
  function visit(item: unknown, key = ''): unknown {
    if (secretKey.test(key) && !['secretEnv', 'sensitiveSelectors'].includes(key)) return marker;
    if (typeof item === 'string') return sanitizeText(item, discovered);
    if (Array.isArray(item)) return item.map(value => visit(value));
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).map(([name, value]) => [sanitizeText(name),visit(value,name)]));
    return item;
  }
  return visit(value) as T;
}
function safeContent(data: string): string {
  try { return JSON.stringify(sanitize(JSON.parse(data)), null, data.includes('\n  ') ? 2 : undefined) + (data.endsWith('\n') ? '\n' : ''); }
  catch { return sanitizeText(data); }
}
// All production persistence flows use these wrappers. Binary images are refused:
// string redaction cannot establish that pixels are safe.
export function writeFileSync(path: string, data: string | Uint8Array): void {
  if (typeof data !== 'string' || /\.(png|jpe?g|webp)$/i.test(path)) throw new CapabilityError('UNSAFE_IMAGE_OMITTED', 'Raw image persistence is disabled');
  rawWrite(path, safeContent(data));
}
export function appendFileSync(path: string, data: string): void { rawAppend(path, safeContent(data)); }
export function assertUnredacted(value: unknown): void {
  if (JSON.stringify(value).includes(marker)) throw new CapabilityError('SANITIZED_EVIDENCE_INSUFFICIENT', 'Redaction removed data needed for trusted compilation; artifact generation refused');
}
