import {OpenAIModels,type ModelEndpoint,type ModelPurpose,type OpenAIModelConfiguration} from './providers.js';
export type ModelEnvironment=Record<string,string|undefined>;
const names={text:'TEXT',extract:'EXTRACT',embed:'EMBED',image:'IMAGE'} as const;
/** Configuration parsing has no network, server startup, model defaults or secret logging. */
export function readModelConfiguration(env:ModelEnvironment=process.env):OpenAIModelConfiguration{
 const need=(name:string,fallback?:string)=>{const value=env[name]?.trim()||fallback&&env[fallback]?.trim();if(!value)throw new Error(`Missing required configuration: ${name}${fallback?` (or ${fallback})`:''}`);return value;};
 const endpoints={} as Partial<Record<ModelPurpose,ModelEndpoint>>;const models={} as Partial<Record<ModelPurpose,string>>;const configured=new Set<ModelPurpose>();
 for(const purpose of ['text','extract'] as ModelPurpose[]){const prefix=names[purpose];const baseUrl=need(`${prefix}_BASE_URL`,'OPENAI_BASE_URL');let url:URL;try{url=new URL(baseUrl);}catch{throw new Error(`Invalid required configuration: ${prefix}_BASE_URL (or OPENAI_BASE_URL)`);}if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new Error(`Invalid required configuration: ${prefix}_BASE_URL (or OPENAI_BASE_URL)`);endpoints[purpose]={baseUrl:baseUrl.replace(/\/+$/,''),apiKey:need(`${prefix}_API_KEY`,'OPENAI_API_KEY')};models[purpose]=need(`${prefix}_MODEL`);configured.add(purpose);}
 for(const purpose of ['embed','image'] as ModelPurpose[]){const prefix=names[purpose];const present=[env[`${prefix}_BASE_URL`],env[`${prefix}_API_KEY`],env[`${prefix}_MODEL`]].some(v=>Boolean(v?.trim()));if(!present)continue;const model=env[`${prefix}_MODEL`]?.trim();if(!model)throw new Error(`Missing required configuration: ${prefix}_MODEL`);const baseUrl=need(`${prefix}_BASE_URL`,'OPENAI_BASE_URL');let url:URL;try{url=new URL(baseUrl);}catch{throw new Error(`Invalid required configuration: ${prefix}_BASE_URL (or OPENAI_BASE_URL)`);}if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new Error(`Invalid required configuration: ${prefix}_BASE_URL (or OPENAI_BASE_URL)`);endpoints[purpose]={baseUrl:baseUrl.replace(/\/+$/,''),apiKey:need(`${prefix}_API_KEY`,'OPENAI_API_KEY')};models[purpose]=model;configured.add(purpose);}
 const imageAssetHosts=new Set<string>();
 const rawAssetHosts=env.IMAGE_ASSET_HOSTS?.trim();
 if(rawAssetHosts){
  for(const entry of rawAssetHosts.split(',')){
   const host=entry.trim().toLowerCase();
   if(host.length>253||!host.split('.').every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)))throw new Error('Invalid configuration: IMAGE_ASSET_HOSTS');
   imageAssetHosts.add(host);
  }
 }else if(endpoints.image)imageAssetHosts.add(new URL(endpoints.image.baseUrl).hostname.toLowerCase());
 return {baseUrl:endpoints.text!.baseUrl,apiKey:endpoints.text!.apiKey,textModel:models.text!,extractModel:models.extract!,embedModel:models.embed,imageModel:models.image, endpoints,configuredPurposes:configured,imageAssetHosts};
}
export function createConfiguredModels(env:ModelEnvironment=process.env):OpenAIModels{return new OpenAIModels(readModelConfiguration(env));}
