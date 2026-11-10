import {fixtureSafety} from "./fixture-safety.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { validateCapability, type Capability } from "../capability/contract.js";
import { captureSnapshot, type DiscoveryEvidence } from "../capability/evidence.js";
import { validateCandidate, checkDiscoveryEvidence, type Candidate } from "../capability/builder.js";
import { PlaywrightAdapter, resolveTarget, type Policy, testPolicy } from "../surfaces/playwright.js";
import { replayCapability } from "../replay/engine.js";
import { compilationEvidence } from "../capability/compile.js";
import { LocalPlaywrightBrowser } from "../discovery/local-browser.js";

test("discovery form_input selects a native option and still fills text fields", async () => {
  const driver = await LocalPlaywrightBrowser.launch(true, {...testPolicy,...fixtureSafety});
  try {
    const page = driver.page;
    await page.route("https://the-internet.herokuapp.com/**", route => route.fulfill({body:"<html></html>"}));
    await page.goto("https://the-internet.herokuapp.com/");
    await page.setContent('<input id="name"><select id="type"><option value="">Choose</option><option value="sav">Savings</option></select>');
    const tool = driver as unknown as {
      read_page: (context: unknown, input: unknown) => Promise<string>;
      form_input: (context: unknown, input: unknown) => Promise<void>;
    };
    const observed = await tool.read_page({}, { tab_id: "tab-1", filter: "all" });
    const inputRef = observed.match(/input "" \[(ref_\d+)\]/)?.[1];
    const selectRef = observed.match(/select "Choose\s+Savings" \[(ref_\d+)\]/)?.[1];
    assert.ok(inputRef && selectRef, observed);
    await tool.form_input({}, { tab_id: "tab-1", target: { type: "ref", ref: selectRef }, value: "Savings" });
    assert.equal(await page.locator("#type").inputValue(), "sav");
    assert.equal(await page.locator("#type option:checked").textContent(), "Savings");
    await tool.form_input({}, { tab_id: "tab-1", target: { type: "ref", ref: inputRef }, value: "M-1001" });
    assert.equal(await page.locator("#name").inputValue(), "M-1001");
  } finally { await driver.close(); }
});

test("coordinate recorder identifies actual targets inside bordered nested frames", async () => {
  const driver = await LocalPlaywrightBrowser.launch(true);
  try {
    const page = driver.page;
    await page.setContent('<iframe style="margin:30px;border:5px solid;width:600px;height:400px"></iframe>');
    const child = page.frames()[1]!;
    await child.setContent('<iframe style="margin:20px;border:3px solid;width:400px;height:200px"></iframe>');
    const inner = page.frames()[2]!;
    await inner.setContent('<button onclick="this.textContent=\'Clicked\'">Inside</button>');
    await captureSnapshot(page);
    const button = inner.locator('button');
    const box = (await button.boundingBox())!;
    const target = { type: "coordinate" as const, x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const recorded = await driver.inspectTarget(target);
    assert.equal(recorded?.frame, page.frames().indexOf(inner));
    assert.equal(recorded?.node, await button.getAttribute('data-cap-node'));
    assert.equal(recorded?.tag, 'button');
    await page.mouse.click(target.x, target.y);
    assert.equal(await button.innerText(), 'Clicked');
  } finally { await driver.close(); }
});

const capability: Capability = {
  schemaVersion: "2.0", id: "fixture", version: "1.0.0", description: "Read a message and follow a link",
  inputs: {},
  targets: { message: { strategies: [{ kind: "css", selector: "#message", frames: [] }] }, next: { strategies: [{ kind: "role", role: "link", name: { literal: "Next" }, frames: [] }] } },
  steps: [{ id: "open", action: "navigate", url: "http://localhost/" }, { id: "read", action: "extract", target: "message", saveAs: "message" }, { id: "click", action: "click", target: "next" }],
  outputs: { message: { type: "string", description: "Message", source: { savedValue: "message" } } },
  checkpoints: [{ kind: "urlHash", value: "#done" }],
};

test("semantic validation rejects missing targets, outputs, duplicate IDs and session locators", () => {
  assert.doesNotThrow(() => validateCapability(capability));
  const missing = structuredClone(capability); delete missing.targets.message;
  assert.throws(() => validateCapability(missing), /Unknown target/);
  const duplicate = structuredClone(capability); duplicate.steps[1]!.id = "open";
  assert.throws(() => validateCapability(duplicate), /Duplicate step/);
  const output = structuredClone(capability); output.outputs.message!.source = { savedValue: "missing" };
  assert.throws(() => validateCapability(output), /Unknown saved value/);
  const ephemeral = structuredClone(capability); ephemeral.targets.message = { strategies: [{ kind: "css", selector: "[data-cap-node=n1]", frames: [] }] };
  assert.throws(() => validateCapability(ephemeral), /Session identifiers/);
  assert.throws(() => validateCapability({ ...capability, arbitraryCode: "..." }), /does not match/);
});

test("resolver supports frame-aware role, scoped parameter binding, and rejects ambiguous/conflicting targets", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<button>A</button><button>B</button><table><tbody><tr><td>row.1</td><td><a href="#one">edit</a></td></tr><tr><td>rowX1</td><td><a href="#two">edit</a></td></tr></tbody></table><iframe id="child" srcdoc="<button>Inside</button>"></iframe>');
    const frame = await resolveTarget(page, { strategies: [{ kind: "role", role: "button", name: { literal: "Inside" }, frames: ["#child"] }] }, {});
    assert.equal(await frame.innerText(), "Inside");
    const row = await resolveTarget(page, { strategies: [{ kind: "role", role: "link", name: { literal: "edit" }, frames: [], scope: { css: "tr", has: { css: "td:first-child", text: { input: "rowKey" } } } }] }, { rowKey: "row.1" });
    assert.equal(await row.getAttribute("href"), "#one");
    await assert.rejects(resolveTarget(page, { strategies: [{ kind: "css", selector: "button", frames: [] }] }, {}), /multiple elements/);
    await assert.rejects(resolveTarget(page, { strategies: [{ kind: "css", selector: "button:first-child", frames: [] }, { kind: "role", role: "button", name: { literal: "B" }, frames: [] }] }, {}), /different elements/);
  } finally { await browser.close(); }
});

test("builder validates recorded identity and rejects invented actions, locators, values and checkpoints", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<div id="message">Observed</div><div id="other">Different</div><a href="#done">Next</a>');
    const initial = await captureSnapshot(page);
    initial.url = "https://example.test/";
    const node = await page.locator("#message").getAttribute("data-cap-node");
    const link = await page.locator("a").getAttribute("data-cap-node");
    const after = structuredClone(initial); after.url += "#done";
    const cap = structuredClone(capability); (cap.steps[0] as { url: string }).url = initial.url;
    const evidence: DiscoveryEvidence = {
      evidenceVersion: "2.0", completed: true,
      request: { id: "fixture", goal: "Read message and click Next", url: initial.url, dataMode: "public-test", inputs: {}, bindings: {}, outputs: { message: { type: "string", description: "Message" } } },
      actions: [
        { index: 1, name: "navigate", before: initial, after: initial, target: null, input: { url: initial.url }, success: true },
        { index: 2, name: "get_page_text", before: initial, after: initial, target: null, input: {}, observation: "Observed Different Next", success: true },
        { index: 3, name: "left_click", before: initial, after, target: { frame: 0, node: link! }, input: {}, success: true },
      ],
    };
    // Synthetic unit fixture, explicitly not submitted as LLM discovery evidence.
    const candidate: Candidate = { capability: cap, stepEvidence: { open: { action: 1, phase: "after" }, read: { action: 2, phase: "after", node: { frame: 0, node: node! } }, click: { action: 3, phase: "before", node: { frame: 0, node: link! } } }, checkpointEvidence: [{ action: 3, phase: "after" }] };
    const compact = compilationEvidence(evidence);
    assert.equal(Object.keys(compact.states).length, 2);
    compact.actions.forEach((action, index) => {
      assert.deepEqual(compact.states[action.before], evidence.actions[index]!.before);
      assert.deepEqual(compact.states[action.after], evidence.actions[index]!.after);
    });
    const policy: Policy = {...fixtureSafety, origins: ["https://example.test"], actions: ["navigate", "click", "extract"] };
    // A model end_turn after navigation failure must not make this compilable.
    assert.throws(() => checkDiscoveryEvidence({ ...evidence, actions: evidence.actions.slice(1) }), /failed or missing actions/);
    const unreachable = structuredClone(evidence); unreachable.actions[0]!.after.url = "chrome-error://chromewebdata/";
    assert.throws(() => checkDiscoveryEvidence(unreachable), /never reached/);
    await validateCandidate(candidate, evidence, policy);
    const wrong = structuredClone(candidate); wrong.capability.targets.message = { strategies: [{ kind: "css", selector: "#other", frames: [] }] };
    await assert.rejects(validateCandidate(wrong, evidence, policy), /does not match the cited/);
    const invented = structuredClone(candidate); invented.stepEvidence.click!.node!.node = node!;
    await assert.rejects(validateCandidate(invented, evidence, policy), /does not match the cited/);
    const checkpoint = structuredClone(candidate); checkpoint.capability.checkpoints = [{ kind: "urlHash", value: "#invented" }];
    await assert.rejects(validateCandidate(checkpoint, evidence, policy), /not supported/);
    const skipped = structuredClone(candidate); skipped.capability.steps.pop(); delete skipped.stepEvidence.click;
    await assert.rejects(validateCandidate(skipped, evidence, policy), /omits an executed/);
    await assert.rejects(validateCandidate(candidate, { ...evidence, completed: false }, policy), /completed v2/);
  } finally { await browser.close(); }
});

test("builder verifies a native select's recorded chosen option", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<label for="type">Account type</label><select id="type"><option value="">Choose</option><option value="sav">Savings</option></select>');
    const before = await captureSnapshot(page);
    before.url = "https://example.test/";
    const node = (await page.locator("#type").getAttribute("data-cap-node"))!;
    await page.locator("#type").selectOption({ label: "Savings" });
    const after = await captureSnapshot(page);
    after.url = before.url;
    assert.deepEqual(after.frames[0]!.nodes[node]!.selectedOption, { label: "Savings", value: "sav" });
    assert.match(after.frames[0]!.html, /option[^>]*selected=""[^>]*>Savings/);
    const cap: Capability = {
      schemaVersion: "2.0", id: "selectFixture", version: "1.0.0", description: "Select a synthetic option",
      inputs: { accountType: { type: "string", required: true, description: "Requested type" } },
      targets: { type: { strategies: [{ kind: "role", role: "combobox", name: { literal: "Account type" }, frames: [] }] } },
      steps: [{ id: "open", action: "navigate", url: before.url }, { id: "choose", action: "selectOption", target: "type", by: "label", value: { input: "accountType" } }],
      outputs: { url: { type: "string", description: "Page URL", source: { page: "url" } } },
      checkpoints: [{ kind: "visible", target: "type" }],
    };
    const evidence: DiscoveryEvidence = {
      evidenceVersion: "2.0", completed: true,
      request: { id: "selectFixture", goal: "Choose Savings", url: before.url, dataMode: "public-test", inputs: cap.inputs, bindings: { accountType: "Savings" }, outputs: { url: { type: "string", description: "Page URL" } } },
      actions: [
        { index: 1, name: "navigate", before, after: before, target: null, input: { url: before.url }, success: true },
        { index: 2, name: "form_input", before, after, target: { frame: 0, node }, input: { value: { input: "accountType" } }, success: true },
      ],
    };
    const candidate: Candidate = { capability: cap, stepEvidence: { open: { action: 1, phase: "after" }, choose: { action: 2, phase: "before", node: { frame: 0, node } } }, checkpointEvidence: [{ action: 2, phase: "after", node: { frame: 0, node } }] };
    const policy: Policy = {...fixtureSafety, origins: ["https://example.test"], actions: ["navigate", "selectOption"] };
    await validateCandidate(candidate, evidence, policy);
    const forged = structuredClone(evidence); forged.actions[1]!.after.frames[0]!.nodes[node]!.selectedOption = { label: "Checking", value: "chk" };
    await assert.rejects(validateCandidate(candidate, forged, policy), /Selected option is not supported/);
    const oldFill = structuredClone(candidate); oldFill.capability.steps[1] = { id: "choose", action: "fill", target: "type", value: { input: "accountType" } };
    await assert.rejects(validateCandidate(oldFill, evidence, { ...policy, actions: [...policy.actions, "fill"] }), /requires selectOption/);
  } finally { await browser.close(); }
});

test("replay selects by parameterized label or value", async () => {
  const server = createServer((_request, response) => {
    response.setHeader("content-type", "text/html");
    response.end('<label for="type">Account type</label><select id="type" onchange="document.querySelector(\'#result\').textContent=this.selectedOptions[0].label"><option value="">Choose</option><option value="sav">Savings</option></select><output id="result"></output>');
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/`;
  const directory = mkdtempSync(join(tmpdir(), "select-replay-"));
  const policy: Policy = {...fixtureSafety, origins: [new URL(url).origin], actions: ["navigate", "selectOption", "extract"] };
  try {
    const cap: Capability = {
      schemaVersion: "2.0", id: "selectReplay", version: "1.0.0", description: "Synthetic select replay",
      inputs: { choice: { type: "string", required: true, description: "Option label or value" } },
      targets: { type: { strategies: [{ kind: "css", selector: "#type", frames: [] }] }, selected: { strategies: [{ kind: "css", selector: "#result", frames: [] }] } },
      steps: [{ id: "open", action: "navigate", url }, { id: "choose", action: "selectOption", target: "type", by: "label", value: { input: "choice" } }, { id: "read", action: "extract", target: "selected", saveAs: "selected" }],
      outputs: { selected: { type: "string", description: "Selected label", source: { savedValue: "selected" } } },
      checkpoints: [{ kind: "textEquals", target: "selected", value: { literal: "Savings" } }],
    };
    const path = join(directory, "artifact.json");
    for (const [by, choice] of [["label", "Savings"], ["value", "sav"]] as const) {
      (cap.steps[1] as { by: "label" | "value" }).by = by;
      writeFileSync(path, JSON.stringify(cap));
      const result = await replayCapability(path, { choice }, join(directory, by), policy);
      assert.equal(result.status, "SUCCESS", JSON.stringify(result));
      assert.equal(result.outputs?.selected, "Savings");
    }
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});

test("generic replay executes fill, click, wait, extract, assert; returns structured failures", async () => {
  const server = createServer((_request, response) => {
    response.setHeader("content-type", "text/html");
    response.end('<input aria-label="Name"><button id="show" onclick="setTimeout(() => {document.querySelector(\'#result\').textContent = document.querySelector(\'input\').value}, 80)">Show</button><div id="result"></div>');
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/`;
  const policy: Policy = {...fixtureSafety, origins: [new URL(url).origin], actions: ["navigate", "fill", "click", "wait", "extract", "assert"] };
  const directory = mkdtempSync(join(tmpdir(), "capability-test-"));
  try {
    const cap: Capability = {
      schemaVersion: "2.0", id: "form", version: "1.0.0", description: "Synthetic form test",
      inputs: { name: { type: "string", required: true, description: "Synthetic name" } },
      targets: { field: { strategies: [{ kind: "role", role: "textbox", name: { literal: "Name" }, frames: [] }] }, button: { strategies: [{ kind: "role", role: "button", name: { literal: "Show" }, frames: [] }] }, result: { strategies: [{ kind: "css", selector: "#result", frames: [] }] } },
      steps: [{ id: "open", action: "navigate", url }, { id: "fill", action: "fill", target: "field", value: { input: "name" } }, { id: "click", action: "click", target: "button" }, { id: "wait", action: "wait", condition: { kind: "textEquals", target: "result", value: { input: "name" } }, timeoutMs: 3000 }, { id: "read", action: "extract", target: "result", saveAs: "text" }, { id: "assert", action: "assert", condition: { kind: "textEquals", target: "result", value: { input: "name" } } }],
      outputs: { text: { type: "string", description: "Result", source: { savedValue: "text" } } }, checkpoints: [{ kind: "visible", target: "result" }],
    };
    const path = join(directory, "artifact.json"); writeFileSync(path, JSON.stringify(cap));
    for (const name of ["Alice-test", "Bob-test"]) {
      const result = await replayCapability(path, { name }, join(directory, name), policy);
      assert.equal(result.status, "SUCCESS"); assert.equal(result.outputs?.text, name);
    }
    const invalid = await replayCapability(path, {}, join(directory, "invalid"), policy);
    assert.equal(invalid.code, "INVALID_INPUT");
    writeFileSync(path, JSON.stringify({ ...cap, unsupported: true }));
    const malformed = await replayCapability(path, { name: "Alice-test" }, join(directory, "malformed"), policy);
    assert.equal(malformed.code, "INVALID_ARTIFACT");
    const ambiguous = structuredClone(cap); ambiguous.targets.field = { strategies: [{ kind: "css", selector: "input, button", frames: [] }] };
    writeFileSync(path, JSON.stringify(ambiguous));
    const ambiguousResult = await replayCapability(path, { name: "Alice-test" }, join(directory, "ambiguous"), policy);
    assert.equal(ambiguousResult.code, "AMBIGUOUS_TARGET");
    writeFileSync(path, JSON.stringify(cap));
    const denied = await replayCapability(path, { name: "Alice-test" }, join(directory, "denied"), { ...policy, actions: ["navigate"] });
    assert.equal(denied.code, "POLICY_DENIED");
    const missing = structuredClone(cap); missing.targets.result = { strategies: [{ kind: "css", selector: "#absent", frames: [] }] };
    (missing.steps[3] as { timeoutMs: number }).timeoutMs = 100;
    writeFileSync(path, JSON.stringify(missing));
    const timeout = await replayCapability(path, { name: "Alice-test" }, join(directory, "timeout"), policy);
    assert.equal(timeout.code, "WAIT_TIMEOUT");
    assert.ok(readFileSync(join(directory, "timeout", "failure.png.json")).length > 0);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});
