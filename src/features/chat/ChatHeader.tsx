import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { Chat } from '../../supabase/types';
import { useApp } from '../../app/store';
import { displayNameOf, peekProfile, usePresence, type Presence } from '../../app/profiles';
import { subscribeTyping } from '../../supabase/realtime';
import { dayLabel, formatTime } from '../../lib/time';
import { Icon } from '../../ui/Icon';
import { Badges } from '../../ui/Badges';
import { ChatAvatar, useChatMeta } from '../chats/chatMeta';

export function lastSeenText(p: Presence | null | undefined, hideMine: boolean, t: TFunction, locale: string): string {
  if (!p || p.hidden) return t('chats.lastSeenRecently');
  if (p.online) return t('chats.online');
  if (hideMine || !p.lastSeen) return t('chats.lastSeenRecently');
  const d = new Date(p.lastSeen);
  const label = dayLabel(d, locale);
  const time = formatTime(d, locale);
  const when =
    label.kind === 'today'
      ? t('chats.lastSeenToday', { time })
      : label.kind === 'yesterday'
        ? t('chats.lastSeenYesterday', { time })
        : label.text;
  return t('chats.lastSeen', { time: when });
}

function useTyping(chatId: string, me: string, enabled: boolean): string[] {
  const [uids, setUids] = useState<string[]>([]);
  useEffect(() => {
    if (!enabled) return;
    return subscribeTyping(chatId, (list) => setUids(list.filter((u) => u !== me)));
  }, [chatId, me, enabled]);
  return uids;
}

interface Props {
  chat: Chat;
  me: string;
  onSearch: () => void;
  onCall: (video: boolean) => void;
  onMenu: (x: number, y: number) => void;
}

export function ChatHeader({ chat, me, onSearch, onCall, onMenu }: Props) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const meta = useChatMeta(chat);
  const presence = usePresence(meta.otherUid);
  const hideMine = useApp((s) => s.profile?.hideLastSeen ?? false);
  const typing = useTyping(chat.id, me, chat.type === 'private' || chat.type === 'group');

  let subtitle = '';
  let accent = false;
  if (typing.length > 0) {
    accent = true;
    if (chat.type === 'private') subtitle = t('chats.typing');
    else if (typing.length === 1) subtitle = t('chats.typingName', { name: displayNameOf(peekProfile(typing[0]), '…') });
    else subtitle = t('chats.typingMany', { count: typing.length });
  } else if (chat.type === 'private') {
    subtitle = lastSeenText(presence, hideMine, t, i18n.language);
    accent = presence?.online === true;
  } else if (chat.type === 'group') {
    subtitle = t('chats.members', { count: chat.memberCount });
  } else if (chat.type === 'channel') {
    subtitle = t('chats.subscribers', { count: chat.memberCount });
  }

  const openInfo = () => {
    if (chat.type === 'saved') return;
    if (chat.type === 'private' && meta.otherUid) navigate(`/profile/${meta.otherUid}`);
    else navigate(`/c/${chat.id}/info`);
  };

  return (
    <header className="topbar chat-header">
      <button className="icon-btn back-btn" onClick={() => navigate('/')} aria-label={t('common.back')}>
        <Icon name="back" />
      </button>
      <button className="chat-header-main plain" onClick={openInfo}>
        <ChatAvatar meta={meta} size={40} />
        <div className="chat-header-text">
          <div className="chat-header-title">
            <span className="ellipsis">{meta.title}</span>
            <Badges {...meta.badges} />
          </div>
          {subtitle && <div className={accent ? 'chat-header-sub accent-text' : 'chat-header-sub'}>{subtitle}</div>}
        </div>
      </button>
      {chat.type === 'private' && (
        <>
          <button className="icon-btn hide-narrow" onClick={() => onCall(true)} aria-label={t('chat.callVideo')}>
            <Icon name="video" />
          </button>
          <button className="icon-btn" onClick={() => onCall(false)} aria-label={t('chat.callAudio')}>
            <Icon name="phone" />
          </button>
        </>
      )}
      <button className="icon-btn hide-narrow" onClick={onSearch} aria-label={t('chat.searchInChat')}>
        <Icon name="search" />
      </button>
      <button
        className="icon-btn"
        aria-label="more"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          onMenu(r.right - 220, r.bottom + 4);
        }}
      >
        <Icon name="more" />
      </button>
    </header>
  );
}
