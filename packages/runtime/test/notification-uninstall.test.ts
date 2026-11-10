import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../src/app.js';

test('HTTP uninstall removes digest contributions and bootstrap never leaks provenance',async()=>{
 const app=createApp({mode:'demo'});
 async function call(path:string,method='GET',body?:unknown){const response=await app.request(`http://127.0.0.1/api${path}`,{method,headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});assert.equal(response.status<400,true,`${method} ${path}: ${response.status}`);return response.json();}
 const one=(await call('/blocks','POST',{name:'one',domain:'reading',persona:'helper',components:['records']})).block;
 const two=(await call('/blocks','POST',{name:'two',domain:'reading',persona:'helper',components:['plans']})).block;
 await call(`/blocks/${one.id}/records`,'POST',{component:'records',content:'PRIVATE ONE'});
 await call(`/blocks/${two.id}/records`,'POST',{component:'plans',content:'PRIVATE TWO'});
 await call('/interactions','POST',{type:'feed'});
 // Select an IANA zone whose local time is already past 08:00 at the sampled instant.
 const utcHour=new Date().getUTCHours();const zone=utcHour>=8?'Etc/UTC':'Pacific/Kiritimati';
 await call('/notifications/preferences','PATCH',{timeZone:zone});await call('/worker/tick','POST',{});
 const before=await call('/bootstrap'); const digest=before.inbox.find((item:{type:string})=>item.type==='achievement_digest'); assert.ok(digest);
 assert.equal(JSON.stringify(before.inbox).includes('_achievementContributions'),false);assert.equal(JSON.stringify(before.inbox).includes('sourceBlockId'),false);assert.equal(JSON.stringify(before.inbox).includes('PRIVATE'),false);
 await call(`/blocks/${one.id}`,'DELETE');const after=await call('/bootstrap');const remaining=after.inbox.find((item:{type:string})=>item.type==='achievement_digest');assert.ok(remaining);assert.deepEqual(remaining.achievements.map((a:{type:string})=>a.type).sort(),['feed','plan']);
 await call(`/blocks/${two.id}`,'DELETE');await call('/worker/tick','POST',{});const last=await call('/bootstrap');assert.deepEqual(last.inbox.find((item:{type:string})=>item.type==='achievement_digest').achievements.map((a:{type:string})=>a.type),['feed']);assert.equal(last.notificationState.lastDigestDate,before.notificationState.lastDigestDate);
});
