import { create } from 'zustand';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../../supabase/client';
import { fetchIceServers } from '../../supabase/api';
import { useApp } from '../../app/store';

/**
 * Голосовой чат в группе, как в Telegram: до 6 человек, каждый соединён с каждым (mesh).
 * Участники — в таблице group_call_members; предложения, ответы и ICE — через realtime-канал
 * gcall:<id> (broadcast), в базу не пишутся.
 */
export interface GroupCallState {
  callId: string;
  chatId: string;
  muted: boolean;
  /** Кто сейчас говорит (по громкости). */
  speaking: string[];
  /** С кем установлено соединение. */
  connected: string[];
}

export const useGroupCall = create<{ call: GroupCallState | null }>(() => ({ call: null }));

type Signal = { from: string; to: string; sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };

let channel: RealtimeChannel | null = null;
let local: MediaStream | null = null;
let servers: RTCIceServer[] = [];
let pingTimer: number | undefined;
let levelTimer: number | undefined;
let audioCtx: AudioContext | null = null;
const peers = new Map<
  string,
  { pc: RTCPeerConnection; audio: HTMLAudioElement; queue: RTCIceCandidateInit[] }
>();
const analysers = new Map<string, AnalyserNode>();

function me(): string {
  return useApp.getState().userId ?? '';
}

function patch(p: Partial<GroupCallState>) {
  const call = useGroupCall.getState().call;
  if (call) useGroupCall.setState({ call: { ...call, ...p } });
}

function watchLevel(uid: string, stream: MediaStream) {
  try {
    audioCtx ??= new AudioContext();
    const a = audioCtx.createAnalyser();
    a.fftSize = 256;
    audioCtx.createMediaStreamSource(stream).connect(a);
    analysers.set(uid, a);
  } catch {
    // без индикатора речи
  }
}

function send(event: string, payload: object) {
  void channel?.send({ type: 'broadcast', event, payload });
}

function peerFor(uid: string): RTCPeerConnection {
  const existing = peers.get(uid);
  if (existing) return existing.pc;
  const pc = new RTCPeerConnection({ iceServers: servers });
  const audio = new Audio();
  audio.autoplay = true;
  const entry = { pc, audio, queue: [] as RTCIceCandidateInit[] };
  peers.set(uid, entry);
  local?.getTracks().forEach((t) => pc.addTrack(t, local!));
  pc.onicecandidate = (e) =>
    e.candidate && send('signal', { from: me(), to: uid, candidate: e.candidate.toJSON() });
  pc.ontrack = (e) => {
    audio.srcObject = e.streams[0];
    void audio.play().catch(() => undefined);
    watchLevel(uid, e.streams[0]);
  };
  pc.onconnectionstatechange = () => {
    const connected = [...peers.entries()]
      .filter(([, p]) => p.pc.connectionState === 'connected')
      .map(([u]) => u);
    patch({ connected });
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') drop(uid);
  };
  return pc;
}

function drop(uid: string) {
  const p = peers.get(uid);
  if (!p) return;
  p.pc.close();
  p.audio.srcObject = null;
  peers.delete(uid);
  analysers.delete(uid);
  patch({ connected: [...peers.keys()].filter((u) => peers.get(u)?.pc.connectionState === 'connected') });
}

async function onSignal(s: Signal) {
  if (s.to !== me()) return;
  const pc = peerFor(s.from);
  const entry = peers.get(s.from)!;
  if (s.sdp) {
    await pc.setRemoteDescription(s.sdp);
    for (const c of entry.queue.splice(0)) await pc.addIceCandidate(c).catch(() => undefined);
    if (s.sdp.type === 'offer') {
      await pc.setLocalDescription(await pc.createAnswer());
      send('signal', { from: me(), to: s.from, sdp: pc.localDescription!.toJSON() });
    }
  } else if (s.candidate) {
    if (pc.remoteDescription) await pc.addIceCandidate(s.candidate).catch(() => undefined);
    else entry.queue.push(s.candidate);
  }
}

/**
 * Кто-то сказал «привет». Предложение делает тот, у кого id меньше: если это не я —
 * отвечаю адресным «привет», и предложение сделает он (без встречных предложений).
 */
async function onHello(from: string, to?: string) {
  if (from === me() || (to && to !== me())) return;
  if (me() > from) {
    send('hello', { from: me(), to: from });
    return;
  }
  drop(from);
  const pc = peerFor(from);
  await pc.setLocalDescription(await pc.createOffer());
  send('signal', { from: me(), to: from, sdp: pc.localDescription!.toJSON() });
}

export async function joinGroupCall(chatId: string): Promise<void> {
  if (useGroupCall.getState().call) await leaveGroupCall();
  local = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const { data, error } = await supabase.rpc('join_group_call', { p_chat: chatId });
  if (error) {
    local.getTracks().forEach((t) => t.stop());
    local = null;
    throw error;
  }
  const callId = String(data);
  servers = await fetchIceServers();
  watchLevel(me(), local);
  useGroupCall.setState({ call: { callId, chatId, muted: false, speaking: [], connected: [] } });

  channel = supabase.channel(`gcall:${callId}`, { config: { broadcast: { self: false } } });
  channel
    .on('broadcast', { event: 'hello' }, ({ payload }) => {
      const p = payload as { from: string; to?: string };
      void onHello(String(p.from), p.to);
    })
    .on('broadcast', { event: 'signal' }, ({ payload }) => void onSignal(payload as Signal))
    .on('broadcast', { event: 'bye' }, ({ payload }) => drop(String((payload as { from: string }).from)))
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') send('hello', { from: me() });
    });

  pingTimer = window.setInterval(() => void supabase.rpc('ping_group_call', { p_call: callId }), 20_000);
  levelTimer = window.setInterval(() => {
    const speaking: string[] = [];
    const buf = new Uint8Array(128);
    for (const [uid, a] of analysers) {
      a.getByteTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += ((v - 128) / 128) ** 2;
      if (Math.sqrt(sum / buf.length) > 0.04) speaking.push(uid);
    }
    const cur = useGroupCall.getState().call;
    if (cur && cur.speaking.join() !== speaking.join()) patch({ speaking });
  }, 250);
}

export async function leaveGroupCall(): Promise<void> {
  const call = useGroupCall.getState().call;
  window.clearInterval(pingTimer);
  window.clearInterval(levelTimer);
  send('bye', { from: me() });
  for (const uid of [...peers.keys()]) drop(uid);
  analysers.clear();
  local?.getTracks().forEach((t) => t.stop());
  local = null;
  if (channel) void supabase.removeChannel(channel);
  channel = null;
  void audioCtx?.close().catch(() => undefined);
  audioCtx = null;
  useGroupCall.setState({ call: null });
  if (call) await supabase.rpc('leave_group_call', { p_call: call.callId });
}

export function toggleGroupMute() {
  const call = useGroupCall.getState().call;
  if (!call || !local) return;
  const muted = !call.muted;
  local.getAudioTracks().forEach((t) => (t.enabled = !muted));
  patch({ muted });
  void supabase.rpc('set_group_call_muted', { p_call: call.callId, p_muted: muted });
}

// Закрыли вкладку — выйти из звонка.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    if (useGroupCall.getState().call) void leaveGroupCall();
  });
}
