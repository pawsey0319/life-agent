import test from 'node:test';
import assert from 'node:assert/strict';
import {SupabaseStore} from '../src/storage.js';

function fake(options:{fenceError?:boolean;removeError?:boolean;authError?:boolean}={}){
 const calls:string[]=[];
 const client={
  rpc:async(name:string)=>{calls.push(name);return {error:options.fenceError?{}:null};},
  from:(table:string)=>{calls.push(table);return {select:()=>({eq:()=>({order:()=>({range:async()=>({data:[{path:'owner/asset.bin'}],error:null})})})})};},
  storage:{from:(bucket:string)=>({remove:async(paths:string[])=>{calls.push(`remove:${bucket}:${paths.join(',')}`);return {error:options.removeError?{}:null};}})},
  auth:{admin:{deleteUser:async(userId:string)=>{calls.push(`auth:${userId}`);return {error:options.authError?{}:null};}}},
 };
 return {store:{client} as unknown as SupabaseStore,calls};
}
test('account deletion fences before private Storage cleanup and Auth destruction',async()=>{
 const {store,calls}=fake();await SupabaseStore.prototype.delete.call(store,'owner');
 assert.deepEqual(calls,['begin_runtime_account_deletion','runtime_asset_cleanup','remove:life-agent-assets:owner/asset.bin','auth:owner']);
});
test('failed fence or Storage cleanup never reports success or deletes Auth',async()=>{
 for(const option of [{fenceError:true},{removeError:true}]){const {store,calls}=fake(option);await assert.rejects(()=>SupabaseStore.prototype.delete.call(store,'owner'));assert.ok(!calls.includes('auth:owner'));}
});
test('Auth failure leaves permanent fence for retry instead of rollback',async()=>{
 const {store,calls}=fake({authError:true});await assert.rejects(()=>SupabaseStore.prototype.delete.call(store,'owner'));assert.equal(calls[0],'begin_runtime_account_deletion');assert.equal(calls.at(-1),'auth:owner');assert.ok(!calls.some(x=>x.includes('unfence')));
});
