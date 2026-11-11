import {DomainError} from '@life-agent/core';
import {lookup} from 'node:dns/promises';
import https from 'node:https';
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
const IMAGE_FETCH_TIMEOUT_MS=15000;
const PNG_SIGNATURE=Buffer.from([137,80,78,71,13,10,26,10]);
function imageMime(bytes:Buffer):'png'|'jpeg'|'webp'|undefined{if(bytes.subarray(0,8).equals(PNG_SIGNATURE))return 'png';if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'jpeg';if(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP')return 'webp';}
/** Inline bytes only: no URL fetch, no SSRF, no external expiring link retained. */
export function durableImageData(image:unknown):string{
 if(typeof image!=='string'||image.length>Math.ceil(MAX_IMAGE_BYTES*4/3)+128)throw new DomainError('IMAGE_ASSET','图像缺失或超过 10MB',503);
 const match=/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(image);
 if(!match)throw new DomainError('IMAGE_ASSET','异步图像必须提供内联 PNG/JPEG/WebP；不会抓取外部地址',503);
 const bytes=Buffer.from(match[2]!,'base64');
 if(bytes.length===0||bytes.length>MAX_IMAGE_BYTES||bytes.toString('base64')!==match[2])throw new DomainError('IMAGE_ASSET','图像编码无效或超过 10MB',503);
 if(imageMime(bytes)!==match[1])throw new DomainError('IMAGE_ASSET','图像类型与内容不匹配',503);
 return image;
}
/** Conservative global-unicast policy: mapped/transition IPv6 is deliberately excluded. */
export function publicImageAddress(address:string):boolean{
 if(address.includes(':'))return /^2[0-9a-f]{3}:/i.test(address)&&!/^2001:(?:0:|db8:|10:|20:)/i.test(address)&&!/^2002:/i.test(address);
 const p=address.split('.').map(Number);if(p.length!==4||p.some(v=>!Number.isInteger(v)||v<0||v>255))return false;
 return p[0]!>0&&p[0]!<224&&![10,127].includes(p[0]!)&&!(p[0]===100&&p[1]!>=64&&p[1]!<=127)&&!(p[0]===169&&p[1]===254)&&!(p[0]===172&&p[1]!>=16&&p[1]!<=31)&&!(p[0]===192&&(p[1]===168||p[1]===0||p[1]===2))&&!(p[0]===198&&[18,19,51].includes(p[1]!))&&!(p[0]===203&&p[1]===0);
}
export type ImageDownloadTransport=(url:URL,signal:AbortSignal)=>Promise<Response>;
async function pinnedFetch(url:URL,signal:AbortSignal):Promise<Response>{
 const records=await lookup(url.hostname,{all:true,verbatim:true});signal.throwIfAborted();
 if(!records.length||records.some(record=>!publicImageAddress(record.address)))throw new DomainError('IMAGE_ASSET','图像地址不允许访问',503);
 const record=records[0]!;
 return await new Promise((resolve,reject)=>{
  const request=https.get(url,{agent:false,signal,lookup:(_host,options,callback)=>{if(typeof options==='object'&&options.all)callback(null,[record]);else callback(null,record.address,record.family);}},response=>{
   const headers=new Headers();for(const [name,value] of Object.entries(response.headers))if(value!==undefined)headers.set(name,Array.isArray(value)?value.join(','):value);
   const body=new ReadableStream<Uint8Array>({start(controller){response.on('data',(chunk:Buffer)=>controller.enqueue(new Uint8Array(chunk)));response.on('end',()=>controller.close());response.on('error',error=>controller.error(error));},cancel(){response.destroy();request.destroy();}});
   resolve(new Response(body,{status:response.statusCode??500,headers}));
  });request.on('error',reject);
 });
}
async function readLimitedBody(response:Response):Promise<Buffer>{
 const contentLength=response.headers.get('content-length');
 if(contentLength&&(!/^\d+$/.test(contentLength)||Number(contentLength)>MAX_IMAGE_BYTES))throw new DomainError('IMAGE_ASSET','图像缺失或超过 10MB',503);
 if(!response.body)throw new DomainError('IMAGE_ASSET','图像响应为空',503);
 const reader=response.body.getReader();const chunks:Buffer[]=[];let total=0;
 try{while(true){const part=await reader.read();if(part.done)break;total+=part.value.byteLength;if(total>MAX_IMAGE_BYTES)throw new DomainError('IMAGE_ASSET','图像缺失或超过 10MB',503);chunks.push(Buffer.from(part.value));}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 return Buffer.concat(chunks,total);
}
/** Resolve a temporary provider URL only inside the worker, under an exact host allowlist. */
export async function providerImageData(image:unknown,allowedHosts:ReadonlySet<string>=new Set(),transport:ImageDownloadTransport=pinnedFetch):Promise<string>{
 if(typeof image!=='string')throw new DomainError('IMAGE_ASSET','图像缺失或格式无效',503);
 if(image.startsWith('data:'))return durableImageData(image);
 let url:URL;try{url=new URL(image);}catch{throw new DomainError('IMAGE_ASSET','图像地址无效',503);}
 if(url.protocol!=='https:'||url.username||url.password||url.port||!allowedHosts.has(url.hostname.toLowerCase()))throw new DomainError('IMAGE_ASSET','图像地址主机不受信任',503);
 let response:Response;try{response=await transport(url,AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS));}catch(error){if(error instanceof DomainError)throw error;throw new DomainError('PROVIDER_UNAVAILABLE','图像下载失败',503);}
 if(!response.ok){await response.body?.cancel();throw new DomainError(response.status>=300&&response.status<400?'IMAGE_ASSET':'PROVIDER_ERROR','图像服务返回错误',503);}
 const bytes=await readLimitedBody(response);const type=imageMime(bytes);if(!type)throw new DomainError('IMAGE_ASSET','图像类型与内容不匹配',503);
 return durableImageData(`data:image/${type};base64,${bytes.toString('base64')}`);
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
export async function processImageJob(store:SupabaseStore,models:Pick<Models,'image'|'configuredPurposes'|'imageAssetHosts'>,now=Date.now()){return processImageJobWithBackend(jobBackend(store),models,now);}
export async function processImageJobWithBackend(backend:JobBackend,models:Pick<Models,'image'|'configuredPurposes'|'imageAssetHosts'>,now=Date.now()):Promise<{status:'disabled'|'idle'|'completed'|'cancelled'|'failed'|'lease_lost';jobId?:string}>{
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
  const imageUrl=await providerImageData(await models.image(`Create companion portrait. Appearance: ${payload.appearance}. Personality: ${payload.personality}. Exclude: ${payload.exclusions}`),models.imageAssetHosts);
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
  // A lost completion response may hide a committed result referencing this object; retain it on ambiguity.
  if(uploadedAsset&&backend.assets&&!completionAttempted)await removeImageAsset(backend.assets,row.user_id,uploadedAsset);
  const failed=await rpc(backend,'fail_runtime_job',{...binding,p_retry:!permanent(error)});
  return {status:failed===false?'lease_lost':'failed',jobId:row.id};
 }
}
