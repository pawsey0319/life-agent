// Run on local demo data ONLY; writes and rejects temporary test candidates.
import assert from 'node:assert/strict';
const base=process.env.TEST_API_URL??'http://127.0.0.1:8787/api';
async function api(path,method='GET',body){const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});let data;try{data=await r.json();}catch{}return {ok:r.ok,status:r.status,data};}
assert.equal((await api('/bootstrap')).data.mode,'demo');
for(const path of ['/sessions/foreign/messages','/blocks/foreign/records']){
 const result=await api(path,'POST',{content:'hostile',blockId:'pa',userId:'foreign',namespace:'pa'});
 assert.equal(result.ok,false,`Unknown objects must not be claimed by body identity: ${path}`);
}
const forgotten=await api('/memories','POST',{content:'这条明确不要记住',subject:'privacy.dontremember',category:'identity',user_signal:'dont_remember',sensitive:false,confidence:1});
assert.equal(forgotten.ok,true);
let boot=(await api('/bootstrap')).data;
assert.equal(boot.memories.some(m=>m.subject==='privacy.dontremember'),false);
assert.equal(boot.pendingMemories.some(m=>m.subject==='privacy.dontremember'),false);
const secret=await api('/memories','POST',{content:'记住我的体重是六十公斤',subject:'health.weight',category:'health_safety',user_signal:'remember',sensitive:false,confidence:1});
assert.equal(secret.ok,true);
boot=(await api('/bootstrap')).data;
assert.equal(boot.memories.some(m=>m.subject==='health.weight'),false,'Deterministic sensitivity guard must override false model flag');
const candidate=boot.pendingMemories.find(m=>m.subject==='health.weight');
assert.ok(candidate,'Sensitive candidate must await storage consent');
assert.equal((await api(`/memory-consents/${candidate.id}/decide`,'POST',{allow:false})).ok,true);
assert.equal((await api(`/memory-consents/${candidate.id}/decide`,'POST',{allow:true})).ok,false,'Denied consent cannot be resurrected');
assert.equal((await api('/memories','POST',{content:'invalid',subject:'x',confidence:5})).ok,false);
assert.equal((await api('/schedules','POST',{title:'invalid date',dueAt:'not-a-date',timeZone:'Mars/Olympus'})).ok,false);
console.log('HTTP adversarial checks passed: spoofed ownership, dont_remember, sensitive false flag, consent replay, invalid inputs');
