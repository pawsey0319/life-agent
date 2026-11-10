import {readFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {pathToFileURL} from 'node:url';
/** Offline only: never prints values, sends requests, or mutates the deployment. */
export function deploymentPreflight(env){
 const issues=[];const optionalIssues=[];const missingOptionalCapabilities=[];const checks=[];const check=(name,ok,optional=false)=>{checks.push({name,ready:!!ok,optional});if(!ok)(optional?optionalIssues:issues).push(name);};
 const endpoint=value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash;}catch{return false;}};
 check('RUNTIME_MODE',env.RUNTIME_MODE==='configured');check('SUPABASE_URL',endpoint(env.SUPABASE_URL));
 const secret=value=>typeof value==='string'&&value.trim().length>0&&!/replace|your[-_ ]|placeholder/i.test(value);check('SUPABASE_SERVICE_ROLE_KEY',secret(env.SUPABASE_SERVICE_ROLE_KEY));
 const master=env.DATA_MASTER_KEY??'';check('DATA_MASTER_KEY',/^[A-Za-z0-9+/]{43}=$/.test(master)&&Buffer.from(master,'base64').length===32);
 for(const purpose of ['TEXT','EXTRACT']){check(`${purpose}_BASE_URL`,endpoint(env[`${purpose}_BASE_URL`]||env.OPENAI_BASE_URL));check(`${purpose}_API_KEY`,secret(env[`${purpose}_API_KEY`]||env.OPENAI_API_KEY));check(`${purpose}_MODEL`,secret(env[`${purpose}_MODEL`]));}
 for(const purpose of ['EMBED','IMAGE']){const present=[env[`${purpose}_BASE_URL`],env[`${purpose}_API_KEY`],env[`${purpose}_MODEL`]].some(v=>Boolean(v?.trim()));if(!present){checks.push({name:`${purpose}_MODEL`,ready:false,optional:true,configured:false});missingOptionalCapabilities.push(purpose.toLowerCase());continue;}check(`${purpose}_BASE_URL`,endpoint(env[`${purpose}_BASE_URL`]||env.OPENAI_BASE_URL),true);check(`${purpose}_API_KEY`,secret(env[`${purpose}_API_KEY`]||env.OPENAI_API_KEY),true);check(`${purpose}_MODEL`,secret(env[`${purpose}_MODEL`]),true);}
 check('ALLOWED_ORIGINS',!!env.ALLOWED_ORIGINS&&env.ALLOWED_ORIGINS.split(',').every(value=>{try{const u=new URL(value.trim());return ['http:','https:'].includes(u.protocol)&&u.origin===value.trim();}catch{return false;}}));
 return {kind:'offline configuration check only',ready:issues.length===0&&optionalIssues.length===0,coreReady:issues.length===0,missingOptionalCapabilities,optionalConfigurationErrors:optionalIssues,checks,notVerified:['credential validity','database migrations and permissions','provider compatibility and billing','Android device']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{const file=process.argv[2]??'packages/runtime/.env.local';const values=parseEnv(await readFile(file,'utf8'));const report=deploymentPreflight({...process.env,...values});console.log(JSON.stringify(report,null,2));if(!report.ready)process.exitCode=1;}catch{console.error('Cannot inspect local configuration file; no values were printed.');process.exitCode=2;}}
