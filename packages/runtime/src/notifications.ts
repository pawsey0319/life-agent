/** Host-authored achievement metadata only. Never copy record, message or event free text. */
export type AchievementType='checkin'|'record'|'plan'|'feed'|'play';
export type Achievement={type:AchievementType;date:string};
export type NotificationState={timeZone:string;lastDigestDate?:string};
export type AchievementState={
 blocks:{id:string;status:string;pendingManifest?:unknown}[];
 records:{id:string;blockId:string;component?:unknown;createdAt?:unknown}[];
 events:{id:string;type?:unknown;createdAt?:unknown}[];
 inbox:{id:string;[key:string]:unknown}[];
 notificationState?:NotificationState;
};
export const DEFAULT_NOTIFICATION_TIME_ZONE='Asia/Shanghai';
function clock(now:number,timeZone:string){if(!Number.isFinite(now))throw new RangeError('Invalid notification timestamp');const parts=new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(new Date(now));const part=(name:string)=>parts.find(p=>p.type===name)!.value;return {date:`${part('year')}-${part('month')}-${part('day')}`,hour:Number(part('hour'))};}
/** Invalid configuration is rejected, never silently evaluated in a different timezone. */
export function notificationTimeZone(state:Pick<AchievementState,'notificationState'>){const zone=state.notificationState?.timeZone??DEFAULT_NOTIFICATION_TIME_ZONE;clock(0,zone);return zone;}
/** Local calendar-day equality, rather than fixed 24-hour arithmetic, handles DST. */
export function collectAchievements(state:AchievementState,now=Date.now(),timeZone=notificationTimeZone(state)):Achievement[]{
 const today=clock(now,timeZone).date;
 const active=new Set(state.blocks.filter(b=>b.status==='active'&&!b.pendingManifest).map(b=>b.id));
 const output:Achievement[]=[];const seen=new Set<string>();
 const add=(namespace:string,id:string,type:AchievementType,at:unknown)=>{if(typeof at!=='string'||!id)return;const timestamp=Date.parse(at);if(!Number.isFinite(timestamp)||timestamp>now||clock(timestamp,timeZone).date!==today)return;const key=`${namespace}:${id}`;if(seen.has(key))return;seen.add(key);output.push({type,date:new Date(timestamp).toISOString()});};
 for(const record of state.records){if(!active.has(record.blockId))continue;const type=record.component==='checkin'?'checkin':record.component==='records'?'record':record.component==='plans'?'plan':undefined;if(type)add('record',record.id,type,record.createdAt);}
 for(const event of state.events){if(event.type==='feed'||event.type==='play')add('event',event.id,event.type,event.createdAt);}
 return output.sort((a,b)=>a.date.localeCompare(b.date)||a.type.localeCompare(b.type));
}
/**
 * At/after local 08:00, emits at most the current day's digest. The persistent
 * date receipt survives inbox deletion and also suppresses clock-back replay.
 * No OS push, provider call, user prose or historical catch-up is performed.
 * Host serializes and durably commits this state together with the inbox entry.
 */
export function tickNotifications(state:AchievementState,now=Date.now()):{created:boolean;date:string;achievements:Achievement[]}{
 const timeZone=notificationTimeZone(state);const local=clock(now,timeZone);
 if(local.hour<8||!!state.notificationState?.lastDigestDate&&state.notificationState.lastDigestDate>=local.date)return {created:false,date:local.date,achievements:[]};
 const achievements=collectAchievements(state,now,timeZone);
 // Mark even empty days as processed, avoiding repeated scans and late surprise digests.
 state.notificationState={timeZone,lastDigestDate:local.date};
 if(!achievements.length)return {created:false,date:local.date,achievements};
 const digestId=`pa-achievement:${local.date}`;
 if(state.inbox.some(item=>item.id===digestId))return {created:false,date:local.date,achievements};
 state.inbox.push({id:digestId,type:'achievement_digest',blockId:'pa',date:local.date,timeZone,title:'今日陪伴成就',achievements,createdAt:new Date(now).toISOString(),status:'unread'});
 return {created:true,date:local.date,achievements};
}
