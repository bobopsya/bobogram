import { memo, useState, type MouseEvent } from 'react';
import { stripMarkup } from '../../lib/markup';
import { useTranslation } from 'react-i18next';
import type { Chat } from '../../supabase/types';
import { useApp, useMe } from '../../app/store';
import { errorKey, setChatPrefs } from '../../supabase/api';
import { refreshChats } from '../../app/session';
import { formatChatListTime, toDate } from '../../lib/time';
import { Icon } from '../../ui/Icon';
import { Menu, type MenuItem } from '../../ui/Menu';
import { displayNameOf, systemUids, usePresence, useProfile, useProfilesLoaded } from '../../app/profiles';
import { useLongPress } from '../../ui/useLongPress';
import { Badges } from '../../ui/Badges';
import { callText, ChatAvatar, systemText, useChatMeta, mediaLabel } from './chatMeta';

interface Props {
  chat: Chat;
  active: boolean;
  onClick: () => void;
}

export const ChatListItem = memo(function ChatListItem({ chat, active, onClick }: Props) {
  const { t, i18n } = useTranslation();
  const me = useMe();
  const meta = useChatMeta(chat);
  const presence = usePresence(meta.otherUid);
  const pendingCount = useApp((s) => s.outbox.filter((m) => m.chatId === chat.id).length);
  const last = chat.lastMessage;
  const lastSender = useProfile(last && chat.type === 'group' && last.senderId !== me ? last.senderId : null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  useProfilesLoaded(last?.system ? systemUids(last.system, last.senderId) : []);

  const openMenu = (x: number, y: number) => setMenu({ x, y });
  const longPress = useLongPress(openMenu);

  let preview = '';
  if (last) {
    if (last.deleted) preview = t('chats.deletedMessage');
    else if (last.system) preview = systemText(last.system, last.senderId, t, me);
    else if (last.call) preview = callText({ call: last.call, senderId: last.senderId }, t, me);
    else if (last.media)
      preview = last.text ? `${mediaLabel(last, t)}, ${stripMarkup(last.text)}` : mediaLabel(last, t);
    else preview = stripMarkup(last.text);
  }
  let prefix = '';
  if (last && !last.system && chat.type !== 'saved' && chat.type !== 'channel') {
    if (last.senderId === me) prefix = t('common.you') + ': ';
    else if (chat.type === 'group' && lastSender) prefix = displayNameOf(lastSender) + ': ';
  }
  const readByOther = !!last && last.senderId === me && chat.othersReadAt >= last.createdAt;

  const date = toDate(last?.createdAt ?? chat.updatedAt);
  const showToast = useApp((s) => s.showToast);
  const setPrefs = (prefs: { pinned?: boolean; muted?: boolean }) =>
    void setChatPrefs(chat.id, prefs)
      .then(() => refreshChats(0))
      .catch((err) => showToast(t(errorKey(err))));
  const items: MenuItem[] = [
    {
      icon: 'pin',
      label: chat.pinned ? t('chats.unpin') : t('chats.pin'),
      onClick: () => setPrefs({ pinned: !chat.pinned }),
    },
    chat.muted
      ? { icon: 'bell', label: t('chats.unmute'), onClick: () => setPrefs({ muted: false }) }
      : { icon: 'bellOff', label: t('chats.mute'), onClick: () => setPrefs({ muted: true }) },
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
              <span className="ellipsis" style={meta.nameStyle}>
                {meta.title}
              </span>
              <Badges {...meta.badges} size={15} />
              {chat.muted && <Icon name="bellOff" size={14} className="muted-icon" />}
            </span>
            <span className="list-item-time">
              {pendingCount > 0 ? (
                <Icon name="clock" size={15} className="tick" />
              ) : (
                last?.senderId === me &&
                !last.system &&
                chat.type !== 'saved' && (
                  <Icon name={readByOther ? 'checks' : 'check'} size={16} className="tick" />
                )
              )}
              {date ? formatChatListTime(date, i18n.language) : ''}
            </span>
          </div>
          <div className="list-item-row">
            <span className="list-item-sub ellipsis">
              {prefix && <span className="accent-text">{prefix}</span>}
              {preview || (last ? '' : chat.type === 'saved' ? t('chats.savedHint') : t('chats.noMessages'))}
            </span>
            {chat.unread > 0 ? (
              <span className={chat.muted ? 'badge muted' : 'badge'}>
                {chat.unread > 999 ? '999+' : chat.unread}
              </span>
            ) : (
              chat.pinned && <Icon name="pin" size={16} className="pin-icon" />
            )}
          </div>
        </div>
      </button>
      {menu && <Menu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />}
    </>
  );
});
