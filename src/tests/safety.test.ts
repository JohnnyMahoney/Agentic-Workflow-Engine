import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync, readFileSync, readdirSync, existsSync, writeFileSync as rawWrite} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PlaywrightAdapter, testPolicy, type Policy} from '../surfaces/playwright.js';
import {checkDestination} from '../safety/policy.js';
import {withSafety, writeFileSync, appendFileSync, assertUnredacted} from '../safety/persistence.js';
import {captureSnapshot} from '../capability/evidence.js';
import {replayCapability} from '../replay/engine.js';
import {LocalPlaywrightBrowser} from '../discovery/local-browser.js';

const css = (selector: string) => ({strategies: [{kind: 'css' as const, selector, frames: []}]});
test('Safety: origin/route/action and mutation denials have no side effects; narrow risky permission works', async () => {
  let deniedRequests = 0;
  const server = createServer((req,res) => {
    if (req.url === '/forbidden') deniedRequests++;
    if (req.url === '/redirect') {res.writeHead(302,{location:'/forbidden'}).end();return;}
    if (req.url === '/script.js') {res.end('window.loaded=true');return;}
    res.setHeader('content-type','text/html');res.end('<script src="/script.js"></script><button id="write" onclick="window.writes=(window.writes||0)+1">Create</button>');
  });
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  const origin = `http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const policy: Policy = {...testPolicy,origins:[origin],routes:['/allowed','/redirect'],operations:[]};
  try {
    for (const mode of ['unknown','blocked','risky-denied','action-denied','allowed']) {
      const rules: Policy = {...policy,actions:mode==='action-denied'?['navigate','extract']:policy.actions,
        operations:mode==='unknown'?[]:[{action:'click',path:'/allowed',selector:'#write',risk:mode==='blocked'?'blocked':'risky',allow:mode==='allowed'||mode==='action-denied'}]};
      const adapter=await PlaywrightAdapter.launch({},rules);
      try {
        await adapter.navigate(origin+'/allowed');
        assert.equal(await adapter.page.evaluate(()=>Reflect.get(window,'loaded')),true);
        if(mode==='allowed') await adapter.click(css('#write'));
        else await assert.rejects(adapter.click(css('#write')),{code:'POLICY_DENIED'});
        assert.equal(await adapter.page.evaluate(()=>Reflect.get(window,'writes')??0),mode==='allowed'?1:0);
        await assert.rejects(adapter.navigate(origin+'/forbidden'),{code:'POLICY_DENIED'});
        assert.throws(()=>checkDestination('https://untrusted.invalid/allowed',rules),{code:'POLICY_DENIED'});
      } finally {await adapter.close();}
    }
    const adapter=await PlaywrightAdapter.launch({},policy);
    try {await assert.rejects(adapter.navigate(origin+'/redirect'),{code:'POLICY_DENIED'});}finally{await adapter.close();}
    assert.equal(deniedRequests,0);
  } finally {await new Promise<void>(r=>server.close(()=>r()));}
});

test('Safety: sensitive DOM/URL/tool output never reaches text evidence; raw screenshots are omitted',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'safety-redaction-'));
  const value='Synthetic-Private-Value-73';
  const policy:Policy={...testPolicy,privacy:{...testPolicy.privacy!,sensitiveSelectors:['#private'],sensitiveInputs:['privateValue']}};
  await withSafety(policy,{privateValue:value},async()=>{
    const adapter=await PlaywrightAdapter.launch({},policy);
    try {
      await adapter.page.setContent(`<input type="password" value="${value}"><p id="private">${value}</p><p>Echo ${value}</p>`);
      const snapshot=await captureSnapshot(adapter.page);
      writeFileSync(join(dir,'discovery.json'),JSON.stringify({snapshot,url:'https://example.test/?q='+encodeURIComponent(value),toolResponse:'Echo '+value}));
      appendFileSync(join(dir,'events.jsonl'),JSON.stringify({message:value})+'\n');
      await assert.rejects(adapter.captureFailure(join(dir,'failure.png')),{code:'UNSAFE_IMAGE_OMITTED'});
      assert.throws(()=>writeFileSync(join(dir,'raw.png'),Buffer.from(value)),{code:'UNSAFE_IMAGE_OMITTED'});
      assert.throws(()=>assertUnredacted(snapshot),{code:'SANITIZED_EVIDENCE_INSUFFICIENT'});
    }finally{await adapter.close();}
  });
  for(const name of readdirSync(dir)) assert.equal(readFileSync(join(dir,name),'utf8').includes(value),false,name);
  assert.equal(existsSync(join(dir,'failure.png')),false);
  assert.equal(existsSync(join(dir,'failure.png.json')),true);
});

test('Safety: secret-key values echoed in unstructured text are redacted',()=>{
  const dir=mkdtempSync(join(tmpdir(),'safety-secret-'));
  const secret='UnlabelledEcho-Sensitive-918';
  writeFileSync(join(dir,'result.json'),JSON.stringify({password:secret,message:'Echo '+secret}));
  assert.equal(readFileSync(join(dir,'result.json'),'utf8').includes(secret),false);
});

test('Safety: Discovery dispatch denies unknown mutations and reuses trusted risk rules', async()=>{
 const server=createServer((_,res)=>{res.setHeader('content-type','text/html');res.end('<button id="write" onclick="window.writes=(window.writes||0)+1">Create</button>');});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 const driver=await LocalPlaywrightBrowser.launch(true,{...testPolicy,origins:[origin],routes:['/'],operations:[]});
 try{
  const tool=driver as unknown as {navigate(c:unknown,i:unknown):Promise<unknown>;read_page(c:unknown,i:unknown):Promise<string>;left_click(c:unknown,i:unknown):Promise<void>};
  await tool.navigate({}, {url:origin});
  const page=await tool.read_page({},{});const ref=page.match(/\[(ref_\d+)\]/)?.[1];assert.ok(ref);
  await assert.rejects(tool.left_click({}, {target:{type:'ref',ref}}),{code:'POLICY_DENIED'});
  assert.equal(await driver.page.evaluate(()=>Reflect.get(window,'writes')??0),0);
  await assert.rejects(tool.navigate({}, {url:origin+'/forbidden'}),{code:'POLICY_DENIED'});
 }finally{await driver.close();await new Promise<void>(r=>server.close(()=>r()));}
});

test('Safety: missing classification and sensitive applications fail closed before execution',async()=>{
 let executed=false;
 for(const privacy of [undefined,{...testPolicy.privacy!,dataClass:'sensitive' as const}]){
  await assert.rejects(withSafety({...testPolicy,privacy},{},async()=>{executed=true;}),{code:'SAFETY_CONFIGURATION_REQUIRED'});
 }
 assert.equal(executed,false);
});

test('Safety: Replay policy denial before browser mutation is POLICY_DENIED without uncertain outcome',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'safety-replay-'));
 const server=createServer((_,res)=>{res.setHeader('content-type','text/html');res.end('<button id="write" onclick="window.writes=1">Create</button>');});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 const artifact={schemaVersion:'2.0',id:'unsafe',version:'1.0.0',description:'Untrusted risky artifact',inputs:{},targets:{write:css('#write')},steps:[{id:'open',action:'navigate',url:origin},{id:'create',action:'click',target:'write'}],outputs:{},checkpoints:[{kind:'visible',target:'write'}]};
 const path=join(dir,'artifact.json');rawWrite(path,JSON.stringify(artifact));
 let writes=0;
 try{
  const result=await replayCapability(path,{},dir,{...testPolicy,origins:[origin]},async(inputs,policy)=>{const adapter=await PlaywrightAdapter.launch(inputs,policy);const close=adapter.close.bind(adapter);adapter.close=async()=>{writes=await adapter.page.evaluate(()=>Reflect.get(window,'writes')??0);await close();};return adapter;});
  assert.equal(result.code,'POLICY_DENIED');assert.equal(result.status,'HARD_FAILURE');assert.equal(writes,0);
  assert.equal(result.details?.writeDispatched,false);
 }finally{await new Promise<void>(r=>server.close(()=>r()));}
});
