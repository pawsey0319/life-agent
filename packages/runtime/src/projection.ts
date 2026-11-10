import {createHmac} from 'node:crypto';
import {DomainError} from '@life-agent/core';
import {encrypt,decrypt} from './storage.js';

type ObjectValue=Record<string,unknown>;
export type CoreAction={id:string;operation:'edit'|'delete'|'confirmed_replace'};
export type ProjectionEntity={kind:string;id:string;ordinal:number;ciphertext?:string;fingerprint?:string;block_id?:string;parent_id?:string;guard?:ObjectValue;[key:string]:unknown};
function canonical(value:unknown):string {if(value===undefined)return 'null';if(value===null||typeof value!=='object')return JSON.stringify(value);if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';return '{'+Object.entries(value as ObjectValue).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';}
export const fingerprint=(value:unknown,key:Buffer)=>createHmac('sha256',key).update(canonical(value)).digest('hex');
const array=(value:unknown):ObjectValue[]=>{if(!Array.isArray(value))throw new DomainError('INVALID_STATE','持久化集合无效',503);return value as ObjectValue[];};
export function projectState(value:unknown,key:Buffer):ProjectionEntity[]{
 const state=value as ObjectValue;const out:ProjectionEntity[]=[];
 const push=(kind:string,row:ObjectValue,ordinal:number)=>{
  const rowId=String(row.id??'');if(!rowId)throw new DomainError('INVALID_STATE','持久化实体缺少ID',503);
  let guarded:unknown=row;
  if(kind==='memory'){const {lastUsedAt,sessionIds,embedding,embeddingContent,embeddingModelKey,...meaningful}=row;guarded=meaningful;}
  const item:ProjectionEntity={kind,id:rowId,ordinal,ciphertext:encrypt(JSON.stringify(row),key),fingerprint:fingerprint(guarded,key)};
  if(row.blockId)item.block_id=String(row.blockId);
  if(kind==='memory')item.guard={tier:row.tier,state:row.state,pinned:row.pinned,sensitive:row.sensitive,subjectKey:fingerprint(row.subject,key)};
  out.push(item);
 };
 if(state.pa)push('pa',state.pa as ObjectValue,0);
 for(const [property,kind] of Object.entries({candidates:'candidate',blocks:'block',records:'record',schedules:'schedule',inbox:'inbox',styles:'style',events:'event'}))array(state[property]).forEach((row,i)=>push(kind,row,i));
 array(state.sessions).forEach((session,i)=>{const {messages,...header}=session;push('session',header,i);array(messages).filter(m=>!m.ephemeral).forEach((message,j)=>{push('message',message,j);out[out.length-1]!.parent_id=String(session.id);out[out.length-1]!.block_id=String(session.blockId);});});
 const book=state.book as ObjectValue;
 for(const [property,kind] of Object.entries({memories:'memory',pending:'pending',feedback:'feedback'}))array(book[property]).forEach((row,i)=>push(kind,row,i));
 if(!Array.isArray(book.deleted))throw new DomainError('INVALID_STATE','删除标记无效',503);
 book.deleted.forEach((deletedId,i)=>push('tombstone',{id:String(deletedId)},i));
 const gateway=state.gateway as ObjectValue;
 for(const [property,kind] of Object.entries({requests:'request',grants:'grant'}))array(gateway[property]).forEach((row,i)=>push(kind,row,i));
 array(gateway.audit).forEach((row,i)=>out.push({kind:'audit',id:String(row.id),ordinal:i,action:String(row.action),at:String(row.at),...(row.field?{field:String(row.field)}:{}),...(row.requestId?{requestId:String(row.requestId)}:{})}));
 const unique=new Set(out.map(e=>e.kind+':'+e.id));if(unique.size!==out.length)throw new DomainError('INVALID_STATE','持久化实体ID重复',503);
 return out;
}
export function unprojectState(rows:{kind:string;entity_id:string;ordinal:number;ciphertext:string;fingerprint:string;guard?:ObjectValue;block_id?:string|null;parent_id?:string|null}[],audit:{source_id:string;ordinal:number;metadata:ObjectValue}[],key:Buffer){
 const state:ObjectValue={pa:null,candidates:[],blocks:[],sessions:[],records:[],schedules:[],inbox:[],styles:[],events:[],book:{memories:[],pending:[],deleted:[],feedback:[]},gateway:{requests:[],grants:[],audit:[]}};
 const book=state.book as ObjectValue;const gateway=state.gateway as ObjectValue;
 const messages:{row:typeof rows[number];value:ObjectValue}[]=[];
 const targets:Record<string,unknown[]>={candidate:state.candidates as unknown[],block:state.blocks as unknown[],session:state.sessions as unknown[],record:state.records as unknown[],schedule:state.schedules as unknown[],inbox:state.inbox as unknown[],style:state.styles as unknown[],event:state.events as unknown[],memory:book.memories as unknown[],pending:book.pending as unknown[],feedback:book.feedback as unknown[],request:gateway.requests as unknown[],grant:gateway.grants as unknown[]};
 for(const row of [...rows].sort((a,b)=>a.ordinal-b.ordinal)){
  const value=JSON.parse(decrypt(row.ciphertext,key)) as ObjectValue;
  const {lastUsedAt,sessionIds,embedding,embeddingContent,embeddingModelKey,...meaningful}=value;
  if(String(value.id)!==row.entity_id||fingerprint(row.kind==='memory'?meaningful:value,key)!==row.fingerprint)throw new DomainError('INVALID_STATE','持久化实体校验失败',503);
  if(row.block_id!==null&&row.block_id!==undefined&&row.kind!=='message'&&String(value.blockId)!==row.block_id)throw new DomainError('INVALID_STATE','持久化命名空间校验失败',503);
  if(row.kind==='memory'&&row.guard&&canonical(row.guard)!==canonical({tier:value.tier,state:value.state,pinned:value.pinned,sensitive:value.sensitive,subjectKey:fingerprint(value.subject,key)}))throw new DomainError('INVALID_STATE','记忆保护元数据校验失败',503);
  if(row.kind==='pa')state.pa=value;
  else if(row.kind==='message')messages.push({row,value});
  else if(row.kind==='tombstone')(book.deleted as unknown[]).push(value.id);
  else if(targets[row.kind]){if(row.kind==='session')value.messages=[];targets[row.kind]!.push(value);}
  else throw new DomainError('INVALID_STATE','未知持久化实体类型',503);
 }
 for(const {row,value} of messages){const session=(state.sessions as ObjectValue[]).find(s=>s.id===row.parent_id);if(!session||session.blockId!==row.block_id)throw new DomainError('INVALID_STATE','消息所属会话无效',503);(session.messages as unknown[]).push(value);}
 gateway.audit=[...audit].sort((a,b)=>a.ordinal-b.ordinal).map(a=>({id:a.source_id,...a.metadata}));
 return state;
}
