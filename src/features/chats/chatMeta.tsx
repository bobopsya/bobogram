import type { CSSProperties } from 'react';
import { nameColorStyle } from '../../app/themes';
import { useTranslation } from 'react-i18next';
import { isPremium, type Chat, type Message, type SystemEvent } from '../../supabase/types';
import type { BadgeFlags } from '../../ui/Badges';
import { displayNameOf, peekProfile, useProfile } from '../../app/profiles';
import { Avatar } from '../../ui/Avatar';
import { StoryAvatar } from '../stories/Stories';
import type { IconName } from '../../ui/Icon';
import type { TFunction } from 'i18next';

export interface ChatMeta {
  title: string;
  avatar: string | null;
  seed: string;
  icon?: IconName;
  otherUid: string | null;
  badges: BadgeFlags;
  /** Цвет имени собеседника (стиль профиля). */
  nameStyle?: CSSProperties;
}

/** Название и аватар чата: для лички — данные собеседника. */
export function useChatMeta(
  chat: Pick<Chat, 'id' | 'type' | 'otherId' | 'title' | 'avatar'> & Partial<Pick<Chat, 'verified' | 'scam'>>,
): ChatMeta {
  const { t } = useTranslation();
  const otherUid = chat.type === 'private' ? chat.otherId : null;
  const other = useProfile(otherUid);
  switch (chat.type) {
    case 'saved':
      return {
        title: t('chats.savedMessages'),
        avatar: null,
        seed: chat.id,
        icon: 'bookmark',
        otherUid: null,
        badges: {},
      };
    case 'private':
      return {
        title: other === null ? t('chats.deletedAccount') : displayNameOf(other, '…'),
        avatar: other?.avatar ?? null,
        seed: otherUid ?? chat.id,
        otherUid,
        badges: {
          verified: other?.verified,
          scam: other?.scam,
          premium: isPremium(other),
          emoji: other?.emojiStatus,
          developer: other?.developer,
          founder: other?.founder,
        },
        nameStyle: nameColorStyle(other?.nameColor),
      };
    default:
      return {
        title: chat.title ?? '',
        avatar: chat.avatar,
        seed: chat.id,
        otherUid: null,
        badges: { verified: chat.verified, scam: chat.scam },
      };
  }
}

export function ChatAvatar({ meta, size, online }: { meta: ChatMeta; size?: number; online?: boolean }) {
  if (meta.otherUid) {
    return (
      <StoryAvatar
        userId={meta.otherUid}
        name={meta.title}
        seed={meta.seed}
        src={meta.avatar}
        size={size}
        online={online}
      />
    );
  }
  return (
    <Avatar
      name={meta.title}
      seed={meta.seed}
      src={meta.avatar}
      icon={meta.icon}
      size={size}
      online={online}
    />
  );
}

function nameOf(uid: string, t: TFunction, me: string): string {
  if (uid === me) return t('common.you');
  return displayNameOf(peekProfile(uid), '…');
}

/** Текст системного сообщения («Аня добавила Борю»). */
export function systemText(ev: SystemEvent, senderId: string, t: TFunction, me: string): string {
  const name = nameOf(senderId, t, me);
  switch (ev.kind) {
    case 'created':
      return t('system.created', { name, title: ev.title });
    case 'joined':
      return t('system.joined', { name });
    case 'left':
      return t('system.left', { name });
    case 'added':
      return t('system.added', { name, users: ev.uids.map((u) => nameOf(u, t, me)).join(', ') });
    case 'removed':
      return t('system.removed', { name, user: nameOf(ev.uid, t, me) });
    case 'renamed':
      return t('system.renamed', { name, title: ev.title });
  }
}

export function callText(msg: Pick<Message, 'call' | 'senderId'>, t: TFunction, me: string): string {
  if (!msg.call) return '';
  const outgoing = msg.senderId === me;
  if (msg.call.duration > 0) return msg.call.video ? t('chat.callVideo') : t('chat.callAudio');
  return outgoing ? t('chat.callCancelled') : t('chat.callMissed');
}

/** «📷 Фото» / «🎤 Голосовое сообщение» — для превью, ответов и закрепов. */
export function mediaLabel(msg: { media: { kind: string } | null }, t: TFunction): string {
  if (!msg.media) return '';
  return msg.media.kind === 'voice' ? '🎤 ' + t('media.voice') : '📷 ' + t('media.photo');
}
