import test from "node:test";
import assert from "node:assert/strict";
import {mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {validateCapability, type Target} from "../../capability/contract.js";
import {PlaywrightAdapter, testPolicy, type Policy} from "../../surfaces/playwright.js";
import {replayCapability} from "../../replay/engine.js";

const root = resolve(process.env.RUNTIME_EVIDENCE_DIR ?? `evidence/runtime-3-3/${new Date().toISOString().replaceAll(":", "-")}`);
const base = process.env.BANKING_SANDBOX_URL ?? "http://localhost:8080/modern.html";
const css = (selector: string): Target => ({strategies: [{kind:"css",selector,frames:[]}]});
const targets = {q:css("#q"),search:css("#f button"),row:css("#out tbody tr td:first-child"),view:css("#out tbody button"),member:css("#out dd:first-of-type"),open:css("#o"),type:css("#t"),continue:css("#w button:not([type])"),status:css('#out p[role="status"]'),back:css("#b"),subs:css("#out > p:last-of-type"),ambiguous:css("button")};
const policy: Policy = {origins:[new URL(base).origin],actions:testPolicy.actions,detectors:[
 ...["NOT_FOUND","VALIDATION_ERROR","PERMISSION_DENIED","SESSION_EXPIRED"].map(code => ({code,status: (code === "NOT_FOUND" || code === "VALIDATION_ERROR" ? "BUSINESS_OUTCOME" : "HARD_FAILURE") as "BUSINESS_OUTCOME" | "HARD_FAILURE", target:css('[role="alert"]'),value:{literal:code},resolvesMutations:["create"]})),
 {code:"UNEXPECTED_DIALOG",status:"HARD_FAILURE",target:css('body > div:has(> div > button)'),value:{literal:"Scheduled maintenance notice."}},
 {code:"SLOW_LOADING",status:"RECOVERABLE_ERROR",target:targets.status,value:{literal:"Loading"}},
]};
function artifact(mode: string, create: boolean, timeoutMs: number) {
 const condition = {kind:"textContains",target:"row",value:{input:"memberId"}};
 const steps: unknown[] = [
 {id:"navigate",action:"navigate",url:`${base}?mode=${mode}`},
 {id:"query",action:"fill",target:"q",value:{input:"memberId"},effect:"readOnly"},
 {id:"search",action:"click",target:"search",effect:"readOnly"},
 {id:"waitSearch",action:"wait",condition,timeoutMs},
 ];
 if (create) steps.push(
 {id:"view",action:"click",target:"view",effect:"readOnly"},
 {id:"waitMember",action:"wait",condition:{kind:"textEquals",target:"member",value:{input:"memberId"}},timeoutMs},
 {id:"open",action:"click",target:"open",effect:"readOnly"},
 {id:"select",action:"selectOption",target:"type",by:"label",value:{input:"accountType"},effect:"readOnly"},
 {id:"create",action:"click",target:"continue",effect:"stateChanging"},
 {id:"waitConfirmation",action:"wait",condition:{kind:"textContains",target:"status",value:{literal:"opened for"}},timeoutMs},
 {id:"verifyMember",action:"assert",condition:{kind:"textContains",target:"status",value:{input:"memberId"}}},
 {id:"verifyType",action:"assert",condition:{kind:"textContains",target:"status",value:{input:"accountType"}},confirms:"create"},
 {id:"status",action:"extract",target:"status",saveAs:"status"},
 {id:"back",action:"click",target:"back",effect:"readOnly"},
 {id:"verifyCreated",action:"wait",condition:{kind:"textContains",target:"subs",value:{input:"accountType"}},timeoutMs},
 );
 else steps.push({id:"status",action:"extract",target:"row",saveAs:"status"});
 return validateCapability({schemaVersion:"2.0",id:"banking-runtime-fixture",version:"1.0.0",description:"Hand-authored isolated runtime test fixture; not LLM discovery evidence",inputs:{memberId:{type:"string",required:true,description:"Synthetic member"},accountType:{type:"string",required:true,description:"Synthetic type"}},targets,steps,outputs:{status:{type:"string",description:"Observed UI result",source:{savedValue:"status"}}},checkpoints:[create ? {kind:"textContains",target:"subs",value:{input:"memberId"}} : condition]});
}
const scenarios = [
 {name:"happy-M1001",mode:"NONE",create:true,status:"SUCCESS",code:"SUCCESS",step:"checkpoints"},
 {name:"parameterized-M1002",mode:"NONE",create:true,status:"SUCCESS",code:"SUCCESS",step:"checkpoints",member:"M-1002"},
 {name:"NOT_FOUND",mode:"NOT_FOUND",create:false,status:"BUSINESS_OUTCOME",code:"NOT_FOUND",step:"waitSearch"},
 {name:"VALIDATION_ERROR",mode:"VALIDATION_ERROR",create:true,status:"BUSINESS_OUTCOME",code:"VALIDATION_ERROR",step:"waitConfirmation"},
 {name:"PERMISSION_DENIED",mode:"PERMISSION_DENIED",create:true,status:"HARD_FAILURE",code:"PERMISSION_DENIED",step:"waitConfirmation"},
 {name:"SESSION_EXPIRED",mode:"SESSION_EXPIRED",create:false,status:"HARD_FAILURE",code:"SESSION_EXPIRED",step:"waitSearch"},
 {name:"SLOW_LOADING",mode:"SLOW_LOADING",create:false,status:"SUCCESS",code:"SUCCESS",step:"checkpoints",timeout:6000},
 {name:"TIMEOUT",mode:"TIMEOUT",create:false,status:"RECOVERABLE_ERROR",code:"WAIT_TIMEOUT",step:"waitSearch",timeout:350},
 {name:"UNEXPECTED_DIALOG",mode:"UNEXPECTED_DIALOG",create:false,status:"HARD_FAILURE",code:"UNEXPECTED_DIALOG",step:"waitSearch"},
 {name:"AMBIGUOUS_TARGET",mode:"NONE",create:false,status:"HARD_FAILURE",code:"AMBIGUOUS_TARGET",step:"search"},
 {name:"committed-but-unverified",mode:"NONE",create:true,status:"OUTCOME_UNKNOWN",code:"WAIT_TIMEOUT",step:"waitConfirmation",timeout:700},
 {name:"unconfirmed-write",mode:"NONE",create:true,status:"OUTCOME_UNKNOWN",code:"WAIT_TIMEOUT",step:"waitConfirmation",timeout:100},
];
mkdirSync(root,{recursive:true});
writeFileSync(join(root,"README.md"),"# Runtime fixture tests\n\nHand-authored artifacts exercise the existing Banking Sandbox in isolated browser contexts. These are NOT new Claude Discovery/Compilation runs. No Reset and no changes to banking UI source. See each scenario's artifact, policy, events, result and assertions.\n");
for (const scenario of scenarios) test(`banking ${scenario.name}`, async () => {
 const directory=join(root,scenario.name); mkdirSync(directory,{recursive:true});
 const cap=artifact(scenario.mode,scenario.create,scenario.timeout ?? 2500);
 if (scenario.name === "AMBIGUOUS_TARGET") (cap.steps.find(s=>s.id==="search") as {target:string}).target="ambiguous";
 // Only the post-write wait is shortened: lookup must finish normally.
 if(scenario.name === "unconfirmed-write") for(const s of cap.steps) if(s.action==="wait" && s.id!=="waitConfirmation") s.timeoutMs=2500;
 if(scenario.name === "committed-but-unverified") { const step=cap.steps.find(s=>s.id==="waitConfirmation"); if(step?.action === "wait") step.condition={kind:"textContains",target:"status",value:{literal:"Deliberately absent confirmation"}}; }
 const path=join(directory,"artifact.json");writeFileSync(path,JSON.stringify(cap,null,2));writeFileSync(join(directory,"policy.json"),JSON.stringify(policy,null,2));
 let creates=0; let finalState: unknown;
 const started=Date.now();
 const result=await replayCapability(path,{memberId:scenario.member ?? "M-1001",accountType:"Savings"},directory,policy,async(inputs,p)=>{
  const adapter=await PlaywrightAdapter.launch(inputs,p);
  const click=adapter.click.bind(adapter);
  adapter.click=async target=>{if(JSON.stringify(target)===JSON.stringify(targets.continue)) creates++;await click(target);};
  const close=adapter.close.bind(adapter);
  adapter.close=async()=>{finalState=await adapter.page.evaluate(()=>JSON.parse(localStorage.getItem("sbx") ?? "{}"));await close();};
  return adapter;
 });
 const elapsedMs=Date.now()-started;
 assert.equal(result.status,scenario.status,JSON.stringify(result));assert.equal(result.code,scenario.code);assert.equal(result.stepId,scenario.step);
 assert.equal(result.retryable,scenario.status==="RECOVERABLE_ERROR");
 const events=readFileSync(result.evidenceRef,"utf8").trim().split("\n").map(line=>JSON.parse(line));
 assert.equal(events.filter(e=>e.kind==="retry").length,0);
 assert.ok(creates<=1);assert.equal(events.filter(e=>e.kind==="step_start"&&e.stepId==="search").length,1);
 if(scenario.create) assert.equal(creates,1);
 if(scenario.status!=="SUCCESS") {assert.ok(result.expected);assert.ok(result.observed);assert.ok(readFileSync(join(directory,"failure.png")).length>0);}
 if(scenario.name==="SLOW_LOADING") {assert.ok(elapsedMs>=4000);assert.ok(events.some(e=>e.code==="SLOW_LOADING"));}
 if(scenario.name==="TIMEOUT") {assert.ok(elapsedMs>=350);assert.ok(elapsedMs<5000);}
 if(scenario.name==="unconfirmed-write") {assert.equal(result.reconciliationRequired,true);assert.ok(JSON.stringify(result.observed).includes("Loading"));}
 if(scenario.name==="committed-but-unverified") { assert.equal((finalState as {subs:Record<string,unknown[]>}).subs["M-1001"]?.length,1);assert.equal(result.reconciliationRequired,true);assert.equal(creates,1); }
 if(scenario.status==="SUCCESS"&&scenario.create) assert.equal((finalState as {subs:Record<string,unknown[]>}).subs[scenario.member??"M-1001"]?.length,1);
 writeFileSync(join(directory,"assertions.json"),JSON.stringify({passed:true,elapsedMs,creates,finalState,result},null,2));
 console.log(`Evidence: ${directory}`);
});
