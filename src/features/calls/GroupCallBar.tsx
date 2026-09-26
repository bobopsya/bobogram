import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../supabase/client';
import { errorKey } from '../../supabase/api';
import { onDbEvent } from '../../supabase/realtime';
import { displayNameOf, useProfile } from '../../app/profiles';
import { useApp } from '../../app/store';
import { Avatar } from '../../ui/Avatar';
import { Icon } from '../../ui/Icon';
import { joinGroupCall, leaveGroupCall, toggleGroupMute, useGroupCall } from './groupCall';

interface Active {
  id: string;
  members: { userId: string; muted: boolean }[];
}

/** Идущий голосовой чат группы: кто в нём и есть ли он вообще. */
export function useActiveGroupCall(chatId: string, enabled: boolean): Active | null {
  const [active, setActive] = useState<Active | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const load = async () => {
      const { data: call } = await supabase
        .from('group_calls')
        .select('id')
        .eq('chat_id', chatId)
        .is('ended_at', null)
        .maybeSingle();
      if (!call) return !cancelled && setActive(null);
      const { data: members } = await supabase
        .from('group_call_members')
        .select('user_id, muted')
        .eq('call_id', call.id)
        .order('joined_at');
      if (!cancelled)
        setActive({
          id: String(call.id),
          members: (members ?? []).map((m) => ({ userId: String(m.user_id), muted: m.muted === true })),
        });
    };
    void load();
    const off = onDbEvent((e) => {
      if (e.table === 'group_calls' || e.table === 'group_call_members') void load();
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [chatId, enabled]);
  return active;
}

function Participant({ uid, muted, speaking }: { uid: string; muted: boolean; speaking: boolean }) {
  const p = useProfile(uid);
  return (
    <div className={speaking ? 'gc-member speaking' : 'gc-member'}>
      <Avatar name={displayNameOf(p, '?')} seed={uid} src={p?.avatar} size={44} />
      {muted && (
        <span className="gc-muted">
          <Icon name="micOff" size={12} />
        </span>
      )}
      <span className="gc-name ellipsis">{displayNameOf(p, '…')}</span>
    </div>
  );
}

/** Плашка над перепиской: присоединиться к голосовому чату или управление, если я в нём. */
export function GroupCallBar({ chatId, active }: { chatId: string; active: Active | null }) {
  const { t } = useTranslation();
  const showToast = useApp((s) => s.showToast);
  const call = useGroupCall((s) => s.call);
  const mine = call?.chatId === chatId ? call : null;
  const [busy, setBusy] = useState(false);

  const join = () => {
    setBusy(true);
    void joinGroupCall(chatId)
      .catch((e: unknown) => showToast(e instanceof DOMException ? t('media.micDenied') : t(errorKey(e))))
      .finally(() => setBusy(false));
  };

  if (!mine) {
    if (!active || active.members.length === 0) return null;
    return (
      <div className="gc-bar">
        <Icon name="headphones" size={20} className="accent-text" />
        <div className="grow min0">
          <div className="gc-title">{t('groupCall.title')}</div>
          <div className="muted small">{t('groupCall.members', { count: active.members.length })}</div>
        </div>
        <button className="btn btn-primary small" disabled={busy} onClick={join}>
          {t('groupCall.join')}
        </button>
      </div>
    );
  }

  return (
    <div className="gc-panel" data-connected={mine.connected.length}>
      <div className="gc-members">
        {(active?.members ?? []).map((m) => (
          <Participant
            key={m.userId}
            uid={m.userId}
            muted={m.muted}
            speaking={mine.speaking.includes(m.userId)}
          />
        ))}
      </div>
      <div className="gc-actions">
        <button
          className={mine.muted ? 'gc-btn off' : 'gc-btn'}
          onClick={toggleGroupMute}
          aria-label={mine.muted ? t('groupCall.unmute') : t('groupCall.mute')}
        >
          <Icon name={mine.muted ? 'micOff' : 'mic'} />
        </button>
        <button
          className="gc-btn leave"
          onClick={() => void leaveGroupCall()}
          aria-label={t('groupCall.leave')}
        >
          <Icon name="hangup" />
        </button>
      </div>
    </div>
  );
}

/** Кнопка в шапке группы: начать или присоединиться. */
export function useStartGroupCall(chatId: string) {
  const { t } = useTranslation();
  const showToast = useApp((s) => s.showToast);
  return () =>
    void joinGroupCall(chatId).catch((e: unknown) =>
      showToast(e instanceof DOMException ? t('media.micDenied') : t(errorKey(e))),
    );
}
