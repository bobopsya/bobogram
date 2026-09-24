import { create } from 'zustand';
import {
  addCandidate,
  createCall,
  fetchCall,
  fetchCandidates,
  toCall,
  updateCall,
} from '../../supabase/api';
import type { CallRow } from '../../supabase/types';
import { onDbEvent } from '../../supabase/realtime';
import { queueMessage } from '../../app/outbox';
import { useApp } from '../../app/store';
import i18n from '../../i18n';

export type CallPhase = 'incoming' | 'calling' | 'connecting' | 'active' | 'ended';
export type EndReason = 'ended' | 'declined' | 'noAnswer' | 'failed' | 'permissionDenied' | 'busy';

export interface CallState {
  id: string | null;
  chatId: string;
  peerUid: string;
  video: boolean;
  outgoing: boolean;
  phase: CallPhase;
  startedAt: number | null;
  endReason: EndReason | null;
  micOn: boolean;
  camOn: boolean;
  local: MediaStream | null;
  remote: MediaStream | null;
}

export const useCall = create<{ call: CallState | null }>(() => ({ call: null }));

const RING_TIMEOUT = 45_000;
/** Публичные STUN-серверы. TURN можно добавить позже (см. docs/SETUP.md). */
const ICE_SERVERS: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];

// Объекты WebRTC живут вне React-состояния.
let pc: RTCPeerConnection | null = null;
let unsubs: (() => void)[] = [];
let ringTimer: number | undefined;
let disconnectTimer: number | undefined;
let facing: 'user' | 'environment' = 'user';
const seenCandidates = new Set<string>();

function patch(p: Partial<CallState>) {
  const call = useCall.getState().call;
  if (call) useCall.setState({ call: { ...call, ...p } });
}

function me(): string {
  return useApp.getState().userId ?? '';
}

async function getMedia(video: boolean): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
    video: video ? { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } } : false,
  });
}

function cleanup() {
  window.clearTimeout(ringTimer);
  window.clearTimeout(disconnectTimer);
  unsubs.forEach((u) => u());
  unsubs = [];
  seenCandidates.clear();
  useCall.getState().call?.local?.getTracks().forEach((t) => t.stop());
  pc?.close();
  pc = null;
}

/** Завершение звонка. Звонивший пишет запись о звонке в чат. */
async function finish(reason: EndReason, remoteStatus?: CallRow['status']) {
  const call = useCall.getState().call;
  if (!call || call.phase === 'ended') return;
  const duration = call.startedAt ? Math.round((Date.now() - call.startedAt) / 1000) : 0;
  cleanup();
  useCall.setState({ call: { ...call, phase: 'ended', endReason: reason, local: null, remote: null } });
  window.setTimeout(() => {
    if (useCall.getState().call?.phase === 'ended') useCall.setState({ call: null });
  }, 1800);

  if (call.id && remoteStatus) {
    await updateCall(call.id, { status: remoteStatus, ended_at: new Date().toISOString() }).catch(() => undefined);
  }
  if (call.outgoing && call.id && reason !== 'permissionDenied') {
    queueMessage({ id: crypto.randomUUID(), chatId: call.chatId, text: '', call: { video: call.video, duration } }, me());
  }
}

function createPeer(callId: () => string | null, fromCaller: boolean): RTCPeerConnection {
  const peer = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  const remote = new MediaStream();
  patch({ remote });
  const queued: RTCIceCandidateInit[] = [];

  peer.ontrack = (e) => {
    const tracks = e.streams[0]?.getTracks() ?? [e.track];
    tracks.forEach((t) => !remote.getTracks().includes(t) && remote.addTrack(t));
    patch({ remote: new MediaStream(remote.getTracks()) });
  };
  peer.onicecandidate = (e) => {
    if (!e.candidate) return;
    const id = callId();
    // Пока строка звонка не создана, кандидаты копим.
    if (id) void addCandidate(id, fromCaller, e.candidate.toJSON());
    else queued.push(e.candidate.toJSON());
  };
  (peer as RTCPeerConnection & { flushQueued?: () => void }).flushQueued = () => {
    const id = callId();
    if (id) queued.splice(0).forEach((c) => void addCandidate(id, fromCaller, c));
  };
  peer.onconnectionstatechange = () => {
    const state = peer.connectionState;
    window.clearTimeout(disconnectTimer);
    if (state === 'connected') {
      const call = useCall.getState().call;
      if (call && call.phase !== 'active') patch({ phase: 'active', startedAt: Date.now() });
    } else if (state === 'failed') {
      void finish('failed', 'ended');
    } else if (state === 'disconnected') {
      disconnectTimer = window.setTimeout(() => void finish('failed', 'ended'), 10_000);
    }
  };
  return peer;
}

/** ICE-кандидаты собеседника: из базы (уже пришедшие) и через realtime (новые). */
function listenCandidates(callId: string, fromCaller: boolean) {
  const add = (c: RTCIceCandidateInit) => {
    const key = JSON.stringify(c);
    if (seenCandidates.has(key) || !pc?.remoteDescription) return;
    seenCandidates.add(key);
    void pc.addIceCandidate(c).catch(() => undefined);
  };
  unsubs.push(
    onDbEvent((e) => {
      if (e.table === 'call_candidates' && e.row.call_id === callId && e.row.from_caller === fromCaller) {
        add(e.row.candidate as RTCIceCandidateInit);
      }
    }),
  );
  const sync = () => void fetchCandidates(callId, fromCaller).then((list) => list.forEach(add));
  sync();
  // Подстраховка: realtime мог прийти раньше remoteDescription.
  const timer = window.setInterval(sync, 2000);
  unsubs.push(() => window.clearInterval(timer));
}

// ---------- исходящий звонок ----------
export async function startCall(chatId: string, peerUid: string, video: boolean) {
  if (useCall.getState().call) return;
  useCall.setState({
    call: {
      id: null,
      chatId,
      peerUid,
      video,
      outgoing: true,
      phase: 'calling',
      startedAt: null,
      endReason: null,
      micOn: true,
      camOn: video,
      local: null,
      remote: null,
    },
  });

  let local: MediaStream;
  try {
    local = await getMedia(video);
  } catch {
    await finish('permissionDenied');
    return;
  }
  patch({ local });

  try {
    let callId: string | null = null;
    const peer = createPeer(() => callId, true);
    pc = peer;
    local.getTracks().forEach((t) => peer.addTrack(t, local));
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    callId = await createCall({ chatId, calleeId: peerUid, video, offer: { type: offer.type, sdp: offer.sdp } });
    if (useCall.getState().call?.phase !== 'calling') {
      await updateCall(callId, { status: 'missed' }).catch(() => undefined);
      return;
    }
    patch({ id: callId });
    (peer as RTCPeerConnection & { flushQueued?: () => void }).flushQueued?.();

    const id = callId;
    const onRow = async (row: CallRow) => {
      if (!pc) return;
      if (row.answer && !pc.currentRemoteDescription) {
        window.clearTimeout(ringTimer);
        patch({ phase: 'connecting' });
        await pc.setRemoteDescription(row.answer);
        listenCandidates(id, false);
      }
      if (row.status === 'declined') void finish('declined');
      else if (row.status === 'ended') void finish('ended');
    };
    unsubs.push(onDbEvent((e) => e.table === 'calls' && e.row.id === id && void onRow(toCall(e.row))));
    // На случай, если ответ пришёл раньше подписки.
    const poll = window.setInterval(() => void fetchCall(id).then((r) => r && onRow(r)), 3000);
    unsubs.push(() => window.clearInterval(poll));
    ringTimer = window.setTimeout(() => void finish('noAnswer', 'missed'), RING_TIMEOUT);
  } catch {
    await finish('failed', 'ended');
  }
}

// ---------- входящий звонок ----------
export function showIncoming(row: CallRow) {
  const current = useCall.getState().call;
  if (current) {
    if (current.id !== row.id) void updateCall(row.id, { status: 'declined' }).catch(() => undefined);
    return;
  }
  useCall.setState({
    call: {
      id: row.id,
      chatId: row.chatId,
      peerUid: row.callerId,
      video: row.video,
      outgoing: false,
      phase: 'incoming',
      startedAt: null,
      endReason: null,
      micOn: true,
      camOn: row.video,
      local: null,
      remote: null,
    },
  });
  // Звонивший передумал — убираем входящий.
  unsubs.push(
    onDbEvent((e) => {
      if (e.table !== 'calls' || e.row.id !== row.id) return;
      const status = e.row.status;
      if (status !== 'ringing' && status !== 'accepted') void finish('ended');
    }),
  );
  ringTimer = window.setTimeout(() => void finish('noAnswer'), RING_TIMEOUT);
}

export async function acceptCall() {
  const call = useCall.getState().call;
  if (!call?.id || call.phase !== 'incoming') return;
  const callId = call.id;
  window.clearTimeout(ringTimer);
  patch({ phase: 'connecting' });

  let local: MediaStream;
  try {
    local = await getMedia(call.video);
  } catch {
    await finish('permissionDenied', 'declined');
    return;
  }
  patch({ local });

  try {
    const row = await fetchCall(callId);
    if (!row?.offer || row.status !== 'ringing') {
      await finish('ended');
      return;
    }
    const peer = createPeer(() => callId, false);
    pc = peer;
    local.getTracks().forEach((t) => peer.addTrack(t, local));
    await peer.setRemoteDescription(row.offer);
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    await updateCall(callId, {
      answer: { type: answer.type, sdp: answer.sdp },
      status: 'accepted',
      answered_at: new Date().toISOString(),
    });
    listenCandidates(callId, true);
  } catch {
    await finish('failed', 'ended');
  }
}

export function declineCall() {
  void finish('declined', 'declined');
}

export function hangUp() {
  const call = useCall.getState().call;
  if (!call) return;
  if (call.phase === 'calling') void finish('ended', 'missed');
  else if (call.phase === 'incoming') void finish('declined', 'declined');
  else void finish('ended', 'ended');
}

export function toggleMic() {
  const call = useCall.getState().call;
  if (!call?.local) return;
  const on = !call.micOn;
  call.local.getAudioTracks().forEach((t) => (t.enabled = on));
  patch({ micOn: on });
}

export function toggleCam() {
  const call = useCall.getState().call;
  if (!call?.local) return;
  const on = !call.camOn;
  call.local.getVideoTracks().forEach((t) => (t.enabled = on));
  patch({ camOn: on });
}

export async function switchCamera() {
  const call = useCall.getState().call;
  if (!call?.local || !pc) return;
  facing = facing === 'user' ? 'environment' : 'user';
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing } });
    const track = stream.getVideoTracks()[0];
    const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
    await sender?.replaceTrack(track);
    call.local.getVideoTracks().forEach((t) => {
      t.stop();
      call.local!.removeTrack(t);
    });
    call.local.addTrack(track);
    patch({ local: new MediaStream(call.local.getTracks()) });
  } catch {
    useApp.getState().showToast(i18n.t('calls.failed'));
  }
}

// Закрыли вкладку во время звонка — сообщаем собеседнику.
window.addEventListener('pagehide', () => {
  const call = useCall.getState().call;
  if (call && call.phase !== 'ended') hangUp();
});
