// Run against a fresh demo runtime: node tests/http-smoke.mjs
// This tests a real HTTP process, not mocks; do not point at private configured data.
import assert from 'node:assert/strict';
const base = process.env.TEST_API_URL ?? 'http://127.0.0.1:8787/api';
async function request(path, method = 'GET', body) {
  const response = await fetch(`${base}${path}`, {method, headers: {'Content-Type':'application/json'}, ...(body === undefined ? {} : {body: JSON.stringify(body)})});
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return {status:response.status, ok:response.ok, data};
}
const boot = await request('/bootstrap');
assert.equal(boot.status, 200);
assert.equal(boot.data.mode, 'demo', 'Only run smoke against demo mode');
assert.equal(boot.data.pa, null, 'Start a fresh demo runtime for irreversible hatch test');
const candidates = await request('/pa/candidates','POST',{name:'小屿',appearance:'圆圆的青绿色小伙伴',personality:'温柔',relationship:'同行者',exclusions:'不要恐怖元素'});
assert.equal(candidates.ok,true,JSON.stringify(candidates));
assert.ok(candidates.data.candidates.length > 0);
const candidateId = candidates.data.candidates[0].id;
assert.equal((await request('/pa/confirm','POST',{candidateId})).ok,true);
assert.equal((await request('/pa/confirm','POST',{candidateId})).ok,false,'Hatch must be irreversible');
const block = await request('/blocks','POST',{name:'晨间习惯',domain:'habits',persona:'帮助记录日常习惯',components:['checkin','records','plans']});
assert.equal(block.ok,true,JSON.stringify(block));
const blockId = block.data.block.id;
const record = await request(`/blocks/${blockId}/records`,'POST',{component:'checkin',content:'读书十分钟',completed:true});
assert.equal(record.ok,true,JSON.stringify(record));
const sensitive = await request('/memories','POST',{content:'记住我对青霉素过敏',subject:'health.allergy.penicillin',category:'health_safety',user_signal:'remember',sensitive:true,confidence:1});
assert.equal(sensitive.ok,true,JSON.stringify(sensitive));
let state = (await request('/bootstrap')).data;
assert.equal(state.memories.some(m=>m.subject==='health.allergy.penicillin'),false,'No sensitive memory before consent');
assert.ok(state.pendingMemories.length > 0);
const pending = state.pendingMemories.find(m=>m.content.includes('青霉素'));
assert.ok(pending);
assert.equal((await request(`/memory-consents/${pending.id}/decide`,'POST',{allow:true})).ok,true);
state = (await request('/bootstrap')).data;
const memory = state.memories.find(m=>m.subject==='health.allergy.penicillin');
assert.ok(memory);
assert.equal(memory.tier,'core');
const session = await request('/sessions','POST',{blockId:'pa'});
assert.equal(session.ok,true,JSON.stringify(session));
const chat = await fetch(`${base}/sessions/${session.data.session.id}/messages`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:'今天想跟你聊聊'})});
assert.equal(chat.ok,true);
assert.match(chat.headers.get('content-type')??'',/text\/event-stream/);
const stream = await chat.text();
assert.match(stream,/event: ?message/);
assert.match(stream,/event: ?done/);
assert.equal((await request('/schedules','POST',{title:'喝一杯水',dueAt:new Date(Date.now()+60_000).toISOString(),timeZone:'Asia/Shanghai'})).ok,true);
assert.equal((await request(`/memories/${memory.id}`,'DELETE')).ok,true);
const exported = await request('/export');
assert.equal(exported.ok,true);
assert.equal((exported.data.memories ?? []).some(m=>m.id===memory.id),false,'Deleted memory must not remain in exported memory records');
assert.equal(JSON.stringify(exported.data).includes('记住我对青霉素过敏'),false,'Deleted memory content must not leak through export');
assert.equal((await request(`/blocks/${blockId}`,'PATCH',{status:'paused'})).ok,true);
assert.equal((await request(`/blocks/${blockId}`,'DELETE')).ok,true);
state = (await request('/bootstrap')).data;
assert.equal(state.blocks.some(b=>b.id===blockId),false);
console.log('HTTP smoke passed: hatch lock, Agent records, sensitive consent, SSE, schedule, memory deletion, uninstall');
