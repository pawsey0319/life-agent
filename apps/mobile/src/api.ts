import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetch as streamingFetch } from 'expo/fetch';

export type Entity = { id: string; name?: string; content?: string; description?: string; imageUrl?: string; role?: string; createdAt?: string; subject?: string; category?: string; tier?: string; state?: string; reason?: string; source?: unknown; pinned?: boolean; domain?: string; persona?: string; status?: string; components?: string[]; component?: string; completed?: boolean; sourceBlockId?: string; granteeBlockId?: string; field?: string; purpose?: string; expiresAt?: string; title?: string; dueAt?: string; timeZone?: string; type?: string; ephemeral?: boolean; kind?: string; action?: string; at?: string; sessionId?: string; timeRange?: { from: string; to: string }; manifest?: AgentManifest; manifestVersion?: number; pendingManifest?: AgentManifest };
export type AgentManifest = { version: 1; conversation: { enabled: boolean }; capabilities: Array<'checkin' | 'records' | 'plans'>; data: { fields: Array<'schedule' | 'habit_completion' | 'records' | 'health'>; purposes: Array<'answer' | 'summary'> }; ui: { components: Array<'checkin' | 'records' | 'plans'> }; events: Array<'record.created' | 'schedule.due'> };
export type Bootstrap = { mode: string; pa: Entity | null; blocks: Entity[]; memories: Entity[]; pendingMemories: Entity[]; grantRequests: Entity[]; grants: Entity[]; audit: Entity[]; schedules: Entity[]; inbox: Entity[]; styles: Entity[]; events: Entity[]; memoryConflicts?: Entity[]; notificationState?: { timeZone: string; lastDigestDate?: string }; capabilities?: { text?: boolean; extract?: boolean; embed?: boolean; image?: boolean } };
const mode = process.env.EXPO_PUBLIC_MODE;
const rawUrl = process.env.EXPO_PUBLIC_API_URL;
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
export const config = { mode, apiUrl: rawUrl?.replace(/\/$/, ''), error: '' };
if (mode !== 'demo' && mode !== 'configured') config.error = '请设置 EXPO_PUBLIC_MODE=demo 或 configured；不会自动切换为演示模式。';
else if (!rawUrl) config.error = '缺少 EXPO_PUBLIC_API_URL。请配置 Runtime 地址后重新构建客户端。';
else {
  try { const url = new URL(rawUrl); if (!['http:', 'https:'].includes(url.protocol)) throw new Error(); if (mode === 'demo' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) config.error = '演示模式只允许连接 loopback Runtime。'; }
  catch { config.error = 'EXPO_PUBLIC_API_URL 必须是有效 HTTP(S) 地址。'; }
}
if (mode === 'configured' && (!supabaseUrl || !supabaseKey)) config.error = '配置模式缺少 EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY。不会使用演示身份。';
export const auth: SupabaseClient | null = mode === 'configured' && !config.error ? createClient(supabaseUrl!, supabaseKey!, { auth: { storage: AsyncStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } }) : null;
async function headers(): Promise<Record<string, string>> {
  if (config.error) throw new Error(config.error);
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (mode === 'configured') { const { data, error } = await auth!.auth.getSession(); if (error) throw error; if (!data.session) throw new Error('请先登录。'); h.Authorization = `Bearer ${data.session.access_token}`; }
  return h;
}
async function failure(response: Response) {
  let message = `请求失败（${response.status}）`;
  try { const body = await response.json() as { error?: { message?: string; code?: string } }; if (body.error?.message) message = `${body.error.message}${body.error.code ? ` · ${body.error.code}` : ''}`; } catch { /* non-JSON errors remain explicit */ }
  throw new Error(message);
}
export async function api<T = Record<string, unknown>>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`${config.apiUrl}/api${path}`, { method, headers: await headers(), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (!response.ok) await failure(response);
  if (response.status === 204) return {} as T;
  return await response.json() as T;
}
export async function sendChat(sessionId: string, content: string, onMessage: (message: Entity) => void, signal?: AbortSignal): Promise<void> {
  const response = await streamingFetch(`${config.apiUrl}/api/sessions/${encodeURIComponent(sessionId)}/messages`, { method: 'POST', headers: { ...await headers(), Accept: 'text/event-stream' }, body: JSON.stringify({ content }), signal });
  if (!response.ok) await failure(response as unknown as Response);
  if (!response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('Runtime 未返回 SSE；不能将普通响应伪装为模型输出。');
  const reader = response.body?.getReader(); if (!reader) throw new Error('此设备不支持流式响应，请使用支持流的浏览器或更新 Expo。');
  const decoder = new TextDecoder(); let buffer = ''; let doneEvent = false;
  try {
    while (true) { const result = await reader.read(); buffer += decoder.decode(result.value, { stream: !result.done }).replace(/\r\n/g, '\n'); let boundary: number;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) { const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2); const lines = frame.split('\n'); const event = lines.find(line => line.startsWith('event:'))?.slice(6).trim(); const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (event === 'message' && data) onMessage(JSON.parse(data) as Entity);
        if (event === 'error') { let message = '模型响应失败'; try { const parsed = JSON.parse(data); message = parsed.error?.message || parsed.message || message; } catch {} throw new Error(message); }
        if (event === 'done') doneEvent = true;
      }
      if (result.done) break;
    }
    if (!doneEvent) throw new Error('连接在完成前中断。请刷新会话检查已保存的消息，避免重复发送。');
  } finally { reader.releaseLock(); }
}
export const labelSource = (value: unknown): string => typeof value === 'string' ? value : JSON.stringify(value ?? '未提供来源');
export const endpoint = (id: string) => encodeURIComponent(id);
