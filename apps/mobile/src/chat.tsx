import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { api, endpoint, sendChat, type Entity } from './api';
import { Button, Card, Empty, ErrorBox, Field, ui } from './ui';

export function Chat({ blockId, paused, onChanged }: { blockId: string; paused?: boolean; onChanged: () => Promise<void> }) {
  const [sessions, setSessions] = useState<Entity[]>([]); const [selected, setSelected] = useState(''); const [messages, setMessages] = useState<Entity[]>([]); const [draft, setDraft] = useState(''); const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const selectedRef = useRef(''); const skipHistory = useRef('');
  const mounted = useRef(true); const epoch = useRef(0); const request = useRef(0); const abort = useRef<AbortController | null>(null);
  const alive = (e: number, r: number) => mounted.current && epoch.current === e && request.current === r;
  const invalidate = () => { epoch.current += 1; request.current += 1; abort.current?.abort(); abort.current = null; };

  async function loadSessions(e = epoch.current) {
    const r = ++request.current; setLoading(true); setError('');
    try { const result = await api<{ sessions: Entity[] }>(`/sessions?blockId=${endpoint(blockId)}`); if (!alive(e, r)) return; setSessions(result.sessions); selectedRef.current = result.sessions[0]?.id ?? ''; setSelected(selectedRef.current); setMessages([]); }
    catch (err) { if (alive(e, r)) setError((err as Error).message); }
    finally { if (alive(e, r)) setLoading(false); }
  }
  useEffect(() => { mounted.current = true; invalidate(); selectedRef.current = ''; setSelected(''); setSessions([]); setMessages([]); setDraft(''); setBusy(false); const e = epoch.current; void loadSessions(e); return () => { mounted.current = false; invalidate(); }; }, [blockId]);
  async function history(id: string, e = epoch.current) {
    if (!id) return; const r = ++request.current; setLoading(true); setError('');
    try { const result = await api<{ messages: Entity[] }>(`/sessions/${endpoint(id)}/messages`); if (alive(e, r) && id === selectedRef.current) setMessages(result.messages); }
    catch (err) { if (alive(e, r)) setError((err as Error).message); }
    finally { if (alive(e, r)) setLoading(false); }
  }
  useEffect(() => { if (!selected) return; if (skipHistory.current === selected) { skipHistory.current = ''; return; } abort.current?.abort(); abort.current = null; const e = epoch.current; void history(selected, e); }, [selected]);
  async function create() { const e = epoch.current; const r = ++request.current; setBusy(true); setError(''); try { const result = await api<{ session: Entity }>('/sessions', 'POST', { blockId }); if (!alive(e, r)) return; setSessions(old => [result.session, ...old]); selectedRef.current = result.session.id; setSelected(result.session.id); setMessages([]); } catch (err) { if (alive(e, r)) setError((err as Error).message); } finally { if (alive(e, r)) setBusy(false); } }
  async function send() {
    if (!draft.trim() || paused || busy) return; const e = epoch.current; const r = ++request.current; setBusy(true); setError(''); let id = selected; const content = draft.trim(); const controller = new AbortController(); abort.current = controller;
    try { if (!id) { const result = await api<{ session: Entity }>('/sessions', 'POST', { blockId }); if (!alive(e, r)) return; id = result.session.id; selectedRef.current = id; skipHistory.current = id; setSessions(old => [result.session, ...old]); setSelected(id); setMessages([]); }
      await sendChat(id, content, message => { if (alive(e, r) && id === selectedRef.current) setMessages(old => [...old.filter(m => m.id !== message.id), message]); }, controller.signal); if (!alive(e, r)) return; setDraft('');
      const result = await api<{ messages: Entity[] }>(`/sessions/${endpoint(id)}/messages`); if (!alive(e, r) || id !== selectedRef.current) return; setMessages(old => [...result.messages, ...old.filter(m => m.ephemeral && !result.messages.some(saved => saved.id === m.id))]); await onChanged();
    } catch (err) { if (alive(e, r) && (err as Error).name !== 'AbortError') setError((err as Error).message); }
    finally { if (alive(e, r)) { setBusy(false); if (abort.current === controller) abort.current = null; } }
  }
  return <Card title={blockId === 'pa' ? '和 PA 说说话' : '专属会话'} note="聊天与长期记忆是两件事。原文派生的临时回复仅在本轮显示，不进入后续上下文。">
    {paused && <Text style={ui.tag}>此 Agent 已暂停，恢复后才能继续聊天</Text>}
    <View style={ui.row}><Button secondary disabled={busy || paused} onPress={() => void create()}>开启新会话</Button>{sessions.map((s, i) => <Button key={s.id} secondary={s.id !== selected} disabled={false} onPress={() => { if (s.id !== selected) { invalidate(); selectedRef.current = s.id; setSelected(s.id); setMessages([]); setDraft(''); setBusy(false); setLoading(true); } }}>{`会话 ${sessions.length - i}`}</Button>)}</View>
    {loading && <ActivityIndicator />}{error && <ErrorBox message={error} retry={() => void (selected ? history(selected) : loadSessions())} />}
    {!messages.length && !loading && <Empty text="今天过得怎么样？从一句想说的话开始。" />}
    {messages.map(m => <View key={m.id} style={{ padding: 16, borderRadius: 14, backgroundColor: m.role === 'user' ? '#E6EEE5' : '#F5F2E9', marginLeft: m.role === 'user' ? 22 : 0, marginRight: m.role === 'user' ? 0 : 22, gap: 5 }}><Text style={ui.muted}>{m.role === 'user' ? '我' : '伙伴'}{m.ephemeral ? ' · 临时内容，仅本轮' : ''}</Text><Text selectable style={ui.text}>{m.content}</Text></View>)}
    <Field label="消息" placeholder="把此刻想说的，留给伙伴…" multiline value={draft} onChangeText={setDraft} editable={!busy && !paused} />
    <Button disabled={!draft.trim() || paused || loading} busy={busy} onPress={() => void send()}>发送消息</Button>
  </Card>;
}
