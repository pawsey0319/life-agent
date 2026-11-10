import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { DomainError } from '@life-agent/core';
export function encrypt(text:string,key:Buffer){const iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',key,iv);const body=Buffer.concat([cipher.update(text,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),body]).toString('base64');}
export function decrypt(value:string,key:Buffer){const bytes=Buffer.from(value,'base64');const cipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));cipher.setAuthTag(bytes.subarray(12,28));return Buffer.concat([cipher.update(bytes.subarray(28)),cipher.final()]).toString('utf8');}
export class SupabaseStore {
 readonly client:SupabaseClient;readonly master:Buffer;
 constructor(url:string,serviceKey:string,masterKey:string){this.client=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});this.master=Buffer.from(masterKey,'base64');if(this.master.length!==32)throw new Error('DATA_MASTER_KEY must be 32 bytes encoded as base64');}
 async authenticate(token:string){const {data,error}=await this.client.auth.getUser(token);if(error||!data.user)throw new DomainError('UNAUTHORIZED','登录凭证无效',401);return data.user;}
 async load(userId:string){const {data,error}=await this.client.from('runtime_state').select('ciphertext,wrapped_key,revision').eq('user_id',userId).maybeSingle();if(error)throw new DomainError('STORAGE_ERROR','无法读取加密数据',503);if(!data)return null;const key=Buffer.from(decrypt(data.wrapped_key as string,this.master),'base64');return {value:JSON.parse(decrypt(data.ciphertext as string,key)) as unknown,key,revision:data.revision as number};}
 async save(userId:string,value:unknown,key:Buffer,revision:number){const {data,error}=await this.client.rpc('save_runtime_state',{p_user_id:userId,p_ciphertext:encrypt(JSON.stringify(value),key),p_wrapped_key:encrypt(key.toString('base64'),this.master),p_revision:revision});if(error)throw new DomainError('STORAGE_CONFLICT','数据保存冲突或服务不可用，请刷新后重试',503);return data as number;}
 async delete(userId:string){const {error}=await this.client.auth.admin.deleteUser(userId);if(error)throw new DomainError('DELETE_FAILED','账号删除失败',503);}
}
