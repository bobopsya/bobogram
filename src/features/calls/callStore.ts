import { create } from 'zustand';
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '../../firebase/init';
import { auth } from '../../firebase/init';
import { fetchIceServers, notifyCall } from '../../firebase/messaging';
import { sendMessage } from '../../firebase/db';
import type { CallDoc } from '../../firebase/types';
import { useApp } from '../../app/store';
import i18n from '../../i18n';

export type CallPhase = 'incoming' | 'calling' | 'connecting' | 'active' | 'ended';
export type EndReason = 'ended' | 'declined' | 'noAnswer' | 'failed' | 'permissionDenied' | 'busy';

export interface CallState {
  id: string;
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
const callRef = (id: string) => doc(db, 'calls', id);

// Объекты WebRTC живут вне React-состояния.
let pc: RTCPeerConnection | null = null;
let unsubs: Unsubscribe[] = [];
let ringTimer: number | undefined;
let disconnectTimer: number | undefined;
let facing: 'user' | 'environment' = 'user';

function patch(p: Partial<CallState>) {
  const call = useCall.getState().call;
  if (call) useCall.setState({ call: { ...call, ...p } });
}

function me(): string {
  return auth.currentUser?.uid ?? '';
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
  const call = useCall.getState().call;
  call?.local?.getTracks().forEach((t) => t.stop());
  pc?.close();
  pc = null;
}

/** Завершение звонка. Звонивший пишет запись о звонке в чат. */
async function finish(reason: EndReason, remoteStatus?: CallDoc['status']) {
  const call = useCall.getState().call;
  if (!call || call.phase === 'ended') return;
  const duration = call.startedAt ? Math.round((Date.now() - call.startedAt) / 1000) : 0;
  cleanup();
  useCall.setState({ call: { ...call, phase: 'ended', endReason: reason, local: null, remote: null } });
  window.setTimeout(() => {
    if (useCall.getState().call?.id === call.id) useCall.setState({ call: null });
  }, 1800);

  if (remoteStatus) {
    await updateDoc(callRef(call.id), { status: remoteStatus, endedAt: serverTimestamp() }).catch(() => undefined);
  }
  if (call.outgoing && reason !== 'permissionDenied') {
    const { done } = sendMessage(call.chatId, me(), { text: '', call: { video: call.video, duration } });
    await done.catch(() => undefined);
  }
}

async function createPeer(callId: string, side: 'callerCandidates' | 'calleeCandidates'): Promise<RTCPeerConnection> {
  const iceServers = await fetchIceServers();
  const peer = new RTCPeerConnection({ iceServers });
  const remote = new MediaStream();
  patch({ remote });

  peer.ontrack = (e) => {
    e.streams[0]?.getTracks().forEach((t) => {
      if (!remote.getTracks().includes(t)) remote.addTrack(t);
    });
    if (!e.streams[0] && !remote.getTracks().includes(e.track)) remote.addTrack(e.track);
    patch({ remote });
  };
  peer.onicecandidate = (e) => {
    if (e.candidate) void addDoc(collection(db, 'calls', callId, side), e.candidate.toJSON()).catch(() => undefined);
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

/** Слушает ICE-кандидатов собеседника; до установки remoteDescription копит их. */
function listenCandidates(callId: string, side: 'callerCandidates' | 'calleeCandidates') {
  const queue: RTCIceCandidateInit[] = [];
  const flush = () => {
    if (!pc?.remoteDescription) return;
    while (queue.length) void pc.addIceCandidate(queue.shift()!).catch(() => undefined);
  };
  unsubs.push(
    onSnapshot(collection(db, 'calls', callId, side), (snap) => {
      snap.docChanges().forEach((ch) => ch.type === 'added' && queue.push(ch.doc.data() as RTCIceCandidateInit));
      flush();
    }),
  );
  return flush;
}

// ---------- исходящий звонок ----------
export async function startCall(chatId: string, peerUid: string, video: boolean) {
  if (useCall.getState().call) return;
  const callDoc = doc(collection(db, 'calls'));
  useCall.setState({
    call: {
      id: callDoc.id,
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
    // Документ звонка создаём до ICE-кандидатов: правила проверяют их по нему.
    const peer = await createPeer(callDoc.id, 'callerCandidates');
    local.getTracks().forEach((t) => peer.addTrack(t, local));
    const offer = await peer.createOffer();
    await setDoc(callDoc, {
      callerId: me(),
      calleeId: peerUid,
      chatId,
      video,
      status: 'ringing',
      offer: { type: offer.type, sdp: offer.sdp },
      answer: null,
      createdAt: serverTimestamp(),
      answeredAt: null,
      endedAt: null,
    });
    if (useCall.getState().call?.id !== callDoc.id) {
      peer.close();
      return;
    }
    pc = peer;
    await peer.setLocalDescription(offer);
    void notifyCall(callDoc.id);

    const flush = listenCandidates(callDoc.id, 'calleeCandidates');
    unsubs.push(
      onSnapshot(callDoc, async (snap) => {
        const data = snap.data() as Omit<CallDoc, 'id'> | undefined;
        if (!data || !pc) return;
        if (data.answer && !pc.currentRemoteDescription) {
          window.clearTimeout(ringTimer);
          patch({ phase: 'connecting' });
          await pc.setRemoteDescription(data.answer as RTCSessionDescriptionInit);
          flush();
        }
        if (data.status === 'declined') void finish('declined');
        else if (data.status === 'ended') void finish('ended');
      }),
    );
    ringTimer = window.setTimeout(() => void finish('noAnswer', 'missed'), RING_TIMEOUT);
  } catch {
    await finish('failed', 'ended');
  }
}

// ---------- входящий звонок ----------
export function showIncoming(data: CallDoc) {
  const current = useCall.getState().call;
  if (current) {
    if (current.id !== data.id) void updateDoc(callRef(data.id), { status: 'declined' }).catch(() => undefined);
    return;
  }
  useCall.setState({
    call: {
      id: data.id,
      chatId: data.chatId,
      peerUid: data.callerId,
      video: data.video,
      outgoing: false,
      phase: 'incoming',
      startedAt: null,
      endReason: null,
      micOn: true,
      camOn: data.video,
      local: null,
      remote: null,
    },
  });
  // Звонивший передумал — убираем входящий.
  unsubs.push(
    onSnapshot(callRef(data.id), (snap) => {
      const status = snap.data()?.status;
      if (status && status !== 'ringing' && status !== 'accepted') void finish('ended');
    }),
  );
  ringTimer = window.setTimeout(() => void finish('noAnswer'), RING_TIMEOUT);
}

export async function acceptCall() {
  const call = useCall.getState().call;
  if (!call || call.phase !== 'incoming') return;
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
    const peer = await createPeer(call.id, 'calleeCandidates');
    pc = peer;
    local.getTracks().forEach((t) => peer.addTrack(t, local));
    const offer = await new Promise<RTCSessionDescriptionInit>((resolve, reject) => {
      const unsub = onSnapshot(
        callRef(call.id),
        (snap) => {
          const o = snap.data()?.offer;
          if (o) {
            unsub();
            resolve(o);
          }
        },
        reject,
      );
    });
    await peer.setRemoteDescription(offer);
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    await updateDoc(callRef(call.id), {
      answer: { type: answer.type, sdp: answer.sdp },
      status: 'accepted',
      answeredAt: serverTimestamp(),
    });
    listenCandidates(call.id, 'callerCandidates')();
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
