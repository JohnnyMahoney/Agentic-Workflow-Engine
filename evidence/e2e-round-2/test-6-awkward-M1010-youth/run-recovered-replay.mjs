import {mkdirSync,readdirSync,existsSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {replayCapability} from '../../../dist/replay/engine.js';
import {PlaywrightAdapter} from '../../../dist/surfaces/playwright.js';
const root=fileURLToPath(new URL('.',import.meta.url));
const directory=join(root,'replay-recovered');
if(existsSync(directory)&&readdirSync(directory).length)throw Error('Use a new empty output directory');
mkdirSync(directory,{recursive:true});
const request=JSON.parse(readFileSync(join(root,'request.json'),'utf8'));
const policy=JSON.parse(readFileSync(join(root,'policy.json'),'utf8'));
writeFileSync(join(directory,'policy.json'),JSON.stringify(policy,null,2));
// Read-only terminal evidence hook: all UI actions remain the artifact's Engine steps.
const result=await replayCapability(join(root,'compilation-recovered-4/artifact.json'),request.bindings,directory,policy,async(inputs,allowed)=>{
 const adapter=await PlaywrightAdapter.launch(inputs,allowed);const close=adapter.close.bind(adapter);
 adapter.close=async()=>{
  try{
   adapter.setOperationTimeout(5000);
   const terminal=await adapter.page.evaluate(()=>({url:location.href,text:document.body.innerText,localStorage:Object.fromEntries(Object.entries(localStorage))}));
   writeFileSync(join(directory,'terminal-state.json'),JSON.stringify(terminal,null,2));
   await adapter.captureFailure(join(directory,'terminal.png'));
  }finally{await close();}
 };
 return adapter;
});
console.log(JSON.stringify(result,null,2));if(result.status!=='SUCCESS')process.exitCode=1;
