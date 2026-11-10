import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {OpenAIModels} from '../src/providers.js';

test('model redirects fail without forwarding private request bodies to a new endpoint',async()=>{
 let targetCalls=0;
 const server=createServer((req,res)=>{if(req.url==='/chat/completions'){res.writeHead(307,{location:'/target'});res.end();}else{targetCalls++;res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:'should not follow'}}]}));}});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 try{const address=server.address();assert.ok(address&&typeof address!=='string');const models=new OpenAIModels({baseUrl:`http://127.0.0.1:${address.port}`,apiKey:'test-only',textModel:'text',extractModel:'extract',embedModel:'embed',imageModel:'image'});await assert.rejects(()=>models.text([{role:'user',content:'private text'}]),{code:'PROVIDER_UNAVAILABLE'});assert.equal(targetCalls,0);}finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
