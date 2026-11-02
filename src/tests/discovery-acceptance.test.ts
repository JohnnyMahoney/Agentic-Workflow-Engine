import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {checkDiscoveryEvidence,readDiscoveryAudit,type DiscoveryAudit} from '../discovery/acceptance.js';
import {BeforeDispatchError,FORM_INPUT_REJECTED_MESSAGE} from '../discovery/failures.js';
import {LocalPlaywrightBrowser} from '../discovery/local-browser.js';
import {validateCandidate,type Candidate} from '../capability/builder.js';
import {validateCapability,type Capability} from '../capability/contract.js';
import type {DiscoveryEvidence,Snapshot} from '../capability/evidence.js';
import {testPolicy,type Policy} from '../surfaces/playwright.js';
const root=resolve(process.env.RECOVERY_EVIDENCE_DIR??mkdtempSync(join(tmpdir(),'recovered-discovery-')));
function fixture(){
 const snapshot=(text:string):Snapshot=>({url:'https://example.test/',frames:[{id:0,parent:null,elementNode:null,html:`<input id="q" data-cap-node="n1" data-browser-ref="ref_1"><div id="result" data-cap-node="n2">${text}</div>`,nodes:{n1:{text:'',visible:true},n2:{text,visible:true}}}]});const before=snapshot(''),after=snapshot('M-1 ready');
 const cap:Capability=validateCapability({schemaVersion:'2.1',id:'recovered-fixture',version:'1.0.0',description:'Synthetic recovery fixture',inputs:{memberId:{type:'string',required:true,description:'Requested ID'}},targets:{field:{strategies:[{kind:'css',selector:'#q'}]},result:{strategies:[{kind:'css',selector:'#result'}]}},steps:[{id:'open',action:'navigate',url:before.url},{id:'fill',action:'fill',target:'field',value:{input:'memberId'},effect:'readOnly'},{id:'read',action:'extract',target:'result',saveAs:'message'}],outputs:{message:{type:'string',description:'Observed result',source:{savedValue:'message'},validation:{condition:{kind:'textMatches',pattern:'M-[0-9]+ ready'},timeoutMs:500}}},checkpoints:[{kind:'textContains',target:'result',value:{input:'memberId'}}]});
 const evidence:DiscoveryEvidence={evidenceVersion:'2.0',completed:false,modelCompleted:true,request:{id:cap.id,goal:'Find member and report ready',url:before.url,dataMode:'synthetic-test',inputs:cap.inputs,bindings:{memberId:'M-1'},outputs:{message:{type:'string',description:'Observed result'}}},actions:[{index:1,name:'navigate',before,after:before,input:{url:before.url},target:null,success:true},{index:2,name:'form_input',before,after:before,input:{target:{type:'ref',ref:'ref_1'}},target:null,success:false,failure:{phase:'beforeDispatch',code:'FORM_INPUT_REJECTED'}},{index:3,name:'form_input',before,after,input:{value:{input:'memberId'}},target:{frame:0,node:'n1'},success:true},{index:4,name:'get_page_text',before:after,after,input:{},target:null,success:true,observation:'M-1 ready'}]};
 const candidate:Candidate={capability:cap,stepEvidence:{open:{action:1,phase:'after'},fill:{action:3,phase:'before',node:{frame:0,node:'n1'}},read:{action:4,phase:'after',node:{frame:0,node:'n2'}}},checkpointEvidence:[{action:4,phase:'after',node:{frame:0,node:'n2'}}]};const policy:Policy={origins:['https://example.test'],actions:testPolicy.actions};
 return {evidence,candidate,policy};
}
test('pre-dispatch guard is typed and does not modify the field',async()=>{
 const driver=await LocalPlaywrightBrowser.launch(true);
 try{await driver.page.setContent('<input value="unchanged">');const tool=driver as unknown as {read_page(context:unknown,input:unknown):Promise<string>;form_input(context:unknown,input:unknown):Promise<void>};const observed=await tool.read_page({}, {tab_id:'tab-1',filter:'all'});const ref=observed.match(/input "unchanged" \[(ref_\d+)\]/)?.[1];assert.ok(ref,observed);await assert.rejects(tool.form_input({}, {tab_id:'tab-1',target:{type:'ref',ref},value:null}),error=>{assert.ok(error instanceof BeforeDispatchError);assert.equal(error.phase,'beforeDispatch');assert.equal(error.code,'FORM_INPUT_REJECTED');return true;});assert.equal(await driver.page.locator('input').inputValue(),'unchanged');}finally{await driver.close();}
});
test('admission requires safe recovery, preserves failures, and rejects uncertain writes',()=>{
 const {evidence}=fixture();const report=checkDiscoveryEvidence(evidence);assert.equal(report.status,'eligible-for-compilation');assert.equal(report.goalVerification,'pending-builder-validation');assert.equal(report.recoveredFailures[0]?.action,2);assert.equal(report.recoveredFailures[0]?.recoveryAction,3);assert.equal(evidence.actions[1]?.success,false);assert.equal(evidence.completed,false);
 const cases:[string,(copy:DiscoveryEvidence)=>void,RegExp][]=[
 ['possible write',e=>{e.actions[1]!.name='left_click';e.actions[1]!.failure={phase:'unknown',code:'TIMEOUT'};},/may have dispatched/],
 ['unknown fill timeout',e=>{e.actions[1]!.failure={phase:'unknown',code:'TIMEOUT'};},/may have dispatched/],
 ['changed snapshot',e=>{e.actions[1]!.after=structuredClone(e.actions[1]!.after);e.actions[1]!.after.url+='changed';},/snapshots differ/],
 ['wrong recovery target',e=>{e.actions[2]!.target={frame:0,node:'n2'};},/same recorded field/],
 ['unbound recovery',e=>{e.actions[2]!.input.value={literal:'M-1'};},/not bound/],
 ['missing final observation',e=>{delete e.actions[3]!.observation;},/No textual result/],
 ['no normal termination',e=>{e.modelCompleted=false;},/ended normally/],
 ['missing action',e=>{e.actions[2]!.index=8;},/missing actions/],
 ];
 const assertions=[];for(const[name,change,message]of cases){const copy=structuredClone(evidence);change(copy);assert.throws(()=>checkDiscoveryEvidence(copy),message);assertions.push({scenario:name,rejected:true});}
 const directory=join(root,'admission');mkdirSync(directory,{recursive:true});writeFileSync(join(directory,'assertions.json'),JSON.stringify({passed:true,report,assertions},null,2));
});
test('Builder excludes failed actions but still requires final goal evidence and all successful interactions',async()=>{
 const {evidence,candidate,policy}=fixture();const cap=await validateCandidate(candidate,evidence,policy);assert.equal(cap.steps.length,3);assert.ok(!Object.values(candidate.stepEvidence).some(ref=>ref.action===2));
 const failedRef=structuredClone(candidate);failedRef.stepEvidence.fill!.action=2;await assert.rejects(validateCandidate(failedRef,evidence,policy),/successful action/);
 const weak=structuredClone(candidate);weak.capability.checkpoints=[{kind:'visible',target:'result'}];await assert.rejects(validateCandidate(weak,evidence,policy),/semantic final checkpoints/);
 const wrong=structuredClone(candidate);wrong.capability.outputs.message!.validation!.condition={kind:'textEquals',value:{literal:'NOT_FOUND'}};await assert.rejects(validateCandidate(wrong,evidence,policy),/rejects the recorded/);
 const omitted=structuredClone(candidate);omitted.capability.steps=omitted.capability.steps.filter(step=>step.id!=='fill');delete omitted.stepEvidence.fill;omitted.capability.targets.field!.strategies=[{kind:'role',role:'textbox',name:{input:'memberId'},frames:[]}];await assert.rejects(validateCandidate(omitted,evidence,policy),/omits an executed|without verified evidence/);
 const directory=join(root,'builder');mkdirSync(directory,{recursive:true});writeFileSync(join(directory,'assertions.json'),JSON.stringify({passed:true,executableActionIndices:Object.values(candidate.stepEvidence).map(ref=>ref.action),excludedFailedAction:2,checks:['failed reference rejected','visibility-only goal rejected','contradicting output rejected','successful interaction cannot be dropped']},null,2));
});
test('legacy audit safely admits Test 6 unchanged and rejects missing or contradictory proof',()=>{
 const source='evidence/e2e-round-2/test-6-awkward-M1010-youth/discovery/discovery-v2.json';const evidence=JSON.parse(readFileSync(source,'utf8')) as DiscoveryEvidence;const original=JSON.stringify(evidence);const audit=readDiscoveryAudit(source)!;const report=checkDiscoveryEvidence(evidence,audit);assert.equal(report.recoveredFailures[0]?.action,7);assert.equal(report.recoveredFailures[0]?.recoveryAction,10);assert.equal(report.recoveredFailures[0]?.proof,'legacy-driver-guard-and-audit');assert.equal(JSON.stringify(evidence),original);assert.throws(()=>checkDiscoveryEvidence(evidence),/ended normally/);
 const ambiguous:DiscoveryAudit=structuredClone(audit);ambiguous.events.filter(e=>e.kind==='failure').forEach(e=>{e.message='Timeout after dispatch';});assert.throws(()=>checkDiscoveryEvidence(evidence,ambiguous),/may have dispatched/);
 const unfinished=structuredClone(audit);unfinished.summary.assessment!.completed=false;assert.throws(()=>checkDiscoveryEvidence(evidence,unfinished),/ended normally|corroborate/);
 const typed=fixture().evidence;assert.throws(()=>checkDiscoveryEvidence(typed,{events:[],summary:{}}),/corroborate/);
 assert.equal(FORM_INPUT_REJECTED_MESSAGE,'Only string form input on an observed reference is supported');
 const directory=join(root,'historical-test-6');mkdirSync(directory,{recursive:true});writeFileSync(join(directory,'admission.json'),JSON.stringify({passed:true,source,report,originalEvidenceUnchanged:true,checks:['legacy guard proven','missing audit rejected','unknown dispatch rejected','contradictory completion rejected']},null,2));
});
