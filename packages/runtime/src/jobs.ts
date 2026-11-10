import {DomainError} from '@life-agent/core';
import {z} from 'zod';
import {encrypt,decrypt,type SupabaseStore} from './storage.js';
import {hasModelPurpose,type Models} from './providers.js';
import {assetBackend,uploadImageAsset,removeImageAsset,type AssetBackend,type ImageAsset} from './assets.js';

export const imageJobPayloadSchema=z.object({name:z.string().trim().min(1).max(20000),appearance:z.string().trim().min(1).max(20000),personality:z.string().trim().min(1).max(20000),relationship:z.string().trim().min(1).max(20000),exclusions:z.string().max(20000)}).strict();
export type ImageJobPayload=z.infer<typeof imageJobPayloadSchema>;
export type ImageJob={id:string;user_id:string;kind:string;status:string;payload_ciphertext:string;lease_token:string;attempts:number;result_ciphertext?:string|null};
export type ImageJobResult=({imageUrl:string;asset?:never}|{asset:ImageAsset;imageUrl?:never})&{completedAt:string};
export type ImageCandidate={id:string;name:string;description:string;createdAt:string;imageUrl?:string;imageAsset?:ImageAsset};
export type JobBackend={
 rpc(name:string,params?:Record<string,unknown>):PromiseLike<{data:unknown;error:unknown}>;
 load(userId:string):Promise<{value:unknown;key:Buffer}|null>;
 assets?:AssetBackend;
};
export function jobBackend(store:SupabaseStore):JobBackend{return {rpc:(name,params)=>store.client.rpc(name,params),load:id=>store.load(id),assets:store.client.storage?assetBackend(store):undefined};}
const MAX_IMAGE_BYTES=10*1024*1024;
/** Inline bytes only: no URL fetch, no SSRF, no external expiring link retained. */
export function durableImageData(image:unknown):string{
 if(typeof image!=='string'||image.length>Math.ceil(MAX_IMAGE_BYTES*4/3)+128)throw new DomainError('IMAGE_ASSET','图像缺失或超过 10MB',503);
 const match=/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(image);
 if(!match)throw new DomainError('IMAGE_ASSET','异步图像必须提供内联 PNG/JPEG/WebP；不会抓取外部地址',503);
 const bytes=Buffer.from(match[2]!,'base64');
 if(bytes.length===0||bytes.length>MAX_IMAGE_BYTES||bytes.toString('base64')!==match[2])throw new DomainError('IMAGE_ASSET','图像编码无效或超过 10MB',503);
 const type=match[1];const valid=type==='png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):type==='jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP';
 if(!valid)throw new DomainError('IMAGE_ASSET','图像类型与内容不匹配',503);
 return image;
}
async function rpc(backend:JobBackend,name:string,params?:Record<string,unknown>){const result=await backend.rpc(name,params);if(result.error)throw new DomainError('JOB_STORAGE','图像任务存储暂不可用',503);return result.data;}
export async function enqueueImageJob(store:SupabaseStore,userId:string,key:Buffer,payload:ImageJobPayload,idempotencyKey:string):Promise<string>{
 const backend=jobBackend(store);
 const parsed=imageJobPayloadSchema.parse(payload);if(!idempotencyKey.trim()||idempotencyKey.length>200)throw new DomainError('JOB_KEY','任务幂等键无效',422);
 const owner=await backend.load(userId);if(!owner)throw new DomainError('JOB_OWNER','请先保存用户状态再创建任务',409);
 if(!owner.key.equals(key))throw new DomainError('JOB_OWNER','用户密钥已变化，请刷新重试',409);
 const value=owner.value as {pa?:unknown};if(value.pa)throw new DomainError('PA_LOCKED','已经确认唯一 PA',409);
 const result=await rpc(backend,'enqueue_runtime_job',{p_user_id:userId,p_idempotency_key:idempotencyKey,p_payload_ciphertext:encrypt(JSON.stringify(parsed),owner.key)});
 if(typeof result!=='string')throw new DomainError('JOB_STORAGE','任务存储返回无效标识',503);return result;
}
/** Owner is supplied by authenticated runtime, never by request JSON. */
export function decodeImageJobResult(row:Pick<ImageJob,'user_id'|'result_ciphertext'>,userId:string,key:Buffer):ImageJobResult{
 if(row.user_id!==userId||!row.result_ciphertext)throw new DomainError('FORBIDDEN','不可读取其他用户或未完成的任务',403);
 const decoded=z.union([z.object({imageUrl:z.string(),completedAt:z.string().datetime()}).strict(),z.object({asset:z.object({id:z.string(),path:z.string(),jobId:z.string().optional()}).strict(),completedAt:z.string().datetime()}).strict()]).parse(JSON.parse(decrypt(row.result_ciphertext,key)));
 return 'imageUrl' in decoded?{...decoded,imageUrl:durableImageData(decoded.imageUrl)}:decoded;
}
export async function readImageJob(store:SupabaseStore,userId:string,key:Buffer,jobId:string):Promise<{job:{id:string;status:string;attempts:number};candidate?:ImageCandidate}>{
 const response=await store.client.from('runtime_jobs').select('id,user_id,status,attempts,payload_ciphertext,result_ciphertext').eq('user_id',userId).eq('id',jobId).maybeSingle();
 if(response.error)throw new DomainError('JOB_STORAGE','无法读取图像任务',503);
 if(!response.data)throw new DomainError('NOT_FOUND','任务不存在',404);
 const row=response.data as ImageJob;const job={id:row.id,status:row.status,attempts:row.attempts};
 if(row.user_id!==userId)throw new DomainError('FORBIDDEN','任务不属于当前用户',403);
 if(row.status!=='completed'&&row.status!=='succeeded')return {job};
 const result=decodeImageJobResult(row,userId,key);const payload=imageJobPayloadSchema.parse(JSON.parse(decrypt(row.payload_ciphertext,key)));
 if('asset' in result&&result.asset?.jobId!==row.id)throw new DomainError('FORBIDDEN','图片资产与任务不匹配',403);
 return {job,candidate:{id:row.id,name:payload.name,description:`${payload.appearance}；${payload.personality}；${payload.relationship}`,createdAt:result.completedAt,...('asset' in result?{imageAsset:result.asset}:{imageUrl:result.imageUrl})}};
}
function permanent(error:unknown){return error instanceof z.ZodError||error instanceof DomainError&&['IMAGE_ASSET','EXTRACTION_FORMAT','PROVIDER_FORMAT'].includes(error.code);}
export async function processImageJob(store:SupabaseStore,models:Pick<Models,'image'|'configuredPurposes'>,now=Date.now()){return processImageJobWithBackend(jobBackend(store),models,now);}
export async function processImageJobWithBackend(backend:JobBackend,models:Pick<Models,'image'|'configuredPurposes'>,now=Date.now()):Promise<{status:'disabled'|'idle'|'completed'|'cancelled'|'failed'|'lease_lost';jobId?:string}>{
 if(!hasModelPurpose(models,'image'))return {status:'disabled'};
 const claimed=await rpc(backend,'claim_runtime_job');
 if(!Array.isArray(claimed)||claimed.length>1)throw new DomainError('JOB_STORAGE','任务租约返回无效',503);
 if(!claimed.length)return {status:'idle'};
 const row=claimed[0] as ImageJob;
 const binding={p_user_id:row.user_id,p_job_id:row.id,p_lease_token:row.lease_token};
 if(!row.id||!row.user_id||!row.lease_token||row.kind!=='image')throw new DomainError('JOB_STORAGE','图像任务租约格式无效',503);
 let uploadedAsset:ImageAsset|undefined;
 let completionAttempted=false;
 try{
  const owner=await backend.load(row.user_id);
  if(!owner||(owner.value as {pa?:unknown}).pa||typeof (owner.value as {candidateJobId?:unknown}).candidateJobId==='string'&&(owner.value as {candidateJobId:string}).candidateJobId!==row.id){const cancelled=await rpc(backend,'cancel_runtime_job',{p_user_id:row.user_id,p_job_id:row.id});return {status:cancelled===false?'lease_lost':'cancelled',jobId:row.id};}
  let payload:ImageJobPayload;try{payload=imageJobPayloadSchema.parse(JSON.parse(decrypt(row.payload_ciphertext,owner.key)));}catch{throw new DomainError('IMAGE_ASSET','图像任务载荷损坏',503);}
  const imageUrl=durableImageData(await models.image(`Create companion portrait. Appearance: ${payload.appearance}. Personality: ${payload.personality}. Exclude: ${payload.exclusions}`));
  // Recheck deletion/PA confirmation and key rotation after expensive external work.
  const latest=await backend.load(row.user_id);
  if(!latest||(latest.value as {pa?:unknown}).pa||!latest.key.equals(owner.key)||typeof (latest.value as {candidateJobId?:unknown}).candidateJobId==='string'&&(latest.value as {candidateJobId:string}).candidateJobId!==row.id){const cancelled=await rpc(backend,'cancel_runtime_job',{p_user_id:row.user_id,p_job_id:row.id});return {status:cancelled===false?'lease_lost':'cancelled',jobId:row.id};}
  if(!backend.assets)throw new DomainError('ASSET_STORAGE','图像 Worker 必须配置私有资产存储',503);
  uploadedAsset=await uploadImageAsset(backend.assets,row.user_id,row.id,row.lease_token,imageUrl,owner.key);
  const result:ImageJobResult={asset:uploadedAsset,completedAt:new Date(now).toISOString()};
  const resultCiphertext=encrypt(JSON.stringify(result),owner.key);
  completionAttempted=true;
  const complete=await rpc(backend,'complete_runtime_job',{...binding,p_result_ciphertext:resultCiphertext});
  if(complete!==true){await removeImageAsset(backend.assets,row.user_id,uploadedAsset);uploadedAsset=undefined;}
  return {status:complete===true?'completed':'lease_lost',jobId:row.id};
 }catch(error){
  // A lost completion response may hide a committed result referencing this object.
  // Keep the durable ledger/object on ambiguity; only a definite false is cleaned above.
  // Fenced-account sweeps reconcile retained assets; never break a successful image.
  if(uploadedAsset&&backend.assets&&!completionAttempted)await removeImageAsset(backend.assets,row.user_id,uploadedAsset);
  // Backend owns attempt budget/backoff; no payload, provider body or secret in errors/queue.
  const failed=await rpc(backend,'fail_runtime_job',{...binding,p_retry:!permanent(error)});
  return {status:failed===false?'lease_lost':'failed',jobId:row.id};
 }
}
