import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createApp,fresh,pack} from '../src/app.js';
import {DemoModels} from '../src/providers.js';
import {encrypt,type SupabaseStore} from '../src/storage.js';

test('configured bootstrap/export hydrate owner PA image without persisting plaintext; foreign asset metadata denies',async()=>{
 const key=randomBytes(32);const image='data:image/png;base64,'+Buffer.from([137,80,78,71,13,10,26,10,0]).toString('base64');
 const asset={id:'asset-1',path:'alice/asset-1.bin',jobId:'job-1'};const initial=fresh('alice');initial.pa={id:'pa',name:'Companion',imageAsset:asset};let value:unknown=JSON.parse(JSON.stringify(pack(initial)));let revision=1;let downloaded=0;const assetScopes:Record<string,unknown>[]=[];
 const encrypted=Buffer.from(encrypt(image,key),'utf8');
 const fake={async authenticate(){return {id:'alice'};},async load(){return {value:structuredClone(value),key,revision};},async save(_userId:string,next:unknown,_key:Buffer,expected:number){assert.equal(expected,revision);value=structuredClone(next);return ++revision;},client:{from(table:string){assert.equal(table,'runtime_assets');const scope:Record<string,unknown>={};const query={select(){return query;},eq(column:string,filter:unknown){scope[column]=filter;return query;},async maybeSingle(){assetScopes.push(scope);return {data:scope.user_id==='alice'&&scope.id==='asset-1'&&scope.path===asset.path?{id:'asset-1',path:asset.path,job_id:'job-1',status:'ready'}:null,error:null};}};return query;},storage:{from(bucket:string){assert.equal(bucket,'life-agent-assets');return {async download(path:string){assert.equal(path,asset.path);downloaded++;return {data:new Blob([new Uint8Array(encrypted)]),error:null};}};}}}};
 const app=createApp({mode:'configured',models:new DemoModels(),store:fake as unknown as SupabaseStore});
 const request=(path:string)=>app.request(`http://localhost/api${path}`,{headers:{authorization:'Bearer alice'}});
 const bootResponse=await request('/bootstrap');assert.equal(bootResponse.status,200);const boot=await bootResponse.json();assert.equal(boot.pa.imageUrl,image);assert.deepEqual(boot.pa.imageAsset,asset);
 const exportedResponse=await request('/export');assert.equal(exportedResponse.status,200);const exported=await exportedResponse.json();assert.equal(exported.pa.imageUrl,image);assert.equal(downloaded,2);assert.ok(!JSON.stringify(value).includes(image));assert.deepEqual((value as {pa:unknown}).pa,{id:'pa',name:'Companion',imageAsset:asset});assert.equal(revision,1);assert.deepEqual(assetScopes[0],{user_id:'alice',id:'asset-1',path:asset.path,status:'ready'});
 (value as {pa:{imageAsset:typeof asset}}).pa.imageAsset={id:'asset-1',path:'bob/asset-1.bin',jobId:'job-1'};
 const denied=await request('/bootstrap');assert.equal(denied.status,403);assert.equal((await denied.json()).error.code,'FORBIDDEN');assert.equal(downloaded,2,'foreign metadata rejected before Storage download');
});
