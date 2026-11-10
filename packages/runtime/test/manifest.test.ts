import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, fresh, pack } from '../src/app.js';
import { DemoModels } from '../src/providers.js';
import type { SupabaseStore } from '../src/storage.js';

type Manifest={version:1;conversation:{enabled:boolean};capabilities:('records'|'plans')[];data:{fields:('records'|'schedule')[];purposes:('answer'|'summary')[]};ui:{components:('records'|'plans')[]};events:('record.created'|'schedule.due')[]};
const restricted=():Manifest=>({version:1,conversation:{enabled:true},capabilities:['records'],data:{fields:['records'],purposes:['answer']},ui:{components:['records']},events:['record.created']});
const request=(app:ReturnType<typeof createApp>,path:string,method='GET',body?:unknown)=>app.request(`http://localhost/api${path}`,{method,headers:{'content-type':'application/json',authorization:'Bearer test'},...(body!==undefined?{body:JSON.stringify(body)}:{})});
async function block(app:ReturnType<typeof createApp>){const response=await request(app,'/blocks','POST',{name:'journal',domain:'custom',persona:'journal companion',components:['records']});assert.equal(response.status,200);return (await response.json()).block as {id:string};}
async function grant(app:ReturnType<typeof createApp>,blockId:string,field='records'){const response=await request(app,'/grants','POST',{sourceBlockId:blockId,granteeBlockId:'pa',field,purpose:'answer'});assert.equal(response.status,200);return (await response.json()).grant as {id:string;sourceManifestVersion:number};}

test('manifest shrink revokes previous long grants even when retained field remains available',async()=>{
 const app=createApp({mode:'demo'});const b=await block(app);const g=await grant(app,b.id);
 const update=await request(app,`/blocks/${b.id}/manifest`,'PUT',restricted());assert.equal(update.status,200);const updated=await update.json();assert.equal(updated.decision,'UPDATED');assert.equal(updated.block.manifestVersion,2);
 const stale=await request(app,`/grants/${g.id}/read`,'POST',{});assert.equal(stale.status,403);assert.equal((await stale.json()).error.code,'RECONSENT_REQUIRED');
 const newGrant=await grant(app,b.id);assert.equal(newGrant.sourceManifestVersion,2);assert.equal((await request(app,`/grants/${newGrant.id}/read`,'POST',{})).status,200);
 const state=await(await request(app,'/bootstrap')).json();assert.equal(state.grants.find((x:{id:string})=>x.id===g.id).status,'reconsent');assert.ok(state.audit.some((x:{action:string})=>x.action==='reconsent'));
});

test('expansion is pending and all prior active block operations fail closed; reject preserves old manifest but not old grants',async()=>{
 const app=createApp({mode:'demo'});const b=await block(app);await request(app,`/blocks/${b.id}/manifest`,'PUT',restricted());const g=await grant(app,b.id);
 const session=(await(await request(app,'/sessions','POST',{blockId:b.id})).json()).session;
 const expanded=restricted();expanded.capabilities.push('plans');expanded.ui.components.push('plans');expanded.data.fields.push('schedule');
 const response=await request(app,`/blocks/${b.id}/manifest`,'PUT',expanded);const pending=await response.json();assert.equal(pending.decision,'ASK_RECONSENT');assert.equal(pending.block.status,'active');assert.equal(pending.block.manifestVersion,3);
 for(const [path,method,body] of [[`/blocks/${b.id}/records`,'GET',undefined],[`/blocks/${b.id}/records`,'POST',{component:'records',content:'x'}],['/sessions','POST',{blockId:b.id}],[`/sessions/${session.id}/messages`,'POST',{content:'hello'}],['/grants','POST',{sourceBlockId:b.id,granteeBlockId:'pa',field:'records',purpose:'answer'}]] as const){const denied=await request(app,path,method,body);assert.ok(denied.status>=400,`${method} ${path} must deny pending block`);}
 assert.equal((await request(app,`/grants/${g.id}/read`,'POST',{})).status,403);
 const rejected=await(await request(app,`/blocks/${b.id}/manifest/decide`,'POST',{allow:false})).json();assert.deepEqual(rejected.block.manifest,restricted());assert.equal(rejected.block.manifestVersion,4);assert.equal(rejected.block.pendingManifest,undefined);
 assert.equal((await request(app,`/blocks/${b.id}/records`)).status,200);assert.equal((await request(app,`/grants/${g.id}/read`,'POST',{})).status,403);
 assert.equal((await request(app,'/grants','POST',{sourceBlockId:b.id,granteeBlockId:'pa',field:'schedule',purpose:'answer'})).status,403);
});

test('approved expansion updates version, fields and components only after explicit consent',async()=>{
 const app=createApp({mode:'demo'});const b=await block(app);await request(app,`/blocks/${b.id}/manifest`,'PUT',restricted());
 const expanded=restricted();expanded.data.fields.push('schedule');expanded.capabilities.push('plans');expanded.ui.components.push('plans');
 await request(app,`/blocks/${b.id}/manifest`,'PUT',expanded);
 assert.equal((await request(app,`/blocks/${b.id}/records`,'POST',{component:'plans',content:'new plan'})).status,409);
 const accepted=await(await request(app,`/blocks/${b.id}/manifest/decide`,'POST',{allow:true})).json();assert.equal(accepted.block.manifestVersion,4);assert.deepEqual(accepted.block.manifest,expanded);
 assert.equal((await request(app,`/blocks/${b.id}/records`,'POST',{component:'plans',content:'new plan'})).status,200);
 assert.equal((await request(app,'/grants','POST',{sourceBlockId:'pa',granteeBlockId:b.id,field:'schedule',purpose:'answer'})).status,200);
 assert.equal((await request(app,'/grants','POST',{sourceBlockId:'pa',granteeBlockId:b.id,field:'health',purpose:'answer',confirmedSensitive:true})).status,403);
});

test('unknown field manifest is rejected without mutating active grant or version',async()=>{
 const app=createApp({mode:'demo'});const b=await block(app);const g=await grant(app,b.id);const invalid={...restricted(),data:{fields:['private_whatever'],purposes:['answer']}};
 assert.equal((await request(app,`/blocks/${b.id}/manifest`,'PUT',invalid)).status,422);
 const state=await(await request(app,'/bootstrap')).json();assert.equal(state.blocks[0].manifestVersion,1);assert.equal(state.blocks[0].pendingManifest,undefined);assert.equal((await request(app,`/grants/${g.id}/read`,'POST',{})).status,200);
});

test('persisted pre-version legacy long grants fail closed on restore rather than inheriting current policy',async()=>{
 const state=fresh('legacy-user');state.blocks.push({id:'legacy-block',name:'legacy',domain:'custom',persona:'p',status:'active',components:['records'],createdAt:new Date().toISOString()});
 state.gateway.grants.push({id:'old-grant',sourceBlockId:'legacy-block',granteeBlockId:'pa',field:'records',purpose:'answer',createdAt:new Date().toISOString()} as typeof state.gateway.grants[number]);
 let value:unknown=JSON.parse(JSON.stringify(pack(state)));let revision=1;const store={async authenticate(){return {id:'legacy-user'};},async load(){return {value,key:state.key,revision};},async save(_id:string,next:unknown){value=JSON.parse(JSON.stringify(next));return ++revision;}} as unknown as SupabaseStore;
 const app=createApp({mode:'configured',models:new DemoModels(),store});const response=await request(app,'/grants/old-grant/read','POST',{});assert.equal(response.status,403);assert.equal((await response.json()).error.code,'RECONSENT_REQUIRED');
 const snapshot=await(await request(app,'/bootstrap')).json();assert.ok(snapshot.audit.some((x:{action:string})=>x.action==='reconsent'));
});
