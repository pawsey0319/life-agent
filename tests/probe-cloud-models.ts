/** Opt-in paid cloud smoke probe. Synthetic inputs only; never part of default tests/CI. */
import {createConfiguredModels} from '../packages/runtime/src/model-config.js';
import {hasModelPurpose} from '../packages/runtime/src/providers.js';
import {providerImageData} from '../packages/runtime/src/jobs.js';

async function main(){
 if(process.env.RUN_CLOUD_MODEL_PROBE!=='1'){
  console.log(JSON.stringify({status:'skipped',reason:'Set RUN_CLOUD_MODEL_PROBE=1 explicitly; may incur provider charges.'}));return;
 }
 const purposes=(process.env.PROBE_PURPOSES??'embed,image').split(',').map(s=>s.trim());
 if(!purposes.length||purposes.some(p=>!['embed','image'].includes(p)))throw new Error('Invalid PROBE_PURPOSES');
 const models=createConfiguredModels();
 // Validate all requested capabilities before incurring any cost.
 for(const purpose of purposes)if(!hasModelPurpose(models,purpose as 'embed'|'image'))throw new Error('Requested cloud model purpose is not configured');
 for(const purpose of purposes){
  const start=Date.now();
  if(purpose==='embed'){
   const vector=await models.embed('Synthetic test: a blue notebook on a wooden desk.');
   if(vector.length!==1024||!vector.every(Number.isFinite))throw new Error('Invalid embedding');
   console.log(JSON.stringify({purpose,status:'passed',dimensions:vector.length,finite:true,elapsedMs:Date.now()-start}));
  }else{
   const image=await providerImageData(await models.image('A friendly blue cat companion portrait, flat illustration, cream background, no text.'),models.imageAssetHosts);
   const match=/^data:image\/(png|jpeg|webp);base64,(.+)$/.exec(image);
   if(!match)throw new Error('Invalid image');
   console.log(JSON.stringify({purpose,status:'passed',format:match[1],bytes:Buffer.from(match[2]!,'base64').length,elapsedMs:Date.now()-start}));
  }
 }
}
main().catch(()=>{console.error(JSON.stringify({status:'failed',reason:'Cloud probe failed; inspect configuration/provider console privately. No input, key, URL or provider body was printed.'}));process.exitCode=1;});
