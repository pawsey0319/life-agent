import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const fields=['category','user_signal','is_trait','harm_if_forgotten','emotional_weight','constrains_future','sensitive'];
export function scoreMemoryEvaluation(labels,predictions){
  if(!Array.isArray(labels)||!labels.length||!Array.isArray(predictions))throw Error('Nonempty human labels and prediction arrays required');
  const checked=(rows,name)=>{const map=new Map();for(const row of rows){if(typeof row.id!=='string'||!row.id||map.has(row.id))throw Error(`Invalid or duplicate ${name} id`);map.set(row.id,row);}return map;};
  const truth=checked(labels,'label'),pred=checked(predictions,'prediction');
  for(const row of labels){if(typeof row.annotator!=='string'||!row.annotator.trim()||typeof row.reviewer!=='string'||!row.reviewer.trim()||!row.expected||fields.some(f=>row.expected[f]===undefined))throw Error('Human attribution and all required expected fields required');const e=row.expected;if(!['identity','health_safety','diet_baseline','boundary','key_person','life_event','long_goal','pa_bond','general'].includes(e.category)||!['none','remember','important','dont_remember'].includes(e.user_signal)||!['low','high'].includes(e.emotional_weight)||['is_trait','harm_if_forgotten','constrains_future','sensitive'].some(f=>typeof e[f]!=='boolean'))throw Error('Invalid expected field values');}
  if([...pred.keys()].some(id=>!truth.has(id)))throw Error('Prediction has unknown label id');
  const correct=Object.fromEntries(fields.map(f=>[f,0]));let sensitive=0,missedSensitive=0;const failures=[];
  for(const [id,row]of truth){const actual=pred.get(id)?.actual;const mismatch=fields.filter(f=>!actual||actual[f]!==row.expected[f]);for(const f of fields)if(actual&&actual[f]===row.expected[f])correct[f]++;if(row.expected.sensitive===true){sensitive++;if(actual?.sensitive!==true)missedSensitive++;}if(mismatch.length)failures.push({id,fields:mismatch});}
  const accuracy=Object.fromEntries(fields.map(f=>[f,correct[f]/labels.length]));
  return {evidence:'offline comparison only; prediction provenance and human labels require review',sampleCount:labels.length,matchedPredictions:pred.size,missingPredictions:labels.length-pred.size,minimumSampleCount:300,sampleRequirementMet:labels.length>=300,accuracy,sensitiveCount:sensitive,missedSensitive,sensitiveRecall:sensitive?(sensitive-missedSensitive)/sensitive:null,thresholdsMet:labels.length>=300&&pred.size===labels.length&&Object.values(accuracy).every(v=>v>=0.9)&&missedSensitive===0,failures,notEvaluated:['event_date','confidence_band','core retention','real model provenance','safety context recall','handoff','human one-week usage']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{const [labelsPath,predictionPath,outputPath]=process.argv.slice(2);if(!labelsPath||!predictionPath)throw Error('Usage: node tests/score-memory-evaluation.mjs labels.json predictions.json [new-report.json]');const result=scoreMemoryEvaluation(JSON.parse(await readFile(labelsPath,'utf8')),JSON.parse(await readFile(predictionPath,'utf8')));const text=JSON.stringify(result,null,2)+'\n';if(outputPath)await writeFile(outputPath,text,{flag:'wx'});else process.stdout.write(text);if(!result.thresholdsMet)process.exitCode=1;}catch(error){console.error(error.message);process.exitCode=2;}
}
