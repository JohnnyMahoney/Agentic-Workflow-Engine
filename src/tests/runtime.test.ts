import test from "node:test";
import assert from "node:assert/strict";
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {resolve,join} from "node:path";
import {CapabilityError,validateCapability,type Capability} from "../capability/contract.js";
import {validateCandidate} from "../capability/builder.js";
import {replayCapability} from "../replay/engine.js";
import type {SurfaceAdapter} from "../surfaces/adapter.js";
import {testPolicy} from "../surfaces/playwright.js";

const root=resolve(process.env.RUNTIME_UNIT_EVIDENCE_DIR ?? mkdtempSync(join(tmpdir(),"runtime-tests-")));
const cap = (steps: unknown[]): Capability => validateCapability({schemaVersion:"2.0",id:"runtime-fixture",version:"1.0.0",description:"Unit fixture, not discovery",inputs:{id:{type:"string",required:true,description:"Identity"}},targets:{state:{strategies:[{kind:"css",selector:"#state"}]}},steps,outputs:{},checkpoints:[{kind:"textContains",target:"state",value:{input:"id"}}]});
const fake = (): SurfaceAdapter => ({navigate:async()=>{},click:async()=>{},fill:async()=>{},selectOption:async()=>{},extract:async()=>"Confirmed M-1001 Savings",visible:async()=>true,url:()=>"https://the-internet.herokuapp.com/",captureFailure:async path=>{writeFileSync(path.replace("failure.png","mock-diagnostic.json"),JSON.stringify({mock:true}));throw new Error("Mock adapter has no screenshot");},close:async()=>{}});
async function run(name:string,artifact:Capability,adapter:SurfaceAdapter) {const dir=join(root,name);mkdirSync(dir,{recursive:true});const path=join(dir,"artifact.json");writeFileSync(path,JSON.stringify(artifact,null,2));return replayCapability(path,{id:"M-1001"},dir,testPolicy,async()=>adapter);}
test("textContains rejects loading, waits for actual input-bound confirmation",async()=>{
 const adapter=fake();const start=Date.now();let polls=0;
 adapter.extract=async()=>{polls++;return Date.now()-start<100 ? "Loading..." : "Confirmed M-1001 Savings";};
 const result=await run("loading",cap([{id:"confirmation",action:"wait",condition:{kind:"textContains",target:"state",value:{input:"id"}},timeoutMs:500}]),adapter);
 assert.equal(result.status,"SUCCESS");assert.ok(polls>=3);assert.ok(Date.now()-start>=100);
});
test("safe extract retries are bounded; missing target and ambiguous target fail closed",async()=>{
 for(const code of ["TARGET_NOT_FOUND","AMBIGUOUS_TARGET"]){
  const adapter=fake();let attempts=0;adapter.extract=async()=>{attempts++;throw new CapabilityError(code,"fixture");};
  const result=await run(code,cap([{id:"read",action:"extract",target:"state",saveAs:"v",retry:{maxAttempts:3,delayMs:20}}]),adapter);
  assert.equal(result.status,"HARD_FAILURE");assert.equal(result.stepId,"read");assert.equal(result.code,code);assert.equal(result.retryable,false);assert.equal(attempts,code==="TARGET_NOT_FOUND"?3:1);
  const events=readFileSync(result.evidenceRef,"utf8");assert.equal(events.split('"kind":"retry"').length-1,attempts-1);
 }
 const adapter=fake();let attempts=0;adapter.extract=async()=>{if(++attempts<3)throw new CapabilityError("TARGET_NOT_FOUND","temporary");return "M-1001";};
 assert.equal((await run("retry-success",cap([{id:"read",action:"extract",target:"state",saveAs:"v",retry:{maxAttempts:3,delayMs:20}}]),adapter)).status,"SUCCESS");
});
test("write timeout is unknown, never repeats; explicit confirmation clears uncertainty",async()=>{
 const adapter=fake();let writes=0;adapter.click=async()=>{writes++;};adapter.extract=async()=>"Loading...";
 const artifact=cap([{id:"write",action:"click",target:"state",effect:"stateChanging"},{id:"confirm",action:"wait",condition:{kind:"textContains",target:"state",value:{input:"id"}},timeoutMs:80,confirms:"write"}]);
 const result=await run("unknown",artifact,adapter);
 assert.equal(result.status,"OUTCOME_UNKNOWN");assert.equal(result.stepId,"confirm");assert.equal(result.retryable,false);assert.equal(result.reconciliationRequired,true);assert.equal(writes,1);assert.deepEqual(result.observed,{visible:true,text:"Loading..."});
 const confirmed=fake();confirmed.click=async()=>{writes++;};
 artifact.steps.push({id:"later",action:"assert",condition:{kind:"textEquals",target:"state",value:{literal:"different"}}});
 const failure=await run("confirmed-then-failure",artifact,confirmed);assert.equal(failure.status,"HARD_FAILURE");assert.equal(failure.code,"ASSERTION_FAILED");assert.equal(failure.stepId,"later");
});
test("native dialog and timeout are not guessed authentication failures",async()=>{
 const adapter=fake();adapter.unexpectedDialog=()=>"alert: unexpected";
 const dialog=await run("native-dialog",cap([{id:"read",action:"extract",target:"state",saveAs:"v"}]),adapter);
 assert.equal(dialog.status,"HARD_FAILURE");assert.equal(dialog.code,"UNEXPECTED_DIALOG");assert.equal(dialog.stepId,"read");
 const slow=fake();slow.extract=async()=>"Loading...";
 const timeout=await run("timeout",cap([{id:"wait",action:"wait",condition:{kind:"textContains",target:"state",value:{literal:"confirmed"}},timeoutMs:50}]),slow);
 assert.equal(timeout.status,"RECOVERABLE_ERROR");assert.equal(timeout.code,"WAIT_TIMEOUT");assert.equal(timeout.retryable,true);assert.ok(timeout.expected);assert.ok(timeout.observed);
});
test("explicit writes require confirmation and prohibit restart after later timeout",async()=>{
 const artifact=cap([{id:"write",action:"click",target:"state",effect:"stateChanging"}]);
 const unconfirmed=await run("missing-confirmation",artifact,fake());
 assert.equal(unconfirmed.status,"OUTCOME_UNKNOWN");assert.equal(unconfirmed.code,"UNCONFIRMED_MUTATION");assert.equal(unconfirmed.retryable,false);
 artifact.steps.push({id:"confirm",action:"assert",condition:{kind:"textContains",target:"state",value:{input:"id"}},confirms:"write"}, {id:"later",action:"wait",condition:{kind:"textEquals",target:"state",value:{literal:"unobserved"}},timeoutMs:50});
 const timeout=await run("confirmed-write-later-timeout",artifact,fake());
 assert.equal(timeout.status,"RECOVERABLE_ERROR");assert.equal(timeout.stepId,"later");assert.equal(timeout.retryable,false);
 assert.throws(()=>cap([{id:"write",action:"click",target:"state",effect:"stateChanging"},{id:"confirm",action:"assert",condition:{kind:"visible",target:"state"},confirms:"write"}]),/semantic condition/);
});
test("Builder rejects historical Case 2 premature confirmation using real saved evidence",async()=>{
 const source="evidence/modern-ui-testing/test-2-current-state";
 const candidate=JSON.parse(readFileSync(join(source,"compilation-4/candidate.json"),"utf8"));
 const evidence=JSON.parse(readFileSync(join(source,"discovery-5/discovery-v2.json"),"utf8"));
 const policy=JSON.parse(readFileSync(join(source,"policy-select.json"),"utf8"));
 const dir=join(root,"historical-checkpoint");mkdirSync(dir,{recursive:true});
 await assert.rejects(validateCandidate(candidate,evidence,policy),error=>{
  assert.ok(error instanceof CapabilityError);assert.equal(error.code,"PREMATURE_CHECKPOINT");assert.ok(JSON.stringify(error.details.observed).includes("Loading"));
  writeFileSync(join(dir,"rejection.json"),JSON.stringify({source,code:error.code,details:error.details},null,2));return true;
 });
 const wait = candidate.capability.steps.find((step: {id:string}) => step.id === "waitConfirmation");
 wait.condition={kind:"textContains",target:"confirmationStatus",value:{literal:"opened for"}};
 candidate.capability.steps.find((step: {id:string}) => step.id === "clickContinue").effect="stateChanging";
 const at=candidate.capability.steps.indexOf(wait)+1;
 candidate.capability.steps.splice(at,0,
  {id:"verifyMember",action:"assert",condition:{kind:"textContains",target:"confirmationStatus",value:{input:"memberId"}}},
  {id:"verifyType",action:"assert",condition:{kind:"textContains",target:"confirmationStatus",value:{input:"accountType"}},confirms:"clickContinue"});
 candidate.stepEvidence.verifyMember=candidate.stepEvidence.waitConfirmation;
 candidate.stepEvidence.verifyType=candidate.stepEvidence.waitConfirmation;
 const verified=await validateCandidate(candidate,evidence,policy);
 writeFileSync(join(dir,"manually-strengthened-candidate.json"),JSON.stringify(candidate,null,2));
 writeFileSync(join(dir,"validation.json"),JSON.stringify({status:"validated",origin:"Hand-edited regression fixture; NOT a new Claude compilation and NOT replayed",source,steps:verified.steps.length},null,2));
});
