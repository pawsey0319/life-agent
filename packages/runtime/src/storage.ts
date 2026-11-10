import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { DomainError } from '@life-agent/core';
import {projectState,unprojectState,type CoreAction} from './projection.js';
export function encrypt(text:string,key:Buffer){const iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',key,iv);const body=Buffer.concat([cipher.update(text,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),body]).toString('base64');}
export function decrypt(value:string,key:Buffer){const bytes=Buffer.from(value,'base64');const cipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));cipher.setAuthTag(bytes.subarray(12,28));return Buffer.concat([cipher.update(bytes.subarray(28)),cipher.final()]).toString('utf8');}
export class SupabaseStore {
 readonly client:SupabaseClient;readonly master:Buffer;
 constructor(url:string,serviceKey:string,masterKey:string){this.client=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});this.master=Buffer.from(masterKey,'base64');if(this.master.length!==32)throw new Error('DATA_MASTER_KEY must be 32 bytes encoded as base64');}
 async authenticate(token:string){const {data,error}=await this.client.auth.getUser(token);if(error||!data.user)throw new DomainError('UNAUTHORIZED','登录凭证无效',401);return data.user;}
 async load(userId:string){
  const {data:header,error}=await this.client.from('runtime_projection_state').select('wrapped_key,revision').eq('user_id',userId).maybeSingle();
  if(error)throw new DomainError('STORAGE_ERROR','无法读取受控加密数据',503);
  if(!header){const legacy=await this.client.from('runtime_state').select('user_id').eq('user_id',userId).maybeSingle();if(legacy.error)throw new DomainError('STORAGE_ERROR','无法检查旧数据',503);if(legacy.data)throw new DomainError('MIGRATION_REQUIRED','检测到旧版聚合数据，请先由管理员执行受控迁移；不会自动绕过核心保护',503);return null;}
  const key=Buffer.from(decrypt(header.wrapped_key as string,this.master),'base64');
  const entities:Parameters<typeof unprojectState>[0]=[];const audit:Parameters<typeof unprojectState>[1]=[];
  for(let offset=0;;offset+=500){const page=await this.client.from('runtime_entities').select('kind,entity_id,ordinal,ciphertext,fingerprint,block_id,parent_id,guard').eq('user_id',userId).order('kind').order('entity_id').range(offset,offset+499);if(page.error)throw new DomainError('STORAGE_ERROR','无法读取受控实体',503);entities.push(...page.data);if(page.data.length<500)break;}
  for(let offset=0;;offset+=500){const page=await this.client.from('runtime_audit_events').select('source_id,ordinal,metadata').eq('user_id',userId).order('source_id').range(offset,offset+499);if(page.error)throw new DomainError('STORAGE_ERROR','无法读取审计事件',503);audit.push(...page.data);if(page.data.length<500)break;}
  // A concurrent commit between header and entities would otherwise produce a mixed snapshot.
  const latest=await this.client.from('runtime_projection_state').select('revision').eq('user_id',userId).single();
  if(latest.error||latest.data.revision!==header.revision)throw new DomainError('STORAGE_CONFLICT','读取期间数据已变化，请重试',503);
  return {value:unprojectState(entities,audit,key),key,revision:header.revision as number};
 }
 async save(userId:string,value:unknown,key:Buffer,revision:number,coreActions:CoreAction[]=[]){
  const {data,error}=await this.client.rpc('save_runtime_projection',{p_user_id:userId,p_wrapped_key:encrypt(key.toString('base64'),this.master),p_revision:revision,p_entities:projectState(value,key),p_core_actions:coreActions});
  if(error)throw new DomainError('STORAGE_CONFLICT','数据保存冲突、核心保护拒绝或服务不可用，请刷新后重试',503);return data as number;
 }
 async delete(userId:string){const {error}=await this.client.auth.admin.deleteUser(userId);if(error)throw new DomainError('DELETE_FAILED','账号删除失败',503);}
}
