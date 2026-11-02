import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {chromium} from 'playwright';
import {validateCapability,outputMatches,type Capability} from '../capability/contract.js';
import {validateCandidate,type Candidate} from '../capability/builder.js';
import {captureSnapshot,type DiscoveryEvidence} from '../capability/evidence.js';
import {replayCapability} from '../replay/engine.js';
import {testPolicy,type Policy} from '../surfaces/playwright.js';

const root=resolve(process.env.OUTPUT_READINESS_EVIDENCE_DIR ?? mkdtempSync(join(tmpdir(),'output-readiness-')));
const pattern='\\$[0-9]+\\.[0-9]{2}';
function capability(url:string,timeoutMs=1500):Capability {
 return validateCapability({schemaVersion:'2.1',id:'output-readiness-fixture',version:'1.0.0',description:'Synthetic runtime fixture',inputs:{},targets:{value:{strategies:[{kind:'css',selector:'#value'}]},done:{strategies:[{kind:'css',selector:'#done'}]}},steps:[{id:'navigate',action:'navigate',url},{id:'extract',action:'extract',target:'value',saveAs:'amount'}],outputs:{amount:{type:'string',description:'Displayed amount',source:{savedValue:'amount'},validation:{condition:{kind:'textMatches',pattern},timeoutMs}}},checkpoints:[{kind:'visible',target:'done'}]});
}
async function fixture() {
 const server=createServer((req,res)=>{const mode=new URL(req.url!,'http://local').searchParams.get('mode');res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<div id="value">&#8230;</div><div id="done">Ready</div><script>${mode==='permanent'?'':`setTimeout(()=>document.querySelector('#value').textContent=${JSON.stringify(mode==='zero'?'$0.00':'$7.50')},250)`}</script>`);});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address=server.address() as {port:number};const origin=`http://127.0.0.1:${address.port}`;
 return {origin,policy:{origins:[origin],actions:testPolicy.actions} satisfies Policy,close:()=>new Promise<void>((r,j)=>server.close(e=>e?j(e):r()))};
}
test('output readiness waits for delayed values, preserves zero, times out on permanent placeholders',async()=>{
 const host=await fixture();
 try {for(const mode of ['delay','zero','permanent']){
  const directory=join(root,mode);mkdirSync(directory,{recursive:true});const cap=capability(`${host.origin}/?mode=${mode}`,mode==='permanent'?150:1500);const path=join(directory,'artifact.json');writeFileSync(path,JSON.stringify(cap,null,2));
  const result=await replayCapability(path,{},directory,host.policy);const events=readFileSync(result.evidenceRef,'utf8').trim().split('\n').map(l=>JSON.parse(l));const checks=events.filter(e=>e.kind==='output_validation');
  assert.ok(checks.some(e=>e.matches===false));
  if(mode==='permanent') {assert.equal(result.status,'RECOVERABLE_ERROR');assert.equal(result.code,'OUTPUT_VALIDATION_TIMEOUT');assert.equal(result.stepId,'extract');assert.equal(result.retryable,true);assert.deepEqual(result.expected,{kind:'textMatches',pattern});assert.deepEqual(result.observed,{visible:true,text:'\u2026'});assert.equal(result.outputs,undefined);assert.ok(checks.at(-1).elapsedMs>=150);assert.ok(checks.at(-1).elapsedMs<1500);assert.ok(readFileSync(join(directory,'failure.png')).length);}
  else {assert.equal(result.status,'SUCCESS',JSON.stringify(result));assert.equal(result.outputs?.amount,mode==='zero'?'$0.00':'$7.50');assert.equal(result.outputReadiness,'validated');assert.equal(checks.at(-1).matches,true);assert.equal(checks.at(-1).observed.text,result.outputs?.amount);}
  writeFileSync(join(directory,'assertions.json'),JSON.stringify({passed:true,mode,result},null,2));
 }}finally{await host.close();}
});
test('v2.1 requires output conditions; v2.0 stays readable; patterns are bounded and full-string',()=>{
 const cap=capability('https://the-internet.herokuapp.com');delete cap.outputs.amount!.validation;assert.throws(()=>validateCapability(cap),/Every extracted output/);cap.schemaVersion='2.0';assert.doesNotThrow(()=>validateCapability(cap));
 assert.equal(outputMatches({kind:'textMatches',pattern},'$0.00',{}),true);assert.equal(outputMatches({kind:'textMatches',pattern},'prefix $0.00',{}),false);assert.equal(outputMatches({kind:'textMatches',pattern},'$0.00\n',{}),false);
 cap.schemaVersion='2.1';cap.outputs.amount!.validation={condition:{kind:'textMatches',pattern:'.*'},timeoutMs:100};assert.throws(()=>validateCapability(cap));cap.outputs.amount!.validation.condition={kind:'textMatches',pattern:'['};assert.throws(()=>validateCapability(cap));
 assert.throws(()=>outputMatches({kind:'textMatches',pattern:'(a+)+$'},'a'.repeat(100)+'!',{}),/evaluation limits/);
 assert.equal(outputMatches({kind:'textEquals',value:{input:'id'}},'M-1007',{id:'M-1007'}),true);
});
test('Builder checks positive output evidence and rejects known premature or contradicting conditions',async()=>{
 const host=await fixture();const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage();await page.goto(host.origin+'/?mode=permanent');await page.setContent('<div id="value">...</div>');const before=await captureSnapshot(page);await page.setContent('<div id="value">$0.00</div><div id="done">Ready</div>');const after=await captureSnapshot(page);
  const value=await page.locator('#value').getAttribute('data-cap-node');const done=await page.locator('#done').getAttribute('data-cap-node');
  const cap=capability(before.url);const evidence:DiscoveryEvidence={evidenceVersion:'2.0',completed:true,request:{id:cap.id,goal:'Read the displayed amount',url:before.url,dataMode:'synthetic-test',inputs:{},bindings:{},outputs:{amount:{type:'string',description:'Displayed amount'}}},actions:[{index:1,name:'navigate',input:{url:before.url},target:null,before,after:before,success:true},{index:2,name:'get_page_text',input:{},target:null,before,after,observation:'$0.00 Ready',success:true}]};
  const candidate:Candidate={capability:cap,stepEvidence:{navigate:{action:1,phase:'after'},extract:{action:2,phase:'after',node:{frame:0,node:value!}}},checkpointEvidence:[{action:2,phase:'after',node:{frame:0,node:done!}}]};
  const report:Record<string,unknown>[]=[];await validateCandidate(candidate,evidence,host.policy,report);assert.deepEqual(report[0]!.rejectedIntermediateValues,['...']);
  cap.outputs.amount!.validation!.condition={kind:'textMatches',pattern:'\\S+'};await assert.rejects(validateCandidate(candidate,evidence,host.policy),/distinct earlier recorded value/);
  cap.outputs.amount!.validation!.condition={kind:'textEquals',value:{literal:'different'}};await assert.rejects(validateCandidate(candidate,evidence,host.policy),/rejects the recorded successful value/);
  const directory=join(root,'builder');mkdirSync(directory,{recursive:true});writeFileSync(join(directory,'assertions.json'),JSON.stringify({passed:true,report,checks:['accepts valid zero','rejects known intermediate match','rejects contradictory positive sample']},null,2));
 }finally{await browser.close();await host.close();}
});
