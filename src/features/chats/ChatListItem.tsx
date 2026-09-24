import { memo, useEffect, useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { Chat, UserChatPrefs } from '../../firebase/types';
import { useMe } from '../../app/store';
import { countUnread, setChatMuted, setChatPinned } from '../../firebase/db';
import { formatChatListTime, toDate, toMillis } from '../../lib/time';
import { Icon } from '../../ui/Icon';
import { Menu, type MenuItem } from '../../ui/Menu';
import { usePresence, useProfile, displayNameOf } from '../../app/profiles';
import { isMuted } from '../../app/sounds';
import { useLongPress } from '../../ui/useLongPress';
import { callText, ChatAvatar, systemText, useChatMeta } from './chatMeta';

const unreadCache = new Map<string, number>();

/** Число непрочитанных; запрашивается с сервера только когда есть новые чужие сообщения. */
function useUnread(chat: Chat, me: string): number {
  const readAt = chat.readBy[me] ?? null;
  const last = chat.lastMessage;
  const hasUnread = !!last && last.senderId !== me && toMillis(last.createdAt) > toMillis(readAt);
  const key = `${chat.id}:${last?.id}:${toMillis(readAt)}`;
  const [count, setCount] = useState(() => (hasUnread ? (unreadCache.get(key) ?? 1) : 0));

  useEffect(() => {
    if (!hasUnread) {
      setCount(0);
      return;
    }
    const cached = unreadCache.get(key);
    if (cached !== undefined) {
      setCount(cached);
      return;
    }
    let cancelled = false;
    countUnread(chat.id, readAt)
      .then((n) => {
        unreadCache.set(key, n);
        if (!cancelled) setCount(n);
      })
      .catch(() => !cancelled && setCount(1));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, hasUnread]);
  return count;
}

interface Props {
  chat: Chat;
  active: boolean;
  prefs: UserChatPrefs | undefined;
  onClick: () => void;
}

export const ChatListItem = memo(function ChatListItem({ chat, active, prefs, onClick }: Props) {
  const { t, i18n } = useTranslation();
  const me = useMe();
  const meta = useChatMeta(chat, me);
  const presence = usePresence(meta.otherUid);
  const unread = useUnread(chat, me);
  const last = chat.lastMessage;
  const lastSender = useProfile(last && chat.type === 'group' && last.senderId !== me ? last.senderId : null);
  const muted = isMuted(prefs?.mutedUntil);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  const openMenu = (x: number, y: number) => setMenu({ x, y });
  const longPress = useLongPress(openMenu);

  let preview = '';
  if (last) {
    if (last.deleted) preview = t('chats.deletedMessage');
    else if (last.event) preview = systemText(last.event, last.senderId, t, me);
    else if (last.call) preview = callText({ call: last.call, senderId: last.senderId }, t, me);
    else preview = last.text;
  }
  let prefix = '';
  if (last && !last.event && chat.type !== 'saved' && chat.type !== 'channel') {
    if (last.senderId === me) prefix = t('common.you') + ': ';
    else if (chat.type === 'group' && lastSender) prefix = displayNameOf(lastSender) + ': ';
  }
  const readByOther =
    last?.senderId === me &&
    Object.entries(chat.readBy).some(([uid, ts]) => uid !== me && toMillis(ts) >= toMillis(last.createdAt));

  const date = toDate(last?.createdAt ?? chat.updatedAt);
  const items: MenuItem[] = [
    {
      icon: 'pin',
      label: prefs?.pinned ? t('chats.unpin') : t('chats.pin'),
      onClick: () => void setChatPinned(me, chat.id, !prefs?.pinned),
    },
    muted
      ? { icon: 'bell', label: t('chats.unmute'), onClick: () => void setChatMuted(me, chat.id, null) }
      : { icon: 'bellOff', label: t('chats.mute'), onClick: () => void setChatMuted(me, chat.id, -1) },
  ];

  return (
    <>
      <button
        className={active ? 'list-item chat-item active' : 'list-item chat-item'}
        onClick={onClick}
        onContextMenu={(e: MouseEvent) => {
          e.preventDefault();
          openMenu(e.clientX, e.clientY);
        }}
        {...longPress}
      >
        <ChatAvatar meta={meta} size={54} online={presence?.online} />
        <div className="list-item-body">
          <div className="list-item-row">
            <span className="list-item-title">
              {chat.type === 'group' && <Icon name="users" size={15} className="title-icon" />}
              {chat.type === 'channel' && <Icon name="megaphone" size={15} className="title-icon" />}
              <span className="ellipsis">{meta.title}</span>
              {muted && <Icon name="bellOff" size={14} className="muted-icon" />}
            </span>
            <span className="list-item-time">
              {last?.senderId === me && !last.event && chat.type !== 'saved' && (
                <Icon name={readByOther ? 'checks' : 'check'} size={16} className="tick" />
              )}
              {date ? formatChatListTime(date, i18n.language) : ''}
            </span>
          </div>
          <div className="list-item-row">
            <span className="list-item-sub ellipsis">
              {prefix && <span className="accent-text">{prefix}</span>}
              {preview || (last ? '' : chat.type === 'saved' ? t('chats.savedHint') : t('chats.noMessages'))}
            </span>
            {unread > 0 ? (
              <span className={muted ? 'badge muted' : 'badge'}>{unread > 999 ? '999+' : unread}</span>
            ) : (
              prefs?.pinned && <Icon name="pin" size={16} className="pin-icon" />
            )}
          </div>
        </div>
      </button>
      {menu && <Menu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />}
    </>
  );
});
