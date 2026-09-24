import { memo, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChatType, Message } from '../../supabase/types';
import { displayNameOf, useProfile } from '../../app/profiles';
import { formatDuration, formatTime, toDate } from '../../lib/time';
import { Icon } from '../../ui/Icon';
import { Avatar } from '../../ui/Avatar';
import { useLongPress } from '../../ui/useLongPress';
import { callText, systemText } from '../chats/chatMeta';
import { isEmojiOnly, MessageText } from './MessageText';

const NAME_COLORS = ['#e17076', '#eda86c', '#a695e7', '#7bc862', '#6ec9cb', '#65aadd', '#ee7aae'];
function nameColor(uid: string): string {
  let h = 0;
  for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) | 0;
  return NAME_COLORS[Math.abs(h) % NAME_COLORS.length];
}

interface Props {
  msg: Message;
  me: string;
  chatType: ChatType;
  read: boolean;
  /** Первое сообщение в серии от одного отправителя (показываем имя). */
  first: boolean;
  /** Последнее в серии (показываем аватар и «хвостик»). */
  last: boolean;
  highlighted: boolean;
  search?: string;
  onMenu: (msg: Message, x: number, y: number) => void;
  onReact: (msg: Message, emoji: string) => void;
  onJump: (id: string) => void;
  onOpenProfile: (uid: string) => void;
}

export const MessageBubble = memo(function MessageBubble(props: Props) {
  const { msg, me, chatType, read, first, last, highlighted, search, onMenu, onReact, onJump, onOpenProfile } = props;
  const { t, i18n } = useTranslation();
  const own = msg.senderId === me && chatType !== 'channel';
  const showSender = chatType === 'group' && !own;
  const sender = useProfile(showSender || msg.system ? msg.senderId : null);
  const replyAuthor = useProfile(msg.replyTo?.senderId ?? null);
  const longPress = useLongPress((x, y) => onMenu(msg, x, y));
  const date = toDate(msg.createdAt);

  if (msg.system) {
    return (
      <div className="msg-row system" id={`m-${msg.id}`}>
        <span className="pill">{systemText(msg.system, msg.senderId, t, me)}</span>
      </div>
    );
  }

  const onContext = (e: MouseEvent) => {
    e.preventDefault();
    onMenu(msg, e.clientX, e.clientY);
  };

  const reactions = Object.entries(msg.reactions).filter(([, uids]) => uids.length > 0);
  const big = !msg.replyTo && !msg.forwardedFrom && isEmojiOnly(msg.text);

  const meta = (
    <span className="msg-meta">
      {msg.editedAt && <span className="msg-edited">{t('chat.edited')}</span>}
      {date && formatTime(date, i18n.language)}
      {own && chatType !== 'saved' && (
        <Icon
          name={msg.failed ? 'ban' : msg.pending ? 'clock' : read ? 'checks' : 'check'}
          size={15}
          className={msg.failed ? 'tick danger' : 'tick'}
        />
      )}
    </span>
  );

  let cls = 'msg-row';
  if (own) cls += ' own';
  if (last) cls += ' last';
  if (highlighted) cls += ' highlighted';

  return (
    <div className={cls} id={`m-${msg.id}`}>
      {showSender && (
        <div className="msg-avatar">
          {last && (
            <button className="plain" onClick={() => onOpenProfile(msg.senderId)}>
              <Avatar name={displayNameOf(sender, '?')} seed={msg.senderId} src={sender?.avatar} size={34} />
            </button>
          )}
        </div>
      )}
      <div
        className={big ? 'bubble big-emoji' : 'bubble'}
        onContextMenu={onContext}
        onDoubleClick={(e) => onMenu(msg, e.clientX, e.clientY)}
        {...longPress}
      >
        {showSender && first && (
          <button className="msg-sender plain" style={{ color: nameColor(msg.senderId) }} onClick={() => onOpenProfile(msg.senderId)}>
            {displayNameOf(sender, '…')}
          </button>
        )}
        {msg.forwardedFrom && (
          <div className="msg-forwarded">
            {t('chat.forwarded', { name: msg.forwardedFrom.chatTitle ?? msg.forwardedFrom.senderName })}
          </div>
        )}
        {msg.replyTo && (
          <button className="msg-reply plain" onClick={() => onJump(msg.replyTo!.id)}>
            <span className="msg-reply-name">{displayNameOf(replyAuthor, '…')}</span>
            <span className="msg-reply-text">{msg.replyTo.snippet}</span>
          </button>
        )}
        {msg.call ? (
          <div className="msg-call">
            <span className={msg.call.duration > 0 ? 'call-icon' : 'call-icon missed'}>
              <Icon name={msg.senderId === me ? 'arrowOut' : 'arrowIn'} size={16} />
            </span>
            <div>
              <div>{callText(msg, t, me)}</div>
              {msg.call.duration > 0 && <div className="muted small">{formatDuration(msg.call.duration)}</div>}
            </div>
            <Icon name={msg.call.video ? 'video' : 'phone'} size={20} />
            {meta}
          </div>
        ) : (
          <div className="msg-text">
            <MessageText text={msg.text} highlight={search} />
            {meta}
          </div>
        )}
        {reactions.length > 0 && (
          <div className="reactions">
            {reactions.map(([emoji, uids]) => (
              <button
                key={emoji}
                className={uids.includes(me) ? 'reaction mine' : 'reaction'}
                onClick={() => onReact(msg, emoji)}
              >
                <span>{emoji}</span>
                <span>{uids.length}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});
