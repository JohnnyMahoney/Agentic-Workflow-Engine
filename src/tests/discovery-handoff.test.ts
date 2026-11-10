import test from "node:test";
import assert from "node:assert/strict";
import Anthropic from "@anthropic-ai/sdk";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ActiveDiscoveryBudget, DiscoveryQueue } from "../discovery/execution-control.js";
import { runDiscovery } from "../discovery/run.js";
import { LocalPlaywrightBrowser } from "../discovery/local-browser.js";
import { admitDiscoveryEvidence, checkDiscoveryEvidence, readDiscoveryAudit } from "../discovery/acceptance.js";
import { validateHumanEvidence } from "../discovery/human-evidence.js";
import { humanRequestSchema } from "../discovery/handoff.js";
import { buildArtifact } from "../capability/builder.js";
import { compileEvidence } from "../capability/compile.js";
import type { DiscoveryEvidence } from "../capability/evidence.js";
import { PlaywrightAdapter, testPolicy, type Policy } from "../surfaces/playwright.js";
import { replayCapability } from "../replay/engine.js";
import type { HandoffController } from "../replay/handoff.js";

const root = resolve(process.env.DISCOVERY_HANDOFF_EVIDENCE_DIR ?? mkdtempSync(join(tmpdir(), "discovery-handoff-")));
const sleep = (ms: number) => new Promise(done => setTimeout(done, ms));

test("Discovery active budget pauses without losing its bound; shared queue serializes tools", async () => {
  const abort = new AbortController(); const budget = new ActiveDiscoveryBudget(abort, 100);
  budget.pause(); await sleep(150); assert.equal(abort.signal.aborted, false);
  budget.resume(); await sleep(150); assert.equal(abort.signal.aborted, true); budget.close();
  const queue = new DiscoveryQueue(); const order: string[] = [];
  await Promise.all([queue.run(async () => { order.push("human"); await sleep(20); order.push("resume"); }), queue.run(async () => { order.push("browser"); })]);
  assert.deepEqual(order, ["human", "resume", "browser"]);
  assert.throws(() => humanRequestSchema.parse({reason: "BYPASS_POLICY", description: "x"}));
});

for (const scenario of ["dismiss", "policy-guard", "stale-action", "driver-fallback", "business-action", "abort", "unresolved", "unresolved-stop", "network-outage"]) {
  test(`Discovery SDK integration: ${scenario} (scripted API, real browser)`, async () => {
    const server = createServer((_, response) => { response.setHeader("Content-Type", "text/html"); response.end('<main><p id="member">M-1001</p><p id="balance">$0.00</p><button id="business" onclick="document.querySelector(\'#balance\').textContent=\'$100.00\'">Business action</button></main><div id="blocker" role="dialog"><p>Operator acknowledgement required</p><button id="dismiss" onclick="document.querySelector(\'#blocker\').remove()">Acknowledge</button></div>'); });
    await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}/`;
    const policy = {...testPolicy, origins: [new URL(url).origin], humanBlockers: [{url, container: "#blocker", dismiss: "#dismiss"}]};
    const directory = join(root, scenario); mkdirSync(directory, {recursive: true});
    let browser: LocalPlaywrightBrowser; let launchCount = 0; let calls = 0; let humanRequests = 0;
    const bodies: {messages: unknown[]; tools: {name?: string}[]}[] = [];
    const tool = (name: string, input: unknown, browserMember = true) => ({type: "tool_use", id: `tool-${calls}`, name, input, ...(browserMember ? {toolset_name: "browser"} : {})});
    const client = new Anthropic({apiKey: "scripted-test-only", maxRetries: 0, fetch: async (_request, options) => {
      if (scenario === "network-outage") throw new Error("Injected API outage");
      calls++; bodies.push(JSON.parse(String(options?.body)));
      if (scenario === "dismiss" && calls === 2) {
        // Reproduce the operator clicking BEFORE Claude requests handoff.
        // Direct DOM dispatch bypasses CDP and must still be blocked.
        await browser.page.locator("#dismiss").evaluate(button => (button as HTMLButtonElement).click());
        assert.equal(await browser.page.locator("#blocker").count(), 1);
        await browser.page.locator("#business").evaluate(button => (button as HTMLButtonElement).click());
        assert.equal(await browser.page.locator("#balance").innerText(), "$0.00");
      }
      let content;
      if (scenario === "policy-guard") {
        content = calls === 1 ? [tool("navigate", {url})] : calls === 2 || calls === 5 ? [tool("read_page", {})] : calls === 3 ? [tool("left_click", {target: {type: "ref", ref: "ref_2"}})] : calls === 4 ? [tool("request_human", {reason: "AUTH_REQUIRED", description: "Policy requires a human"}, false)] : calls === 6 ? [tool("get_page_text", {})] : [{type: "text", text: "Done"}];
      } else if (scenario === "driver-fallback") {
        content = calls === 1 ? [tool("navigate", {url})] : calls === 2 || calls === 9 ? [tool("read_page", {})] : calls <= 10 ? [tool("get_page_text", {})] : [{type: "text", text: "Done"}];
      } else if (scenario === "stale-action") {
        content = calls === 1 ? [tool("navigate", {url})] : calls === 2 || calls === 5 ? [tool("read_page", {})] : calls === 3 ? [tool("request_human", {reason: "AUTH_REQUIRED", description: "Operator is required"}, false)] : calls === 4 ? [tool("left_click", {target: {type: "ref", ref: "ref_1"}})] : calls === 6 ? [tool("get_page_text", {})] : [{type: "text", text: "Done"}];
      } else {
        content = calls === 1 ? [tool("navigate", {url})] : calls === 2 ? [tool("read_page", {})] : calls === 3 || (scenario === "unresolved" && calls > 3) ? [tool("request_human", {reason: "AUTH_REQUIRED", description: "Operator is required"}, false)] : calls === 4 ? [tool("read_page", {})] : calls === 5 ? [tool("get_page_text", {})] : [{type: "text", text: "Observed M-1001 and $0.00"}];
      }
      return new Response(JSON.stringify({id: `msg-${calls}`, type: "message", role: "assistant", model: "scripted", content, stop_reason: content[0]!.type === "text" ? "end_turn" : "tool_use", stop_sequence: null, usage: {input_tokens: 1, output_tokens: 1}}), {headers: {"content-type": "application/json"}});
    }});
    let command = 0;
    const controller: HandoffController = {
      open: () => { humanRequests++; command = 0; }, close: () => {},
      nextCommand: async () => {
        if (scenario === "abort") return "abort";
        if (command++ === 0) return "take-control";
        if (["dismiss", "policy-guard", "stale-action", "driver-fallback", "business-action"].includes(scenario)) await browser.page.locator("#dismiss").click();
        if (scenario === "business-action") await browser.page.locator("#business").click();
        return "resume";
      },
    };
    try {
      const summary = await runDiscovery({name: scenario, url, goal: "Read member and balance after operator acknowledgement", model: "scripted", headless: true, directory, policy, client,
        createBrowser: async (headless, rules) => { launchCount++; browser = await LocalPlaywrightBrowser.launch(headless, rules); return browser; },
        handoff: {controller, timeoutMs: 1000}, compilationRequest: {id: scenario, goal: "Read member and balance", url, dataMode: "synthetic-test", inputs: {}, bindings: {}, outputs: {balance: {type: "string", description: "Observed balance"}}}});
      const evidence = JSON.parse(readFileSync(join(directory, "discovery-v2.json"), "utf8")) as DiscoveryEvidence;
      const audit = readDiscoveryAudit(join(directory, "discovery-v2.json"))!;
      assert.equal(launchCount, 1);
      if (["abort", "unresolved", "network-outage"].includes(scenario)) {
        assert.equal((summary.assessment as {completed: boolean}).completed, false);
        assert.throws(() => checkDiscoveryEvidence(evidence, audit, policy));
        assert.equal(humanRequests, scenario === "unresolved" ? 3 : scenario === "abort" ? 1 : 0);
      } else {
        assert.equal((summary.assessment as {completed: boolean}).completed, true);
        assert.ok(bodies[0]!.tools.some(t => t.name === "request_human"));
        assert.ok(bodies.at(-1)!.messages.length > bodies[0]!.messages.length);
        if (scenario !== "driver-fallback") assert.ok(JSON.stringify(bodies.at(-1)).includes("operator_resumed"));
        else assert.equal(evidence.interventions![0]!.source, "driver");
        if (["policy-guard", "stale-action"].includes(scenario)) assert.ok(audit.events.some(event => event.kind === "browser_action_not_executed"));
        assert.equal(evidence.actions.some(action => action.name === "request_human"), false);
        if (["dismiss", "policy-guard", "stale-action", "driver-fallback"].includes(scenario)) {
          checkDiscoveryEvidence(evidence, audit, policy);
          await validateHumanEvidence(evidence, policy);
          await assert.rejects(validateHumanEvidence(evidence, {...policy, humanBlockers: []}), /not a proven/);
          const omitted = structuredClone(evidence); delete omitted.interventions;
          assert.throws(() => checkDiscoveryEvidence(omitted, audit, policy), /omitted/);
          const last = evidence.actions.at(-1)!;
          const node = Object.entries(last.after.frames[0]!.nodes).find(([, facts]) => facts.text === "$0.00")![0];
          const ref = {action: last.index, phase: "after", node: {frame: 0, node}};
          const candidate = {capability: {schemaVersion: "2.1", id: "scripted-compilation-fixture", version: "1.0.0", description: "Hand-authored candidate for Builder regression; not Claude compilation", inputs: {},
            targets: {balance: {strategies: [{kind: "css", selector: "#balance", frames: []}]}},
            steps: [{id: "open", action: "navigate", url}, {id: "read", action: "extract", target: "balance", saveAs: "value"}],
            outputs: {balance: {type: "string", description: "Observed balance", source: {savedValue: "value"}, validation: {condition: {kind: "textEquals", value: {literal: "$0.00"}}, timeoutMs: 1000}}},
            checkpoints: [{kind: "textEquals", target: "balance", value: {literal: "$0.00"}}]},
            stepEvidence: {open: {action: 1, phase: "after"}, read: ref}, checkpointEvidence: [ref]};
          const out = join(directory, "builder"); mkdirSync(out);
          const candidatePath = join(out, "candidate.json"); writeFileSync(candidatePath, JSON.stringify(candidate));
          await buildArtifact(candidatePath, join(directory, "discovery-v2.json"), out, policy);
          assert.ok(existsSync(join(out, "artifact.json")));
          if (scenario === "dismiss") {
            let replayBrowser: PlaywrightAdapter; let replayCommands = 0; let replayRequests = 0;
            const replayPolicy: Policy = {...policy, detectors: [{code: "UNEXPECTED_DIALOG", status: "HARD_FAILURE",
              target: {strategies: [{kind: "css", selector: "#blocker", frames: []}]}, value: {literal: "Operator acknowledgement required"}}]};
            const result = await replayCapability(join(out, "artifact.json"), {}, join(directory, "fresh-replay"), replayPolicy,
              async (inputs, rules) => { replayBrowser = await PlaywrightAdapter.launch(inputs, rules); return replayBrowser; },
              {controller: {open: () => { replayRequests++; }, close: () => {}, nextCommand: async () => {
                if (replayCommands++ === 0) return "take-control";
                await replayBrowser.page.locator("#dismiss").click(); return "resume";
              }}});
            assert.equal(replayRequests, 1);
            assert.equal(result.status, "SUCCESS");
            assert.equal(result.outputs?.balance, "$0.00");
          }
        } else if (scenario === "unresolved-stop") {
          // Claude may end its turn normally with an honest refusal. That is
          // not proof of goal completion or resolved intervention.
          checkDiscoveryEvidence(evidence, audit, policy);
          await assert.rejects(admitDiscoveryEvidence(evidence, audit, policy), {code: "DISCOVERY_HANDOFF_UNRESOLVED"});
          const out = join(directory, "rejected-compilation");
          await assert.rejects(compileEvidence(join(directory, "discovery-v2.json"), out, "must-not-call-model", policy), {code: "DISCOVERY_HANDOFF_UNRESOLVED"});
          assert.equal(existsSync(join(out, "artifact.json")), false);
        } else {
          await assert.rejects(validateHumanEvidence(evidence, policy), /not a proven/);
          const out = join(directory, "rejected-compilation");
          await assert.rejects(compileEvidence(join(directory, "discovery-v2.json"), out, "must-not-call-model", policy), /not a proven/);
          assert.equal(existsSync(join(out, "artifact.json")), false);
        }
      }
      writeFileSync(join(directory, "test-verification.json"), JSON.stringify({passed: true, scriptedAPI: true, realBrowser: true, simulatedOperator: true, launchCount, calls, humanRequests}, null, 2));
    } finally { await new Promise<void>(done => server.close(() => done())); }
  });
}
