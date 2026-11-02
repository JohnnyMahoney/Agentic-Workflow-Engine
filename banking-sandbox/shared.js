// Shared fake data + fake "backend" (in-browser) + test panel. FICTIONAL DATA ONLY.
const CUSTOMERS=[
['M-1001','Anna Kovalenko','Checking',2450.75],['M-1002','Bohdan Melnyk','Savings',18200],
['M-1003','Sam Rivera','Checking',310.4],['M-1004','Olena Shevchenko','Business',92500.1],
['M-1005','Taras Bondar','Term Deposit',50000],['M-1006','Iryna Lysenko','Savings',7640.2],
['M-1007','Maksym Tkach','Checking',0],['M-1008','Daria Petrenko','Savings',1299.99],
['M-1009','Sam Rivera','Savings',15800],['M-1010','Yuri Savchenko','Business',430250],
['M-1011','Kateryna Moroz','Checking',-120.5],['M-1012','Leo Hrytsenko','Term Deposit',25000]
].map(([id,name,type,bal])=>({id,name,type,bal}));
const TYPES=['Savings','Checking','Term Deposit','Youth'];
const MODES=['NONE','NOT_FOUND','VALIDATION_ERROR','PERMISSION_DENIED','SESSION_EXPIRED','SLOW_LOADING','UNEXPECTED_DIALOG','TIMEOUT'];
const S=()=>({mode:'NONE',auth:true,subs:{},...JSON.parse(localStorage.sbx||'{}')});
const save=s=>localStorage.sbx=JSON.stringify(s);
const fmt=n=>(n<0?'-$':'$')+Math.abs(n).toLocaleString('en-US',{minimumFractionDigits:2});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const err=(error,message)=>({error,message});
function modal(){return new Promise(res=>{const d=document.createElement('div');
 d.style.cssText='position:fixed;inset:0;background:#0006;z-index:99;display:flex;align-items:center;justify-content:center';
 d.innerHTML='<div style="background:#fff;padding:20px;border:2px solid #333;font:14px sans-serif">Scheduled maintenance notice.<br><br><button>OK</button></div>';
 d.querySelector('button').onclick=()=>{d.remove();res()};document.body.append(d)})}
async function api(op,a={}){
 const m=S().mode;
 if(m=='TIMEOUT')return new Promise(()=>{});          // never resolves
 await wait(m=='SLOW_LOADING'?4000:300);
 if(op=='login'){save({...S(),auth:true});return{data:1}}
 if(m=='UNEXPECTED_DIALOG')await modal();             // blocks until OK, every call
 let s=S();
 if(m=='SESSION_EXPIRED'&&s.auth){s.auth=false;save(s)} // fires once, until login/reset
 if(!s.auth)return err('SESSION_EXPIRED','Session expired. Please log in again.');
 const subs=id=>s.subs[id]||[];
 if(op=='search'){
  if(!a.q.trim())return err('VALIDATION_ERROR','Enter Member ID or name.');
  const q=a.q.trim().toLowerCase();
  const r=CUSTOMERS.filter(c=>c.id.toLowerCase()==q||c.name.toLowerCase().includes(q));
  return m=='NOT_FOUND'||!r.length?err('NOT_FOUND','No members found.'):{data:r};
 }
 const c=CUSTOMERS.find(c=>c.id==a.id);
 if(!c||m=='NOT_FOUND')return err('NOT_FOUND','Member not found.');
 if(op=='get')return{data:{...c,subs:subs(c.id)}};
 if(op=='open'){
  if(m=='PERMISSION_DENIED')return err('PERMISSION_DENIED','You are not authorized to open sub-accounts.');
  if(m=='VALIDATION_ERROR'||!TYPES.includes(a.type))return err('VALIDATION_ERROR','Select a valid account type.');
  const ref=c.id+'-S'+(subs(c.id).length+1);
  s.subs[c.id]=[...subs(c.id),{ref,type:a.type}];save(s);
  return{data:{ref,type:a.type,owner:c.name}};
 }
}
// Test panel (top window only). URL shortcut: ?mode=SLOW_LOADING
if(top===window){
 const u=new URLSearchParams(location.search).get('mode');
 if(MODES.includes(u))save({...S(),mode:u,auth:true});
 addEventListener('DOMContentLoaded',()=>{
  const p=document.createElement('div');
  p.style.cssText='position:fixed;right:8px;bottom:8px;background:#222;color:#eee;padding:8px;font:12px monospace;z-index:50';
  p.innerHTML='<b>TEST PANEL</b><br><select>'+MODES.map(m=>`<option>${m}</option>`).join('')+'</select> <button>Reset state</button>';
  const sel=p.querySelector('select');sel.value=S().mode;
  sel.onchange=()=>save({...S(),mode:sel.value,auth:true});
  p.querySelector('button').onclick=()=>{localStorage.removeItem('sbx');location.href=location.pathname};
  document.body.append(p)});
}
