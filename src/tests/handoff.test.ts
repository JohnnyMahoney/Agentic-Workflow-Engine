import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:http";
import { CapabilityError, validateCapability, type Capability } from "../capability/contract.js";
import { replayCapability } from "../replay/engine.js";
import { type HandoffController, type InterventionRequest } from "../replay/handoff.js";
import { PlaywrightAdapter, testPolicy } from "../surfaces/playwright.js";
import type { SurfaceAdapter } from "../surfaces/adapter.js";

const root = resolve(process.env.HANDOFF_EVIDENCE_DIR ?? mkdtempSync(join(tmpdir(), "handoff-")));

test("before-dispatch blocker: same-session handoff retries click once after target validation", async () => {
  const server = createServer((_, response) => { response.setHeader("Content-Type", "text/html"); response.end('<p id="state">ready</p><input id="member" onclick="window.clicks=(window.clicks||0)+1;document.querySelector(\'#state\').textContent=\'focused\'"><div id="blocker">Operator required<button onclick="this.parentElement.remove()">Dismiss</button></div>'); });
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const css = (selector: string) => ({strategies: [{kind: "css" as const, selector, frames: []}]});
  try {
    for (const mode of ["success", "missing", "ambiguous", "still-blocked"]) {
      const cap = validateCapability({schemaVersion: "2.0", id: "before-dispatch", version: "1.0.0", description: "Hand-authored regression; simulated operator", inputs: {}, targets: {member: css("#member"), state: css("#state")},
        steps: [{id: "open", action: "navigate", url: origin}, {id: "focusMember", action: "click", target: "member", effect: "readOnly"}, {id: "read", action: "extract", target: "state", saveAs: "value"}, {id: "verify", action: "assert", condition: {kind: "textEquals", target: "state", value: {literal: "focused"}}}],
        outputs: {state: {type: "string", description: "Observed state", source: {savedValue: "value"}}}, checkpoints: [{kind: "textEquals", target: "state", value: {literal: "focused"}}]});
      const dir = join(root, `before-dispatch-${mode}`); mkdirSync(dir, {recursive: true});
      const path = join(dir, "artifact.json"); const original = JSON.stringify(cap); writeFileSync(path, original);
      let adapter: PlaywrightAdapter; let clickCalls = 0; let launches = 0;
      const op = controller(["take-control", "resume"], async () => {
        assert.equal(clickCalls, 0);
        if (mode !== "still-blocked") await adapter.page.getByRole("button", {name: "Dismiss"}).click();
        if (mode === "missing") await adapter.page.locator("#member").evaluate(element => element.remove());
        if (mode === "ambiguous") await adapter.page.locator("#member").evaluate(element => element.after(element.cloneNode()));
      });
      const policy = {...testPolicy, origins: [origin], detectors: [{code: "UNEXPECTED_DIALOG", status: "HARD_FAILURE" as const, target: css("#blocker"), value: {literal: "Operator required"}}]};
      const result = await replayCapability(path, {}, dir, policy, async (inputs, rules) => {
        launches++; adapter = await PlaywrightAdapter.launch(inputs, rules);
        const click = adapter.click.bind(adapter); adapter.click = async target => { clickCalls++; await click(target); };
        return adapter;
      }, {controller: op});
      assert.equal(launches, 1); assert.equal(op.requests.length, 1);
      assert.equal(readFileSync(path, "utf8"), original);
      assert.equal(result.status, mode === "success" ? "SUCCESS" : "HARD_FAILURE");
      assert.equal(clickCalls, mode === "success" ? 1 : 0);
      if (mode !== "success") assert.equal(result.code, "HANDOFF_UNRESOLVED");
      const events = readFileSync(result.evidenceRef, "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line));
      assert.ok(events.some(event => event.kind === "step_failure" && event.stepId === "focusMember" && event.dispatch === "beforeDispatch"));
      if (mode === "success") {
        assert.equal(result.outputs?.state, "focused");
        assert.ok(events.some(event => event.decision === "SAFE_RETRY" && event.dispatch === "beforeDispatch"));
        assert.equal(events.filter(event => event.kind === "step_dispatch" && event.stepId === "focusMember").length, 1);
      }
    }
  } finally { await new Promise<void>(done => server.close(() => done())); }
});
const condition = {kind: "textEquals" as const, target: "state", value: {literal: "Confirmed member-1 Youth"}};
function capability(steps: unknown[], outputs: unknown = {}) {
  return validateCapability({schemaVersion: "2.0", id: "handoff-fixture", version: "1.0.0", description: "Hand-authored handoff regression fixture; no Claude run", inputs: {}, targets: {state: {strategies: [{kind: "css", selector: "#state"}]}}, steps, outputs, checkpoints: [condition]});
}
function fake() {
  const state = {text: "Loading", closed: false, clicks: 0, navigations: 0};
  const adapter: SurfaceAdapter = {
    navigate: async () => { state.navigations++; }, click: async () => { state.clicks++; },
    fill: async () => {}, selectOption: async () => {}, extract: async () => state.text,
    visible: async () => true, url: () => testPolicy.origins[0]!,
    captureFailure: async () => { throw new Error("Mock: no browser screenshot"); },
    observeHuman: async record => { record({action: "mock-operator"}); return async () => {}; },
    close: async () => { state.closed = true; },
  };
  return {state, adapter};
}
function controller(commands: string[], act: () => Promise<void> = async () => {}): HandoffController & {requests: InterventionRequest[]} {
  const requests: InterventionRequest[] = [];
  return {requests, open: r => { requests.push(r); }, close: () => {}, nextCommand: async () => { const command = commands.shift() ?? "abort"; if (command === "resume") await act(); return command; }};
}
async function run(name: string, cap: Capability, adapter: SurfaceAdapter, operator: HandoffController, timeoutMs = 1000) {
  const dir = join(root, name); mkdirSync(dir, {recursive: true});
  const path = join(dir, "artifact.json"); const original = JSON.stringify(cap, null, 2); writeFileSync(path, original);
  const result = await replayCapability(path, {}, dir, testPolicy, async () => adapter, {controller: operator, timeoutMs});
  assert.equal(readFileSync(path, "utf8"), original);
  const events = readFileSync(result.evidenceRef, "utf8").trim().split("\n").map(line => JSON.parse(line));
  writeFileSync(join(dir, "assertions.json"), JSON.stringify({artifactUnchanged: true, result}, null, 2));
  return {result, events};
}

test("handoff preserves five-step execution and saved output; resume alone is rejected", async () => {
  const {state, adapter} = fake();
  const inputTransitions: boolean[] = [];
  adapter.setHumanInputEnabled = async enabled => { inputTransitions.push(enabled); };
  const cap = capability([
    {id: "one", action: "navigate", url: testPolicy.origins[0]},
    {id: "two", action: "extract", target: "state", saveAs: "before"},
    {id: "three", action: "wait", condition, timeoutMs: 1},
    {id: "four", action: "extract", target: "state", saveAs: "after"},
    {id: "five", action: "assert", condition},
  ], {before: {type: "string", description: "Pre-handoff sample", source: {savedValue: "before"}}, after: {type: "string", description: "Post-handoff sample", source: {savedValue: "after"}}});
  let resumes = 0;
  const op = controller(["resume", "take-control", "resume"], async () => { if (++resumes === 2) state.text = "Confirmed member-1 Youth"; assert.equal(state.closed, false); });
  const {result, events} = await run("five-step", cap, adapter, op);
  assert.equal(result.status, "SUCCESS"); assert.equal(result.outputs!.before, "Loading"); assert.equal(result.outputs!.after, state.text);
  assert.deepEqual(op.requests[0]!.completedSteps, ["one", "two"]); assert.deepEqual(op.requests[0]!.savedOutputNames, ["before"]);
  assert.equal(state.navigations, 1); assert.equal(state.closed, true);
  assert.deepEqual(inputTransitions, [false, true, false, true]);
  assert.ok(events.some(e => e.kind === "handoff_command_rejected"));
  assert.ok(events.some(e => e.decision === "HUMAN_COMPLETED"));
  assert.deepEqual(events.filter(e => e.kind === "step_end").map(e => e.stepId), ["one", "two", "three", "four", "five"]);
});

test("Chromium handoff input lock blocks clicks and typing, including frames, and restores interaction", async () => {
  const adapter = await PlaywrightAdapter.launch({});
  try {
    await adapter.page.setContent('<input><button onclick="this.textContent=\'clicked\'">Click</button><iframe srcdoc="<button>Frame</button>"></iframe>');
    await adapter.page.frameLocator('iframe').getByRole('button').evaluate(button => { button.addEventListener('click', () => { button.textContent = 'clicked'; }); });
    await adapter.page.locator('input').focus();
    await adapter.setHumanInputEnabled(false);
    // DOM-dispatched events bypass CDP's injected-input suppression. The page
    // gate must independently stop handlers, including inside frames.
    const htmlBefore = await adapter.page.content();
    await adapter.page.getByRole('button', {name: 'Click', exact: true}).evaluate(button => (button as HTMLButtonElement).click());
    await adapter.page.frameLocator('iframe').getByRole('button').evaluate(button => (button as HTMLButtonElement).click());
    assert.equal(await adapter.page.content(), htmlBefore);
    assert.equal(await adapter.page.getByRole('button').innerText(), 'Click');
    assert.equal(await adapter.page.frameLocator('iframe').getByRole('button').innerText(), 'Frame');
    await adapter.page.keyboard.type('blocked');
    await adapter.page.getByRole('button', {name: 'Click', exact: true}).click();
    await adapter.page.frameLocator('iframe').getByRole('button').click();
    assert.equal(await adapter.page.locator('input').inputValue(), '');
    assert.equal(await adapter.page.getByRole('button').innerText(), 'Click');
    assert.equal(await adapter.page.frameLocator('iframe').getByRole('button').innerText(), 'Frame');
    await adapter.setHumanInputEnabled(true);
    await adapter.page.frameLocator('iframe').getByRole('button').evaluate(button => (button as HTMLButtonElement).click());
    assert.equal(await adapter.page.frameLocator('iframe').getByRole('button').innerText(), 'clicked');
    await adapter.page.getByRole('button', {name: 'Click', exact: true}).click();
    assert.equal(await adapter.page.getByRole('button').innerText(), 'clicked');
    await adapter.page.locator('input').focus();
    await adapter.page.keyboard.type('allowed');
    assert.equal(await adapter.page.locator('input').inputValue(), 'allowed');
    await adapter.setHumanInputEnabled(false);
    await adapter.page.keyboard.type('blocked-again');
    assert.equal(await adapter.page.locator('input').inputValue(), 'allowed');
  } finally { await adapter.close(); }
});

test("unresolved wait retries once, abort and operator deadline close cleanly", async () => {
  for (const mode of ["unresolved", "abort", "deadline"]) {
    const {state, adapter} = fake(); const cap = capability([{id: "three", action: "wait", condition, timeoutMs: 1}]);
    const op = controller(mode === "abort" ? ["abort"] : ["take-control", "resume"]);
    if (mode === "deadline") op.nextCommand = () => new Promise(() => {});
    const {result, events} = await run(mode, cap, adapter, op, 30);
    assert.equal(result.status, "HARD_FAILURE"); assert.equal(result.code, mode === "abort" ? "HANDOFF_ABORTED" : "HANDOFF_UNRESOLVED");
    assert.equal(result.stepId, "three"); assert.equal(result.retryable, false); assert.equal(state.closed, true);
    assert.equal(events.filter(e => e.kind === "step_start").length, mode === "unresolved" ? 2 : 1);
  }
});

test("uncertain write never repeats; completion requires all associated confirmation conditions", async () => {
  for (const mode of ["unresolved", "wrong-identity", "confirmed"]) {
    const {state, adapter} = fake();
    adapter.click = async () => { state.clicks++; const error = new Error("Dispatch outcome uncertain"); error.name = "TimeoutError"; throw error; };
    const cap = capability([
      {id: "three", action: "click", target: "state", effect: "stateChanging"},
      {id: "identity", action: "assert", condition: {kind: "textContains", target: "state", value: {literal: "member-1"}}},
      {id: "type", action: "assert", condition: {kind: "textContains", target: "state", value: {literal: "Youth"}}, confirms: "three"},
    ]);
    const op = controller(["take-control", "resume"], async () => { state.text = mode === "confirmed" ? "Confirmed member-1 Youth" : mode === "wrong-identity" ? "Confirmed other Youth" : "Loading"; });
    const {result, events} = await run(`write-${mode}`, cap, adapter, op);
    assert.equal(state.clicks, 1); assert.equal(state.closed, true);
    assert.deepEqual(op.requests[0]!.pendingMutations, ["three"]);
    assert.equal(result.status, mode === "confirmed" ? "SUCCESS" : "OUTCOME_UNKNOWN");
    assert.equal(result.retryable, false);
    assert.equal(events.filter(e => e.decision === "SAFE_RETRY").length, 0);
    if (mode !== "confirmed") { assert.equal(result.reconciliationRequired, true); assert.equal(result.stepId, "three"); }
  }
});

test("missing click postcondition cannot be invented; policy failure cannot request handoff", async () => {
  for (const code of ["TARGET_NOT_FOUND", "POLICY_DENIED"]) {
    const {state, adapter} = fake(); adapter.click = async () => { state.clicks++; throw new CapabilityError(code, "fixture"); };
    const cap = capability([{id: "three", action: "click", target: "state", effect: "readOnly"}]);
    const op = controller(["take-control", "resume"], async () => { state.text = "Confirmed member-1 Youth"; });
    const {result} = await run(code, cap, adapter, op);
    assert.equal(result.code, code === "POLICY_DENIED" ? code : "HANDOFF_UNRESOLVED");
    assert.equal(state.clicks, 1); assert.equal(op.requests.length, code === "POLICY_DENIED" ? 0 : 1);
  }
});

test("safe read retry keeps outputs and does not restart earlier steps", async () => {
  const {state, adapter} = fake(); let reads = 0;
  adapter.extract = async () => { if (++reads === 1) throw new CapabilityError("TARGET_NOT_FOUND", "fixture"); return "Confirmed member-1 Youth"; };
  const cap = capability([{id: "one", action: "navigate", url: testPolicy.origins[0]}, {id: "three", action: "extract", target: "state", saveAs: "value"}], {value: {type: "string", description: "Read result", source: {savedValue: "value"}}});
  const {result, events} = await run("safe-read", cap, adapter, controller(["take-control", "resume"]));
  assert.equal(result.status, "SUCCESS"); assert.equal(state.navigations, 1); assert.ok(events.some(e => e.decision === "SAFE_RETRY"));
  assert.equal(result.outputs!.value, "Confirmed member-1 Youth");
});

test("closed browser and navigation outside policy stop recovery", async () => {
  for (const mode of ["closed", "outside-policy"]) {
    const {state, adapter} = fake();
    const op = controller(["take-control", "resume"], async () => { state.text = "Confirmed member-1 Youth"; });
    if (mode === "closed") { adapter.isClosed = () => true; op.nextCommand = () => new Promise(() => {}); }
    else adapter.url = () => "https://not-allowed.invalid/";
    const {result} = await run(mode, capability([{id: "three", action: "wait", condition, timeoutMs: 1}]), adapter, op, 1000);
    assert.equal(result.code, "HANDOFF_UNRESOLVED"); assert.equal(state.closed, true);
    if (mode === "closed") assert.equal(result.details!.recoveryMessage, "Browser session was closed");
    else assert.equal(result.details!.recoveryCode, "POLICY_DENIED");
  }
});

test("real browser handoff retains context, records operator events without typed values, and completes five steps", async () => {
  // A simulated operator drives real DOM controls. This is NOT a live human or Claude run.
  const server = createServer((_, response) => { response.setHeader("Content-Type", "text/html"); response.end('<p id="state">Loading</p><input type="password"><button onclick="document.querySelector(\'#state\').textContent=\'Confirmed member-1 Youth\';localStorage.setItem(\'operator\',\'same-context\')">Resolve</button>'); });
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const dir = join(root, "real-browser"); mkdirSync(dir, {recursive: true});
  const cap = capability([{id: "one", action: "navigate", url: origin}, {id: "two", action: "extract", target: "state", saveAs: "before"}, {id: "three", action: "wait", condition, timeoutMs: 1}, {id: "four", action: "extract", target: "state", saveAs: "after"}, {id: "five", action: "assert", condition}], {before: {type: "string", description: "Before", source: {savedValue: "before"}}, after: {type: "string", description: "After", source: {savedValue: "after"}}});
  const artifactPath = join(dir, "artifact.json"); writeFileSync(artifactPath, JSON.stringify(cap));
  let adapter: PlaywrightAdapter; let launches = 0; let sameContext = false;
  const op = controller(["take-control", "resume"], async () => {
    assert.ok(adapter.browser.isConnected());
    await adapter.page.locator('input').fill("secret-not-for-logs");
    await adapter.page.getByRole("button", {name: "Resolve"}).click();
    sameContext = await adapter.page.evaluate(() => localStorage.getItem("operator") === "same-context");
  });
  try {
    const result = await replayCapability(artifactPath, {}, dir, {...testPolicy, origins: [origin]}, async (inputs, policy) => { launches++; adapter = await PlaywrightAdapter.launch(inputs, policy); return adapter; }, {controller: op});
    assert.equal(result.status, "SUCCESS"); assert.equal(result.outputs!.before, "Loading"); assert.equal(launches, 1); assert.ok(sameContext);
    const events = readFileSync(result.evidenceRef, "utf8"); assert.ok(events.includes('"kind":"human_action"')); assert.ok(!events.includes("secret-not-for-logs"));
    assert.ok(events.includes("button:nth-of-type(1)"));
    for (const phase of ["before", "after"]) assert.ok(readFileSync(join(dir, `handoff-three-${phase}.png`)).length > 0);
    writeFileSync(join(dir, "assertions.json"), JSON.stringify({passed: true, simulatedOperator: true, sameContext, launches, result}, null, 2));
  } finally { await new Promise<void>(done => server.close(() => done())); }
});

test("Banking Sandbox session expiry resumes in the same page after operator login and search", async () => {
  const server = createServer((request, response) => {
    const name = new URL(request.url!, "http://fixture").pathname.slice(1);
    if (!["modern.html", "shared.js"].includes(name)) { response.writeHead(404).end(); return; }
    response.setHeader("Content-Type", name.endsWith("js") ? "application/javascript" : "text/html");
    response.end(readFileSync(join("banking-sandbox", name)));
  });
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const css = (selector: string) => ({strategies: [{kind: "css" as const, selector, frames: []}]});
  const cap = validateCapability({schemaVersion: "2.1", id: "sandbox-handoff-fixture", version: "1.0.0", description: "Hand-authored sandbox session-expiry test; simulated operator", inputs: {}, targets: {query: css("#q"), search: css("#f button"), member: css("#out tbody tr td:first-child")}, steps: [
    {id: "open", action: "navigate", url: `${origin}/modern.html?mode=SESSION_EXPIRED`},
    {id: "query", action: "fill", target: "query", value: {literal: "M-1005"}, effect: "readOnly"},
    {id: "search", action: "click", target: "search", effect: "readOnly"},
    {id: "waitMember", action: "wait", condition: {kind: "textEquals", target: "member", value: {literal: "M-1005"}}, timeoutMs: 2000},
    {id: "read", action: "extract", target: "member", saveAs: "member"},
  ], outputs: {member: {type: "string", description: "Observed ID", source: {savedValue: "member"}, validation: {condition: {kind: "textEquals", value: {literal: "M-1005"}}, timeoutMs: 1000}}}, checkpoints: [{kind: "textEquals", target: "member", value: {literal: "M-1005"}}]});
  const dir = join(root, "banking-session-expired"); mkdirSync(dir, {recursive: true});
  const artifactPath = join(dir, "artifact.json"); const original = JSON.stringify(cap, null, 2); writeFileSync(artifactPath, original);
  let adapter: PlaywrightAdapter; let launches = 0;
  const op = controller(["take-control", "resume"], async () => {
    await adapter.page.getByRole("button", {name: "Log in again"}).click();
    await adapter.page.getByRole("status").filter({hasText: "Logged in"}).waitFor();
    // The existing sandbox re-injects expiry on each call while this mode is
    // enabled. The operator removes the injected fault through its UI, no Reset.
    await adapter.page.getByRole("combobox").selectOption("NONE");
    await adapter.page.getByRole("button", {name: "Search", exact: true}).click();
    await adapter.page.locator("#out tbody td:first-child").filter({hasText: "M-1005"}).waitFor();
  });
  try {
    const policy = {...testPolicy, origins: [origin], detectors: [{code: "SESSION_EXPIRED", status: "HARD_FAILURE" as const, target: css('[role="alert"]'), value: {literal: "SESSION_EXPIRED"}}]};
    writeFileSync(join(dir, "policy.json"), JSON.stringify(policy, null, 2));
    const result = await replayCapability(artifactPath, {}, dir, policy, async (inputs, rules) => { launches++; adapter = await PlaywrightAdapter.launch(inputs, rules); return adapter; }, {controller: op});
    assert.equal(result.status, "SUCCESS"); assert.equal(result.outputs!.member, "M-1005"); assert.equal(launches, 1);
    assert.equal(readFileSync(artifactPath, "utf8"), original); assert.equal(op.requests[0]!.reason, "SESSION_EXPIRED");
    const events = readFileSync(result.evidenceRef, "utf8").split("\n").filter(Boolean).map(x => JSON.parse(x));
    assert.equal(events.filter(e => e.kind === "step_start" && e.stepId === "search").length, 1);
    assert.ok(events.some(e => e.decision === "HUMAN_COMPLETED"));
    writeFileSync(join(dir, "assertions.json"), JSON.stringify({passed: true, simulatedOperator: true, launches, result}, null, 2));
  } finally { await new Promise<void>(done => server.close(() => done())); }
});
