import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMe } from '../../app/store';
import { fetchRingingCalls, toCall } from '../../supabase/api';
import { onDbEvent, onResync } from '../../supabase/realtime';
import { displayNameOf, useProfile } from '../../app/profiles';
import { formatDuration } from '../../lib/time';
import { beep } from '../../app/sounds';
import { Avatar } from '../../ui/Avatar';
import { Icon } from '../../ui/Icon';
import {
  acceptCall,
  canShareScreen,
  canSwitchSpeaker,
  declineCall,
  hangUp,
  showIncoming,
  switchCamera,
  toggleCam,
  toggleMic,
  toggleScreenShare,
  toggleSpeaker,
  useCall,
} from './callStore';

function Video({ stream, muted, className }: { stream: MediaStream | null; muted?: boolean; className: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream;
  }, [stream]);
  return <video ref={ref} className={className} autoPlay playsInline muted={muted} />;
}

function Timer({ since }: { since: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick((x) => x + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  return <>{formatDuration((Date.now() - since) / 1000)}</>;
}

/** Слушает входящие звонки и показывает экран звонка поверх приложения. */
export function CallLayer() {
  const me = useMe();
  const call = useCall((s) => s.call);
  const { t } = useTranslation();
  const peer = useProfile(call?.peerUid ?? null);

  useEffect(() => {
    if (!me) return;
    // Открыли приложение по пушу о звонке — звонок уже идёт.
    const check = () =>
      void fetchRingingCalls(me)
        .then((list) => list.forEach(showIncoming))
        .catch(() => undefined);
    check();
    const offResync = onResync(check);
    const off = onDbEvent((e) => {
      if (e.table === 'calls' && e.type === 'INSERT' && e.row.callee_id === me && e.row.status === 'ringing') {
        showIncoming(toCall(e.row));
      }
    });
    return () => {
      off();
      offResync();
    };
  }, [me]);

  // Мелодия вызова.
  useEffect(() => {
    if (!call || (call.phase !== 'incoming' && call.phase !== 'calling')) return;
    const kind = call.phase === 'incoming' ? 'ring' : 'message';
    beep(kind);
    const id = window.setInterval(() => beep(kind), call.phase === 'incoming' ? 2000 : 3000);
    return () => window.clearInterval(id);
  }, [call?.phase, call]);

  if (!call) return null;

  const name = displayNameOf(peer, '…');
  const showRemoteVideo = call.video || call.remoteScreen;
  const hasRemoteVideo = showRemoteVideo && (call.remote?.getVideoTracks().length ?? 0) > 0;
  // Своё превью: экран, если показываю, иначе камера в видеозвонке.
  const preview = call.sharing ? call.screen : call.video ? call.local : null;
  let status = '';
  switch (call.phase) {
    case 'incoming':
      status = call.video ? t('calls.incomingVideo') : t('calls.incomingAudio');
      break;
    case 'calling':
      status = t('calls.calling');
      break;
    case 'connecting':
      status = t('calls.connecting');
      break;
    case 'ended':
      status = t(`calls.${call.endReason === 'ended' || !call.endReason ? 'ended' : call.endReason}`);
      break;
  }

  return (
    <div className={showRemoteVideo ? 'call-screen video' : 'call-screen'}>
      {/* Один элемент на всё время звонка: через него же идёт звук. */}
      <Video
        stream={call.remote}
        className={showRemoteVideo ? (call.remoteScreen ? 'call-remote contain' : 'call-remote') : 'hidden'}
      />
      {preview && <Video stream={preview} muted className={call.sharing ? 'call-local screen' : 'call-local'} />}

      {(!hasRemoteVideo || call.phase !== 'active') && (
        <div className="call-info">
          <Avatar name={name} seed={call.peerUid} src={peer?.avatar} size={120} />
          <h2>{name}</h2>
          <p>{call.phase === 'active' && call.startedAt ? <Timer since={call.startedAt} /> : status}</p>
        </div>
      )}
      {hasRemoteVideo && call.phase === 'active' && call.startedAt && (
        <div className="call-overlay-title">
          {name} · <Timer since={call.startedAt} />
          {call.remoteScreen && <div className="small">{t('calls.remoteScreen', { name })}</div>}
        </div>
      )}
      {call.sharing && call.phase === 'active' && <div className="call-sharing-note">{t('calls.sharingNow')}</div>}

      <div className="call-controls">
        {call.phase === 'incoming' ? (
          <>
            <button className="call-btn decline" onClick={declineCall} aria-label={t('calls.decline')}>
              <Icon name="hangup" size={28} />
              <span>{t('calls.decline')}</span>
            </button>
            <button className="call-btn accept" onClick={() => void acceptCall()} aria-label={t('calls.accept')}>
              <Icon name={call.video ? 'video' : 'phone'} size={28} />
              <span>{t('calls.accept')}</span>
            </button>
          </>
        ) : call.phase !== 'ended' ? (
          <>
            <button className={call.micOn ? 'call-btn' : 'call-btn off'} onClick={toggleMic} aria-label={t('calls.mute')}>
              <Icon name={call.micOn ? 'mic' : 'micOff'} size={26} />
              <span>{t('calls.mute')}</span>
            </button>
            {call.video && (
              <>
                <button className={call.camOn ? 'call-btn' : 'call-btn off'} onClick={toggleCam} aria-label={t('calls.camera')}>
                  <Icon name={call.camOn ? 'video' : 'videoOff'} size={26} />
                  <span>{t('calls.camera')}</span>
                </button>
                <button className="call-btn" onClick={() => void switchCamera()} aria-label={t('calls.switchCamera')}>
                  <Icon name="flip" size={26} />
                  <span>{t('calls.switchCamera')}</span>
                </button>
              </>
            )}
            {canSwitchSpeaker && (
              <button
                className={call.speaker ? 'call-btn off' : 'call-btn'}
                onClick={toggleSpeaker}
                aria-pressed={call.speaker}
                aria-label={call.speaker ? t('calls.speakerLoud') : t('calls.speakerQuiet')}
              >
                <Icon name={call.speaker ? 'speaker' : 'earpiece'} size={26} />
                <span>{call.speaker ? t('calls.speakerLoud') : t('calls.speakerQuiet')}</span>
              </button>
            )}
            {canShareScreen && call.phase === 'active' && (
              <button
                className={call.sharing ? 'call-btn off' : 'call-btn'}
                onClick={() => void toggleScreenShare()}
                aria-pressed={call.sharing}
                aria-label={t('calls.screen')}
              >
                <Icon name="screen" size={26} />
                <span>{t('calls.screen')}</span>
              </button>
            )}
            <button className="call-btn decline" onClick={hangUp} aria-label={t('calls.hangup')}>
              <Icon name="hangup" size={28} />
              <span>{t('calls.hangup')}</span>
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
