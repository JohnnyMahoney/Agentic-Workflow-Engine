import {fixtureSafety} from "./fixture-safety.js";
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {chromium} from 'playwright';
import {validateCapability,type Capability,type Target} from '../capability/contract.js';
import {validateCandidate,type Candidate} from '../capability/builder.js';
import {captureSnapshot,type DiscoveryEvidence} from '../capability/evidence.js';
import {PlaywrightAdapter,testPolicy,type Policy} from '../surfaces/playwright.js';
import {replayCapability} from '../replay/engine.js';
const root=resolve(process.env.SELECTED_OPTION_EVIDENCE_DIR ?? mkdtempSync(join(tmpdir(),'selected-option-')));
const target=(selector:string):Target=>({strategies:[{kind:'css',selector,frames:[]}]});
test('selectedOptionLabel reads the selected label, preserves text extraction, rejects unsupported controls',async()=>{
 const adapter=await PlaywrightAdapter.launch({});
 try {
  await adapter.page.setContent('<div id="text">Ordinary text</div><select id="type"><option value="savings">Savings</option><option value="young" selected>Youth</option></select><select id="multi" multiple><option selected>Youth</option></select><select id="empty"></select><select id="hidden" hidden><option selected>Youth</option></select>');
  assert.equal(await adapter.extract(target('#type'),'selectedOptionLabel'),'Youth');assert.equal(await adapter.page.locator('#type').inputValue(),'young');assert.equal(await adapter.extract(target('#text')),'Ordinary text');assert.equal(await adapter.extract(target('#text'),'text'),'Ordinary text');
  assert.match(await adapter.extract(target('#type')),/Savings/);
  for(const selector of ['#text','#type option:checked','#hidden']) await assert.rejects(adapter.extract(target(selector),'selectedOptionLabel'),/visible native select/);
  for(const selector of ['#multi','#empty']) await assert.rejects(adapter.extract(target(selector),'selectedOptionLabel'),/exactly one/);
 }finally{await adapter.close();}
});
test('Builder validates selectedOptionLabel from native select metadata after form_input',async()=>{
 const browser=await chromium.launch();
 try{
  const page=await browser.newPage();await page.setContent('<label for="type">Type</label><select id="type"><option value="">Choose</option><option value="young">Youth</option></select>');const before=await captureSnapshot(page);before.url='https://example.test/';await page.selectOption('#type','young');const after=await captureSnapshot(page);after.url=before.url;const node=(await page.locator('#type').getAttribute('data-cap-node'))!;
  const cap:Capability=validateCapability({schemaVersion:'2.1',id:'select-metadata-fixture',version:'1.0.0',description:'Synthetic evidence fixture',inputs:{choice:{type:'string',required:true,description:'Selected label'}},targets:{type:target('#type')},steps:[{id:'open',action:'navigate',url:before.url},{id:'choose',action:'selectOption',target:'type',by:'label',value:{input:'choice'},effect:'readOnly'},{id:'read',action:'extract',target:'type',property:'selectedOptionLabel',saveAs:'choice'}],outputs:{choice:{type:'string',description:'Selected label',source:{savedValue:'choice'},validation:{condition:{kind:'textEquals',value:{input:'choice'}},timeoutMs:500}}},checkpoints:[{kind:'visible',target:'type'}]});
  const evidence:DiscoveryEvidence={evidenceVersion:'2.0',completed:true,request:{id:cap.id,goal:'Select Youth',url:before.url,dataMode:'synthetic-test',inputs:cap.inputs,bindings:{choice:'Youth'},outputs:{choice:{type:'string',description:'Selected label'}}},actions:[{index:1,name:'navigate',input:{url:before.url},target:null,before,after:before,success:true},{index:2,name:'form_input',input:{value:{input:'choice'}},target:{frame:0,node},before,after,success:true}]};
  const candidate:Candidate={capability:cap,stepEvidence:{open:{action:1,phase:'after'},choose:{action:2,phase:'before',node:{frame:0,node}},read:{action:2,phase:'after',node:{frame:0,node}}},checkpointEvidence:[{action:2,phase:'after',node:{frame:0,node}}]};const policy:Policy={...fixtureSafety,origins:['https://example.test'],actions:testPolicy.actions};
  const report:Record<string,unknown>[]=[];await validateCandidate(candidate,evidence,policy,report);assert.equal(report[0]!.positiveSample,'Youth');assert.match(String(report[0]!.limitation),/selection only/);
  const missing=structuredClone(evidence);delete missing.actions[1]!.after.frames[0]!.nodes[node]!.selectedOption;await assert.rejects(validateCandidate(candidate,missing,policy),/Selected option is not supported|recorded selectedOption evidence/);
  const wrong=structuredClone(evidence);wrong.actions[1]!.after.frames[0]!.nodes[node]!.selectedOption={label:'Savings',value:'savings'};await assert.rejects(validateCandidate(candidate,wrong,policy),/Selected option is not supported/);
  const legacyText=structuredClone(candidate);delete (legacyText.capability.steps[2] as {property?:string}).property;await assert.rejects(validateCandidate(legacyText,evidence,policy),/textual browser result/);
  const directory=join(root,'builder');mkdirSync(directory,{recursive:true});writeFileSync(join(directory,'assertions.json'),JSON.stringify({passed:true,report,checks:['native selected label accepted','missing selected facts rejected','wrong selection rejected','legacy text extraction rules unchanged']},null,2));
 }finally{await browser.close();}
});
test('Replay extracts selected label but still requires post-write creation confirmation',async()=>{
 const server=createServer((req,res)=>{const blocked=req.url?.includes('blocked');res.setHeader('Content-Type','text/html');res.end(`<select id="type"><option>Choose</option><option value="young">Youth</option></select><button id="create" onclick="window.writes++;${blocked?'':"setTimeout(()=>document.querySelector('#status').textContent='Created '+document.querySelector('#type').selectedOptions[0].label,100)"}">Create</button><p id="status"></p><script>window.writes=0</script>`);});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address=server.address() as {port:number};const origin=`http://127.0.0.1:${address.port}`;const policy:Policy={...fixtureSafety,origins:[origin],actions:testPolicy.actions};
 try{for(const mode of ['confirmed','blocked']){
  const cap=validateCapability({schemaVersion:'2.1',id:'selection-confirmation-fixture',version:'1.0.0',description:'Selection is not creation',inputs:{choice:{type:'string',required:true,description:'Desired label'}},targets:{type:target('#type'),create:target('#create'),status:target('#status')},steps:[{id:'open',action:'navigate',url:origin+'/'+mode},{id:'choose',action:'selectOption',target:'type',by:'label',value:{input:'choice'},effect:'readOnly'},{id:'readType',action:'extract',target:'type',property:'selectedOptionLabel',saveAs:'type'},{id:'create',action:'click',target:'create',effect:'stateChanging'},{id:'confirm',action:'wait',condition:{kind:'textContains',target:'status',value:{input:'choice'}},timeoutMs:500,confirms:'create'}],outputs:{type:{type:'string',description:'Selected label',source:{savedValue:'type'},validation:{condition:{kind:'textEquals',value:{input:'choice'}},timeoutMs:500}}},checkpoints:[{kind:'textContains',target:'status',value:{literal:'Created'}}]});
  const directory=join(root,mode);mkdirSync(directory,{recursive:true});const path=join(directory,'artifact.json');writeFileSync(path,JSON.stringify(cap,null,2));let writes=0;
  const result=await replayCapability(path,{choice:'Youth'},directory,policy,async(inputs,p)=>{const adapter=await PlaywrightAdapter.launch(inputs,p);const close=adapter.close.bind(adapter);adapter.close=async()=>{writes=await adapter.page.evaluate(()=>Reflect.get(window,'writes') as number);await close();};return adapter;});assert.equal(writes,1);
  if(mode==='confirmed'){assert.equal(result.status,'SUCCESS',JSON.stringify(result));assert.equal(result.outputs?.type,'Youth');assert.equal(result.outputReadiness,'validated');}else{assert.equal(result.status,'OUTCOME_UNKNOWN');assert.equal(result.code,'WAIT_TIMEOUT');assert.equal(result.stepId,'confirm');assert.equal(result.retryable,false);assert.equal(result.outputs,undefined);assert.ok(readFileSync(join(directory,'failure.png.json')).length);}
  writeFileSync(join(directory,'assertions.json'),JSON.stringify({passed:true,writes,result},null,2));
 }}finally{await new Promise<void>((r,j)=>server.close(e=>e?j(e):r()));}
});
