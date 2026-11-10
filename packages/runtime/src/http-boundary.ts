import {createHash} from 'node:crypto';

/** Process-local backstop only; a trusted reverse proxy must enforce distributed quotas. */
export function httpBoundary(handler:(request:Request)=>Promise<Response>|Response,options:{maxBytes?:number;limit?:number;windowMs?:number;now?:()=>number}={}){
 const maxBytes=options.maxBytes??1024*1024,limit=options.limit??60,windowMs=options.windowMs??60000,now=options.now??Date.now;
 const buckets=new Map<string,{count:number;until:number}>();
 const reject=(status:number,code:string,message:string,headers:Record<string,string>={})=>Response.json({error:{code,message}},{status,headers});
 return async(request:Request):Promise<Response>=>{
  const at=now();for(const [key,bucket] of buckets)if(bucket.until<=at)buckets.delete(key);
  const credential=request.headers.get('authorization');
  const key=credential?createHash('sha256').update(credential).digest('hex'):'anonymous';
  const bucket=buckets.get(key)??{count:0,until:at+windowMs};
  if(bucket.count>=limit)return reject(429,'RATE_LIMIT','请求过于频繁，请稍后重试',{'Retry-After':String(Math.max(1,Math.ceil((bucket.until-at)/1000)))});
  if(!buckets.has(key)&&buckets.size>=10000)return reject(503,'BUSY','服务繁忙，请稍后重试');
  bucket.count++;buckets.set(key,bucket);
  const length=request.headers.get('content-length');
  if(length!==null&&(!/^\d+$/.test(length)||!Number.isSafeInteger(Number(length))))return reject(400,'INVALID_LENGTH','请求长度无效');
  if(length!==null&&Number(length)>maxBytes)return reject(413,'BODY_TOO_LARGE','请求正文超过1MiB限制');
  if(!request.body)return handler(request);
  // Read at most the configured bound before constructing the business request.
  const reader=request.body.getReader();const chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>maxBytes){void reader.cancel();return reject(413,'BODY_TOO_LARGE','请求正文超过1MiB限制');}chunks.push(chunk.value);}}
  catch{return reject(400,'INVALID_BODY','请求正文读取失败');}
  finally{reader.releaseLock();}
  if(length!==null&&Number(length)!==size)return reject(400,'INVALID_LENGTH','请求长度不匹配');
  const body=Buffer.concat(chunks);return handler(new Request(request.url,{method:request.method,headers:request.headers,body,signal:request.signal}));
 };
}
