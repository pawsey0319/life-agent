import {OpenAIModels,type ModelEndpoint,type ModelPurpose,type OpenAIModelConfiguration} from './providers.js';
export type ModelEnvironment=Record<string,string|undefined>;
const names={text:'TEXT',extract:'EXTRACT',embed:'EMBED',image:'IMAGE'} as const;
/** Configuration parsing has no network, server startup, model defaults or secret logging. */
export function readModelConfiguration(env:ModelEnvironment=process.env):OpenAIModelConfiguration{
 const need=(name:string,fallback?:string)=>{const value=env[name]?.trim()||fallback&&env[fallback]?.trim();if(!value)throw new Error(`Missing required configuration: ${name}${fallback?` (or ${fallback})`:''}`);return value;};
 const endpoints={} as Record<ModelPurpose,ModelEndpoint>;
 for(const purpose of Object.keys(names) as ModelPurpose[]){const prefix=names[purpose];const baseUrl=need(`${prefix}_BASE_URL`,'OPENAI_BASE_URL');let url:URL;try{url=new URL(baseUrl);}catch{throw new Error(`Invalid required configuration: ${prefix}_BASE_URL (or OPENAI_BASE_URL)`);}if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new Error(`Invalid required configuration: ${prefix}_BASE_URL (or OPENAI_BASE_URL)`);endpoints[purpose]={baseUrl:baseUrl.replace(/\/+$/,''),apiKey:need(`${prefix}_API_KEY`,'OPENAI_API_KEY')};}
 return {baseUrl:endpoints.text.baseUrl,apiKey:endpoints.text.apiKey,textModel:need('TEXT_MODEL'),extractModel:need('EXTRACT_MODEL'),embedModel:need('EMBED_MODEL'),imageModel:need('IMAGE_MODEL'),endpoints};
}
export function createConfiguredModels(env:ModelEnvironment=process.env):OpenAIModels{return new OpenAIModels(readModelConfiguration(env));}
