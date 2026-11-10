import {DomainError} from '@life-agent/core';
import {encrypt,decrypt,type SupabaseStore} from './storage.js';

export const ASSET_BUCKET='life-agent-assets';
export type ImageAsset={id:string;path:string;jobId?:string};
export type AssetBackend={
 rpc(name:string,params:Record<string,unknown>):PromiseLike<{data:unknown;error:unknown}>;
 ready(userId:string,asset:ImageAsset):Promise<boolean>;
 upload(path:string,bytes:Buffer):Promise<{error:unknown}>;
 download(path:string):Promise<{data:{arrayBuffer():Promise<ArrayBuffer>}|null;error:unknown}>;
 remove(paths:string[]):Promise<{error:unknown}>;
};
export function assetBackend(store:SupabaseStore):AssetBackend{const bucket=store.client.storage.from(ASSET_BUCKET);return {rpc:(name,params)=>store.client.rpc(name,params),async ready(userId,asset){const result=await store.client.from('runtime_assets').select('id,path,job_id,status').eq('user_id',userId).eq('id',asset.id).eq('path',asset.path).eq('status','ready').maybeSingle();if(result.error)throw new DomainError('ASSET_STORAGE','无法验证图片资产',503);return !!result.data&&(!asset.jobId||result.data.job_id===asset.jobId);},upload:(path,bytes)=>bucket.upload(path,bytes,{contentType:'application/octet-stream',upsert:false}),download:path=>bucket.download(path),remove:paths=>bucket.remove(paths)};}
function validId(value:string){return /^[a-zA-Z0-9_-]{1,128}$/.test(value);}
export function assertAssetOwner(asset:ImageAsset,userId:string){if(!validId(userId)||!validId(asset.id)||asset.jobId!==undefined&&!validId(asset.jobId)||asset.path!==`${userId}/${asset.id}.bin`)throw new DomainError('FORBIDDEN','图片资产不属于当前用户或任务',403);}
async function command(backend:AssetBackend,name:string,params:Record<string,unknown>){const result=await backend.rpc(name,params);if(result.error)throw new DomainError('ASSET_STORAGE','私有图片资产状态不可用',503);return result.data;}
/** Reservation ledger survives Auth deletion. Server generates a unique, never-overwritten path. */
export async function uploadImageAsset(backend:AssetBackend,userId:string,jobId:string,leaseToken:string,image:string,key:Buffer):Promise<ImageAsset>{
 const data=await command(backend,'reserve_runtime_asset',{p_user_id:userId,p_job_id:jobId,p_lease_token:leaseToken});
 if(!Array.isArray(data)||data.length!==1)throw new DomainError('ASSET_FENCE','账号删除中或任务租约已失效',409);
 const reservation=data[0] as {id:string;path:string;reservation_token:string};const asset={id:reservation.id,path:reservation.path,jobId};assertAssetOwner(asset,userId);
 try{const uploaded=await backend.upload(asset.path,Buffer.from(encrypt(image,key),'utf8'));if(uploaded.error)throw new DomainError('ASSET_STORAGE','图片上传失败',503);if(await command(backend,'finalize_runtime_asset',{p_user_id:userId,p_asset_id:asset.id,p_reservation_token:reservation.reservation_token})!==true)throw new DomainError('ASSET_FENCE','图片完成时账号或任务状态已变化',409);return asset;}
 catch(error){await removeImageAsset(backend,userId,asset);throw error;}
}
/** Ledger intentionally retained: deletion sweeper catches uncertain late uploads. */
export async function removeImageAsset(backend:AssetBackend,userId:string,asset:ImageAsset){assertAssetOwner(asset,userId);const removed=await backend.remove([asset.path]);if(removed.error)throw new DomainError('ASSET_CLEANUP','私有图片清理失败，请重试',503);}
export async function readImageAsset(backend:AssetBackend,userId:string,key:Buffer,asset:ImageAsset):Promise<string>{assertAssetOwner(asset,userId);if(!await backend.ready(userId,asset))throw new DomainError('FORBIDDEN','图片资产当前不可读取',403);const response=await backend.download(asset.path);if(response.error||!response.data)throw new DomainError('ASSET_STORAGE','无法读取私有图片',503);const ciphertext=Buffer.from(await response.data.arrayBuffer());if(ciphertext.length>20*1024*1024)throw new DomainError('ASSET_STORAGE','图片资产大小异常',503);return decrypt(ciphertext.toString('utf8'),key);}
/** Returned copy only. Persist the original reference, never this hydrated view. */
export async function resolveCandidateImage<T extends object>(store:SupabaseStore,userId:string,key:Buffer,candidate:T):Promise<T&{imageUrl?:string}>{const visible=candidate as T&{imageAsset?:ImageAsset;imageUrl?:string};if(!visible.imageAsset)return {...visible};return {...visible,imageUrl:await readImageAsset(assetBackend(store),userId,key,visible.imageAsset)};}
export async function sweepAssetCleanup(store:SupabaseStore){return sweepAssetCleanupWithBackend(assetBackend(store));}
export async function sweepAssetCleanupWithBackend(backend:AssetBackend):Promise<{removed:number;failed:number}>{const rows=await command(backend,'list_runtime_asset_cleanup',{p_limit:100});if(!Array.isArray(rows))throw new DomainError('ASSET_STORAGE','资产清理列表无效',503);let removed=0,failed=0;for(const row of rows as {path:string;user_id:string}[]){if(!validId(row.user_id)||!row.path.startsWith(`${row.user_id}/`)||row.path.includes('..')){failed++;continue;}const result=await backend.remove([row.path]);if(result.error){failed++;continue;}await command(backend,'record_runtime_asset_sweep',{p_path:row.path});removed++;}return {removed,failed};}
