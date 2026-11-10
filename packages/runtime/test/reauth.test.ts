import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../src/app.js';
import {DemoModels} from '../src/providers.js';
import type {SupabaseStore} from '../src/storage.js';

test('configured deletion rejects absent, malformed, future, old or foreign recent-login metadata',async()=>{
 for(const recent of [undefined,'invalid',new Date(Date.now()+60000).toISOString(),new Date(Date.now()-301000).toISOString(),'foreign',new Date().toISOString()]){
  let deleted=false;
  const store={authenticate:async(token:string)=>token==='fresh'?{id:recent==='foreign'?'other':'owner',last_sign_in_at:recent}:{id:'owner'},load:async()=>null,save:async()=>1,delete:async()=>{deleted=true;}} as unknown as SupabaseStore;
  const app=createApp({mode:'configured',store,models:new DemoModels()});
  const response=await app.request('http://localhost/api/account',{method:'DELETE',headers:{authorization:'Bearer session','content-type':'application/json'},body:JSON.stringify({confirmation:'DELETE',reauthToken:'fresh'})});
  const valid=typeof recent==='string'&&Number.isFinite(Date.parse(recent))&&Math.abs(Date.now()-Date.parse(recent))<5000;
  assert.equal(response.status,valid?200:403,String(recent));assert.equal(deleted,valid);
 }
});
