// Independent crypto regression. Run: pnpm exec tsx --test tests/encryption-check.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {encrypt,decrypt} from '../packages/runtime/src/storage.js';

test('AES-GCM roundtrip, randomized IV and authentication failure',()=>{
 const key=randomBytes(32),text='只有我知道的中文记忆 🌿';
 const a=encrypt(text,key),b=encrypt(text,key);
 assert.notEqual(a,b);
 assert.equal(decrypt(a,key),text);
 assert.equal(a.includes(text),false);
 assert.throws(()=>decrypt(a,randomBytes(32)));
 const damaged=Buffer.from(a,'base64');damaged[damaged.length-1]^=1;
 assert.throws(()=>decrypt(damaged.toString('base64'),key));
 assert.throws(()=>decrypt('',key));
});
