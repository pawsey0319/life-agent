import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { api, endpoint, sendChat, type Entity } from './api';
import { Button, Card, Empty, ErrorBox, Field, ui } from './ui';
export function Chat({ blockId, paused, onChanged }: { blockId: string; paused?: boolean; onChanged: () => Promise<void> }) {
  const [sessions, setSessions] = useState<Entity[]>([]); const [selected, setSelected] = useState(''); const [messages, setMessages] = useState<Entity[]>([]); const [draft, setDraft] = useState(''); const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const abort = useRef<AbortController | null>(null);
  async function loadSessions() { setLoading(true); setError(''); try { const r = await api<{ sessions: Entity[] }>(`/sessions?blockId=${endpoint(blockId)}`); setSessions(r.sessions); setSelected(r.sessions[0]?.id ?? ''); setMessages([]); } catch (e) { setError((e as Error).message); } finally { setLoading(false); } }
  useEffect(() => { void loadSessions(); return () => { abort.current?.abort(); }; }, [blockId]);
  async function history(id: string) { if (!id) return; setLoading(true); setError(''); try { const r = await api<{ messages: Entity[] }>(`/sessions/${endpoint(id)}/messages`); setMessages(r.messages); } catch (e) { setError((e as Error).message); } finally { setLoading(false); } }
  useEffect(() => { if (selected) void history(selected); }, [selected]);
  async function create() { setBusy(true); setError(''); try { const { session } = await api<{ session: Entity }>('/sessions', 'POST', { blockId }); setSessions(old => [session, ...old]); setSelected(session.id); setMessages([]); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  async function send() { if (!draft.trim() || paused) return; setBusy(true); setError(''); let id = selected; const content = draft.trim();
    try { if (!id) { const r = await api<{ session: Entity }>('/sessions', 'POST', { blockId }); id = r.session.id; setSessions(old => [r.session, ...old]); setSelected(id); }
      abort.current = new AbortController(); await sendChat(id, content, message => { setMessages(old => [...old.filter(m => m.id !== message.id), message]); }, abort.current.signal); setDraft('');
      // Persisted history is authoritative. Ephemeral derived replies stay visible only in this round.
      const r = await api<{ messages: Entity[] }>(`/sessions/${endpoint(id)}/messages`); setMessages(old => [...r.messages, ...old.filter(m => m.ephemeral && !r.messages.some(saved => saved.id === m.id))]); await onChanged();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); abort.current = null; }
  }
  return <Card title={blockId === 'pa' ? '和 PA 说说话' : '专属会话'} note="聊天与长期记忆是两件事。原文派生的临时回复仅在本轮显示，不进入后续上下文。">
    {paused && <Text style={ui.tag}>此 Agent 已暂停，恢复后才能继续聊天</Text>}
    <View style={ui.row}><Button secondary disabled={busy || paused} onPress={() => void create()}>开启新会话</Button>{sessions.map((s, i) => <Button key={s.id} secondary={s.id !== selected} disabled={busy} onPress={() => setSelected(s.id)}>{`会话 ${sessions.length - i}`}</Button>)}</View>
    {loading && <ActivityIndicator />}{error && <ErrorBox message={error} retry={() => void (selected ? history(selected) : loadSessions())} />}
    {!messages.length && !loading && <Empty text="今天过得怎么样？从一句想说的话开始。" />}
    {messages.map(m => <View key={m.id} style={{ padding: 16, borderRadius: 14, backgroundColor: m.role === 'user' ? '#E6EEE5' : '#F5F2E9', marginLeft: m.role === 'user' ? 22 : 0, marginRight: m.role === 'user' ? 0 : 22, gap: 5 }}><Text style={ui.muted}>{m.role === 'user' ? '我' : '伙伴'}{m.ephemeral ? ' · 临时内容，仅本轮' : ''}</Text><Text selectable style={ui.text}>{m.content}</Text></View>)}
    <Field label="消息" placeholder="把此刻想说的，留给伙伴…" multiline value={draft} onChangeText={setDraft} editable={!busy && !paused} />
    <Button disabled={!draft.trim() || paused || loading} busy={busy} onPress={() => void send()}>发送消息</Button>
  </Card>;
}
