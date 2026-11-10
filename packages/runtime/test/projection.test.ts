import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {fresh,pack} from '../src/app.js';
import {projectState,unprojectState} from '../src/projection.js';

test('normalized encrypted entities round-trip without plaintext and exclude ephemeral messages',()=>{
 const state=fresh('user');const key=randomBytes(32);
 state.pa={id:'pa',name:'private-name'};
 state.sessions.push({id:'s',blockId:'pa',createdAt:new Date().toISOString(),messages:[{id:'m',role:'user',content:'private-content',createdAt:new Date().toISOString()},{id:'ephemeral',role:'assistant',content:'raw-derived',ephemeral:true,createdAt:new Date().toISOString()}]});
 state.book.remember({content:'private-memory',user_signal:'remember'});
 state.gateway.log('memory_delete',undefined,'old');
 const projected=projectState(pack(state),key);
 assert.ok(!JSON.stringify(projected).includes('private-content'));
 assert.ok(!JSON.stringify(projected).includes('private-memory'));
 assert.ok(!projected.some(e=>e.id==='ephemeral'));
 const rows=projected.filter(e=>e.kind!=='audit').map(e=>({...e,entity_id:e.id,ciphertext:e.ciphertext!,fingerprint:e.fingerprint!}));
 const audits=projected.filter(e=>e.kind==='audit').map(e=>({source_id:e.id,ordinal:e.ordinal,metadata:{action:e.action,at:e.at,requestId:e.requestId}}));
 const loaded=unprojectState(rows,audits,key);
 assert.equal((loaded.pa as {name:string}).name,'private-name');
 assert.deepEqual((loaded.sessions as {messages:{id:string}[]}[])[0]!.messages.map(m=>m.id),['m']);
 assert.equal((loaded.gateway as {audit:unknown[]}).audit.length,1);
 assert.throws(()=>unprojectState(rows.map((r,i)=>i===0?{...r,fingerprint:'tampered'}:r),audits,key));
});

test('stable memory guard HMAC ignores retrieval bookkeeping but not user content or core tier',()=>{
 const state=fresh('user');const key=randomBytes(32);const memory=state.book.remember({content:'core',user_signal:'remember'}).memory!;
 const original=projectState(pack(state),key).find(e=>e.kind==='memory')!;
 memory.lastUsedAt='2030-01-01T00:00:00Z';memory.sessionIds.push('new-session');memory.embedding=[1,2];memory.embeddingContent=memory.content;
 const bookkeeping=projectState(pack(state),key).find(e=>e.kind==='memory')!;
 assert.equal(original.fingerprint,bookkeeping.fingerprint);
 assert.notEqual(original.ciphertext,bookkeeping.ciphertext);
 memory.content='changed';
 assert.notEqual(projectState(pack(state),key).find(e=>e.kind==='memory')!.fingerprint,original.fingerprint);
});
