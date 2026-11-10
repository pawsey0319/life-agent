import {test} from 'node:test';
import assert from 'node:assert/strict';
import {scoreMemoryEvaluation} from './score-memory-evaluation.mjs';
const expected={category:'general',user_signal:'none',is_trait:false,harm_if_forgotten:false,emotional_weight:'low',constrains_future:false,sensitive:true};
const label=id=>({id,annotator:'human-a',reviewer:'human-b',input:'must not appear in report',expected});
test('scorer rejects empty, duplicate, unattributed and unknown data',()=>{
 assert.throws(()=>scoreMemoryEvaluation([],[]));assert.throws(()=>scoreMemoryEvaluation([label('1'),label('1')],[]));assert.throws(()=>scoreMemoryEvaluation([{id:'1',expected}],[]));assert.throws(()=>scoreMemoryEvaluation([label('1')],[{id:'other',actual:expected}]));
});
test('missing predictions and sensitive false negatives count as failures without leaking input',()=>{
 const report=scoreMemoryEvaluation([label('1'),label('2')],[{id:'1',actual:{...expected,sensitive:false}}]);assert.equal(report.missingPredictions,1);assert.equal(report.missedSensitive,2);assert.equal(report.sensitiveRecall,0);assert.equal(report.thresholdsMet,false);assert.equal(report.accuracy.category,0.5);assert.equal(JSON.stringify(report).includes('must not appear'),false);
});
test('minimum300 and exact predictions required; scores do not attest real model provenance',()=>{
 const labels=Array.from({length:300},(_,i)=>label(String(i)));const report=scoreMemoryEvaluation(labels,labels.map(l=>({id:l.id,actual:expected})));const noSensitive=labels.map(l=>({...l,expected:{...expected,sensitive:false}}));assert.equal(scoreMemoryEvaluation(noSensitive,noSensitive.map(l=>({id:l.id,actual:l.expected}))).thresholdsMet,false);assert.equal(report.thresholdsMet,true);assert.equal(report.sampleRequirementMet,true);assert.ok(report.notEvaluated.includes('real model provenance'));assert.equal(scoreMemoryEvaluation([label('1')],[{id:'1',actual:expected}]).thresholdsMet,false);
});
