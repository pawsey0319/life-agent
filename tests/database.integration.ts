import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {SupabaseStore} from '../packages/runtime/src/storage.js';
import {fresh,pack} from '../packages/runtime/src/app.js';

// Explicit opt-in, loopback-only: never create/delete accounts on a real user's project.
const enabled=process.env.RUN_LOCAL_DATABASE_TESTS==='1';
test('local Supabase: encrypted persistence, CAS race, RLS and account cleanup', {skip:!enabled},async()=>{
  const url=process.env.SUPABASE_URL??'';
  assert.ok(['127.0.0.1','localhost','[::1]'].includes(new URL(url).hostname),'Local database integration only');
  const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey=process.env.SUPABASE_ANON_KEY;
  assert.ok(serviceKey&&anonKey,'Provide local service and anon keys');
  const store=new SupabaseStore(url,serviceKey,randomBytes(32).toString('base64'));
  const email=`integration-${randomUUID()}@example.invalid`;
  const password=randomBytes(32).toString('hex');
  const {data,error}=await store.client.auth.admin.createUser({email,password,email_confirm:true});
  assert.equal(error,null);assert.ok(data.user);
  const uid=data.user.id;
  try{
    const key=randomBytes(32);
    assert.equal(await store.load(uid),null);
    const state=fresh(uid);state.pa={id:'pa',name:'private-content-not-plaintext'};
    const revision=await store.save(uid,pack(state),key,0);
    assert.equal(revision,1);
    const loaded=await store.load(uid);
    assert.deepEqual((loaded?.value as {pa:unknown}).pa,state.pa);
    const row=await store.client.from('runtime_entities').select('ciphertext').eq('user_id',uid).eq('kind','pa').single();
    assert.equal(row.error,null);
    assert.ok(!JSON.stringify(row.data).includes('private-content-not-plaintext'));
    const race=await Promise.allSettled([
      store.save(uid,pack(state),key,revision),
      store.save(uid,pack(state),key,revision),
    ]);
    assert.equal(race.filter(r=>r.status==='fulfilled').length,1,'exactly one CAS writer succeeds');
    const core=state.book.remember({content:'retain core',user_signal:'remember'}).memory!;
    const current=await store.load(uid);assert.ok(current);
    const withCore=await store.save(uid,pack(state),key,current.revision);
    core.state='archived';
    await assert.rejects(store.save(uid,pack(state),key,withCore),'nightly/server generic write cannot archive core');
    assert.equal((await store.load(uid))?.revision,withCore,'rejected core write is atomic');
    await store.save(uid,pack(state),key,withCore,[{id:core.id,operation:'edit'}]);
    const browser=new SupabaseStore(url,anonKey,randomBytes(32).toString('base64')).client;
    const login=await browser.auth.signInWithPassword({email,password});assert.equal(login.error,null);
    const write=await browser.from('runtime_entities').update({ciphertext:'forged'}).eq('user_id',uid);
    assert.ok(write.error,'browser cannot write runtime ciphertext');
    const rpc=await browser.rpc('save_runtime_projection',{p_user_id:uid,p_entities:[],p_core_actions:[],p_wrapped_key:'forged',p_revision:2});
    assert.ok(rpc.error,'browser cannot execute service-only save RPC');
    await store.delete(uid);
    await assert.rejects(()=>store.load(uid),/账号正在删除/,'deleted owner remains fenced against resurrection');
    const remaining=await store.client.from('runtime_projection_state').select('user_id').eq('user_id',uid);assert.equal(remaining.error,null);assert.deepEqual(remaining.data,[],'account deletion removes encrypted state');
  }finally{
    // A failed assertion must not leave generated credentials/accounts behind.
    const deleted=await store.client.auth.admin.deleteUser(uid);
    if(deleted.error&&!/not found|does not exist/i.test(deleted.error.message))throw deleted.error;
  }
});
