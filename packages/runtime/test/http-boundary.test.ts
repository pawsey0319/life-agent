import test from 'node:test';
import assert from 'node:assert/strict';
import {httpBoundary} from '../src/http-boundary.js';

test('HTTP boundary bounds unknown/chunked bodies and verifies declared length before business handler',async()=>{
 let calls=0;const handle=httpBoundary(async request=>{calls++;return new Response(await request.text());},{maxBytes:8});
 const request=(text:string,length?:string)=>new Request('http://localhost/api/test',{method:'POST',headers:length?{'content-length':length}:{},body:text});
 assert.equal((await handle(request('123456789'))).status,413);
 assert.equal((await handle(request('x','1000'))).status,413);
 assert.equal((await handle(request('abc','2'))).status,400);
 assert.equal((await handle(request('abc','bad'))).status,400);
 assert.equal(calls,0);
 const ok=await handle(request('abc','3'));assert.equal(await ok.text(),'abc');assert.equal(calls,1);
});
test('process-local hashed-credential rate buckets expire and do not trust forwarded IP',async()=>{
 let now=0;const handle=httpBoundary(()=>new Response('ok'),{limit:2,windowMs:1000,now:()=>now});
 const request=(token?:string)=>new Request('http://localhost/api/bootstrap',{headers:{...(token?{authorization:`Bearer ${token}`}:{ }),'x-forwarded-for':String(Math.random())}});
 assert.equal((await handle(request())).status,200);assert.equal((await handle(request())).status,200);
 const denied=await handle(request());assert.equal(denied.status,429);assert.equal(denied.headers.get('retry-after'),'1');
 assert.equal((await handle(request('separate'))).status,200);
 now=1000;assert.equal((await handle(request())).status,200);
});
