import { randomUUID } from 'node:crypto';
import { z } from 'zod';
export type Tier = 'core'|'normal'|'trivial';
export type Memory = {id:string; userId:string; content:string; subject:string; category:string; tier:Tier; state:'active'|'faded'|'archived'|'historical'; reason:string; sensitive:boolean; createdAt:string; lastUsedAt:string; sessionIds:string[]; pinned:boolean; source?:string; embedding?:number[]; embeddingContent?:string; embeddingModelKey?:string};
export type RetrievalOptions={domain?:string;now?:number;queryVector?:number[]};
export function activation(lastUsedAt:string,now=Date.now()){const age=Math.max(0,now-Date.parse(lastUsedAt));return Number.isFinite(age)?Math.pow(0.5,age/(30*86400000)):0;}
export function cosine(a:number[],b:number[]){if(a.length!==b.length||!a.length)return 0;let dot=0,aa=0,bb=0;for(let i=0;i<a.length;i++){dot+=a[i]!*b[i]!;aa+=a[i]!*a[i]!;bb+=b[i]!*b[i]!;}return aa&&bb?Math.max(-1,Math.min(1,dot/Math.sqrt(aa*bb))):0;}
function keywordScore(query:string,text:string){const normalized=query.toLowerCase();const target=text.toLowerCase();const tokens=new Set(normalized.match(/[a-z0-9_]+|[\p{Script=Han}]/gu)??[]);return tokens.size?[...tokens].filter(t=>target.includes(t)).length/tokens.size:0;}
function topicMatches(memory:Memory,query:string,domain?:string){const terms:Record<string,string>={key_person:'家人|朋友|父母|母亲|父亲|伴侣|person|family|friend',life_event:'经历|毕业|结婚|搬家|生日|event|birthday|marriage',long_goal:'目标|计划|未来|goal|plan|career',pa_bond:'陪伴|关系|我们|宠物|bond|companion'};return !!domain&&(memory.category===domain||memory.subject.toLowerCase().includes(domain.toLowerCase()))||new RegExp(terms[memory.category]??'(?!)','i').test(query);}

export class DomainError extends Error { constructor(public code:string, message:string, public status=400){super(message);} }
export const id=()=>randomUUID();
export const iso=()=>new Date().toISOString();
export const coreCategories=new Set(['identity','health_safety','diet_baseline','boundary','key_person','life_event','long_goal','pa_bond','dietary_boundary','taboo','健康安全','饮食底线','个人禁忌','身份事实']);
export const alwaysLoadCategories=new Set(['identity','health_safety','diet_baseline','boundary','dietary_boundary','taboo','健康安全','饮食底线','个人禁忌','身份事实']);
export function isSensitive(content:string, flag=false){return flag || /健康|疾病|伤病|受伤|身高|体重|体脂|经期|月经|消费|花费|金额|身体照片|隐私|抑郁|过敏|怀孕|病史|health|weight|medical|period|salary|diagnos|injur|body.?fat/i.test(content);}
export const candidateSchema=z.object({content:z.string().trim().min(1).max(20000),subject:z.string().max(200).optional(),category:z.string().optional(),user_signal:z.enum(['remember','important','forget','dont_remember','none']).optional(),is_trait:z.boolean().optional(),harm_if_forgotten:z.boolean().optional(),emotional_weight:z.enum(['low','high']).optional(),constrains_future:z.boolean().optional(),event_date:z.string().optional(),sensitive:z.boolean().optional(),sessionId:z.string().optional(),source:z.string().optional(),confidence:z.number().min(0).max(1).optional(),emotionalWeight:z.boolean().optional(),longTerm:z.boolean().optional()}).strict();
export type Candidate=z.infer<typeof candidateSchema>;
export type Pending={id:string;content:string;reason:string;kind:'consent'|'conflict';candidate:Candidate;oldId?:string;createdAt:string};
export class MemoryBook {
 memories:Memory[]=[]; pending:Pending[]=[]; deleted=new Set<string>(); feedback:{id:string;memoryId:string;at:string;action:string}[]=[];
 constructor(readonly userId:string){}
 prunePending(now=Date.now()){const before=this.pending.length;this.pending=this.pending.filter(p=>{const created=Date.parse(p.createdAt);return Number.isFinite(created)&&created<=now&&now-created<=120000;});return before-this.pending.length;}
 remember(input:Candidate, consent=false):{decision:string;memory?:Memory;pending?:Pending}{
  this.prunePending();
  const c=candidateSchema.parse(input);
  if(c.user_signal==='forget'||c.user_signal==='dont_remember')return {decision:'DROP'};
  if(isSensitive(c.content,c.sensitive)&&!consent){const p:Pending={id:id(),content:c.content,reason:'敏感内容需要单独同意',kind:'consent',candidate:c,createdAt:iso()};this.pending.push(p);return {decision:'ASK_FIRST',pending:p};}
  const tier:Tier=c.user_signal==='remember'||c.user_signal==='important'||coreCategories.has(c.category??'')||c.emotionalWeight||c.harm_if_forgotten||c.emotional_weight==='high'||(c.confidence!==undefined&&c.confidence<0.7)?'core':c.longTerm===false||c.is_trait===false&&!c.constrains_future?'trivial':'normal';
  const subject=c.subject??c.content;
  const previous=this.memories.find(m=>m.subject===subject&&m.state==='active');
  if(previous?.content===c.content){if(c.sessionId&&!previous.sessionIds.includes(c.sessionId))previous.sessionIds.push(c.sessionId);return {decision:'EXISTING',memory:previous};}
  if(previous?.tier==='core'){const p:Pending={id:id(),content:c.content,reason:'核心记忆冲突，需本人确认',kind:'conflict',candidate:c,oldId:previous.id,createdAt:iso()};this.pending.push(p);return {decision:'CONFLICT',pending:p};}
  if(previous)previous.state='historical';
  const m:Memory={id:id(),userId:this.userId,content:c.content,subject,category:c.category??'general',tier,state:'active',reason:c.user_signal==='remember'||c.user_signal==='important'?'user':coreCategories.has(c.category??'')?'rule':tier==='core'?(c.emotionalWeight||c.harm_if_forgotten||c.emotional_weight==='high'?'model':'uncertain'):'trait',sensitive:isSensitive(c.content,c.sensitive),createdAt:iso(),lastUsedAt:iso(),sessionIds:c.sessionId?[c.sessionId]:[],pinned:false,...(c.source?{source:c.source}:{})};
  this.memories.push(m);return {decision:'STORED',memory:m};
 }
 decide(pendingId:string,allow:boolean){const p=this.pending.find(p=>p.id===pendingId);if(!p)throw new DomainError('NOT_FOUND','待确认项不存在',404);if(!Number.isFinite(Date.parse(p.createdAt))||Date.parse(p.createdAt)>Date.now()||Date.now()-Date.parse(p.createdAt)>120000){this.pending=this.pending.filter(x=>x.id!==p.id);throw new DomainError('EXPIRED','确认已过期',409);}this.pending=this.pending.filter(x=>x.id!==p.id);if(!allow)return {decision:'DROP'};if(p.oldId){const old=this.memories.find(m=>m.id===p.oldId);if(!old||this.deleted.has(p.oldId)||old.state!=='active'||this.memories.find(m=>m.subject===old.subject&&m.state==='active')?.id!==old.id)return {decision:'DROP'};old.state='historical';}return this.remember(p.candidate,true);}
 remove(memoryId:string){this.deleted.add(memoryId);this.memories=this.memories.filter(m=>m.id!==memoryId);this.pending=this.pending.filter(p=>p.oldId!==memoryId);this.feedback=this.feedback.filter(f=>f.memoryId!==memoryId);}
 retry(memoryId:string,c:Candidate){return this.deleted.has(memoryId)?{decision:'DROP'}:this.remember(c);}
 nightly(now=Date.now()){this.prunePending(now);for(const m of this.memories){if(m.tier==='core'||m.state==='historical'||m.pinned)continue;if(m.tier==='normal'&&new Set(m.sessionIds).size>=3){m.tier='core';m.reason='three_distinct_sessions';m.state='active';continue;}const days=(now-Date.parse(m.lastUsedAt))/86400000;const fade=m.tier==='normal'?90:10;const archive=m.tier==='normal'?270:40;if(days>=archive)m.state='archived';else if(days>=fade)m.state='faded';}}
 retrieve(query:string,options:RetrievalOptions={}){
  const now=options.now??Date.now();
  const eligible=this.memories.filter(m=>m.userId===this.userId&&!this.deleted.has(m.id)&&(m.state==='active'||m.state==='faded'));
  const rules=eligible.filter(m=>m.tier==='core'&&alwaysLoadCategories.has(m.category));
  const topicCore=eligible.filter(m=>{if(m.tier!=='core'||alwaysLoadCategories.has(m.category))return false;if(topicMatches(m,query,options.domain))return true;const lexical=keywordScore(query,`${m.subject} ${m.content}`);const semantic=options.queryVector&&m.embedding&&m.embeddingContent===m.content?cosine(options.queryVector,m.embedding):0;return lexical>=0.2||semantic>=0.65;});
  const memories=eligible.filter(m=>m.tier!=='core').map(m=>{
   const lexical=keywordScore(query,`${m.subject} ${m.content}`);
   const semantic=options.queryVector&&m.embedding&&m.embeddingContent===m.content?Math.max(0,cosine(options.queryVector,m.embedding)):0;
   const relevance=options.queryVector?0.65*semantic+0.35*lexical:lexical;
   return {m,score:relevance*(0.5+0.5*activation(m.lastUsedAt,now))*(m.state==='faded'?0.7:1),relevance};
  }).filter(x=>x.relevance>0).sort((a,b)=>b.score-a.score||a.m.id.localeCompare(b.m.id)).slice(0,8).map(({m,score})=>({...m,uncertain:m.state==='faded',score}));
  return {rules:rules.slice(0,20),topicCore,memories,overflow:rules.length>20,safeToAdvise:rules.length<=20};
 }
}
export { VersionedGateway as Gateway, defaultFieldRegistry, fieldRegistrySchema } from './authorization.js';
export type { VersionedBlockIdentity as BlockIdentity, AuthorizationInput as GrantInput, VersionedGrantRequest as GrantRequest, VersionedGrant as Grant, FieldRegistry } from './authorization.js';
export const fields=[{id:'schedule',sensitivity:'normal'},{id:'habit_completion',sensitivity:'normal'},{id:'records',sensitivity:'normal'},{id:'health',sensitivity:'sensitive'},{id:'raw_messages',sensitivity:'raw'},{id:'secrets',sensitivity:'forbidden'}] as const;
export const manifestSchema=z.object({version:z.literal(1),conversation:z.object({enabled:z.boolean()}).strict(),capabilities:z.array(z.enum(['checkin','records','plans'])),data:z.object({fields:z.array(z.enum(['schedule','habit_completion','records','health'])),purposes:z.array(z.enum(['answer','summary']))}).strict(),ui:z.object({components:z.array(z.enum(['checkin','records','plans']))}).strict(),events:z.array(z.enum(['record.created','schedule.due']))}).strict();
export function namespace<T extends {userId:string;blockId:string}>(rows:T[],userId:string,blockId:string){return rows.filter(r=>r.userId===userId&&r.blockId===blockId);}
export function handoff(content:string,blocks:{id:string;domain:string;status:string}[]){const domains=[['nutrition','热量|减脂|食谱|蛋白质|配餐|碳水|营养|饮食|nutrition'],['fitness','健身|运动|训练|增肌|深蹲|卧推|跑步|硬拉|fitness'],['styling','穿搭|搭配|穿什么|衬衫|裤子|鞋|衣橱|配色|outfit|styling'],['finance','理财|投资|股票|基金|预算|资产|债券|消费|支出|finance|financial'],['health','健康|医疗|伤病|药|痛|发烧|化验|体检|经期|health|medical']];for(const [domain,pattern] of domains){if(new RegExp(pattern!,'i').test(content)){const block=blocks.find(b=>b.status==='active'&&(b.domain.includes(domain!)||content.toLowerCase().includes(b.domain.toLowerCase())));return {professional:true,blockId:block?.id,domain};}}return {professional:false};}
