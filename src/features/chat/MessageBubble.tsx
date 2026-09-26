import { memo, useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { isPremium, type ChatType, type Message } from '../../supabase/types';
import { formatCount } from '../../lib/time';
import { displayNameOf, systemUids, useProfile, useProfilesLoaded } from '../../app/profiles';
import { formatDuration, formatTime, toDate } from '../../lib/time';
import { Icon } from '../../ui/Icon';
import { Avatar } from '../../ui/Avatar';
import { useLongPress } from '../../ui/useLongPress';
import { Badges } from '../../ui/Badges';
import { callText, systemText } from '../chats/chatMeta';
import { isEmojiOnly, MessageText } from './MessageText';
import { PollView } from './Poll';
import { FileMedia, PhotoMedia, VideoMedia, VideoNoteMedia, VoiceMedia } from './MediaViews';
import { nameColorStyle } from '../../app/themes';

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
  const {
    msg,
    me,
    chatType,
    read,
    first,
    last,
    highlighted,
    search,
    onMenu,
    onReact,
    onJump,
    onOpenProfile,
  } = props;
  const { t, i18n } = useTranslation();
  const own = msg.senderId === me && chatType !== 'channel';
  const showSender = chatType === 'group' && !own;
  const sender = useProfile(showSender || msg.system ? msg.senderId : null);
  const replyAuthor = useProfile(msg.replyTo?.senderId ?? null);
  const longPress = useLongPress((x, y) => onMenu(msg, x, y));
  const date = toDate(msg.createdAt);
  // Только что пришедшее или отправленное сообщение плавно появляется; история — без анимации.
  const [fresh] = useState(() => Date.now() - msg.createdAt < 4000);
  useProfilesLoaded(systemUids(msg.system, msg.senderId));

  if (msg.system) {
    return (
      <div className="msg-row system" id={`m-${msg.id}`} data-date={msg.createdAt}>
        <span className="pill">{systemText(msg.system, msg.senderId, t, me)}</span>
      </div>
    );
  }

  const onContext = (e: MouseEvent) => {
    e.preventDefault();
    onMenu(msg, e.clientX, e.clientY);
  };

  // Настоящие реакции + накрутка администратора.
  const reactions = [...new Set([...Object.keys(msg.reactions), ...Object.keys(msg.boostReactions)])]
    .map((emoji) => {
      const uids = msg.reactions[emoji] ?? [];
      return { emoji, mine: uids.includes(me), count: uids.length + (msg.boostReactions[emoji] ?? 0) };
    })
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count);
  const views = msg.views + msg.boostViews;
  const big = !msg.replyTo && !msg.forwardedFrom && !msg.media && isEmojiOnly(msg.text);
  const photo = msg.media?.kind === 'photo' ? msg.media : null;
  const voice = msg.media?.kind === 'voice' ? msg.media : null;
  const video = msg.media?.kind === 'video' ? msg.media : null;
  const file = msg.media?.kind === 'file' ? msg.media : null;
  const note = msg.media?.kind === 'video_note' ? msg.media : null;

  const meta = (
    <span className="msg-meta">
      {chatType === 'channel' && views > 0 && (
        <span className="msg-views">
          <Icon name="eye" size={13} />
          {formatCount(views)}
        </span>
      )}
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
  if (fresh) cls += ' fresh';
  if (own) cls += ' own';
  if (last) cls += ' last';
  if (highlighted) cls += ' highlighted';

  return (
    <div className={cls} id={`m-${msg.id}`} data-date={msg.createdAt}>
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
        className={
          big
            ? 'bubble big-emoji'
            : note
              ? 'bubble video-note-bubble'
              : photo || video
                ? msg.text
                  ? 'bubble has-photo'
                  : 'bubble has-photo only-photo'
                : 'bubble'
        }
        onContextMenu={onContext}
        onDoubleClick={(e) => onMenu(msg, e.clientX, e.clientY)}
        {...longPress}
      >
        {showSender && first && (
          <button
            className="msg-sender plain"
            style={nameColorStyle(sender?.nameColor) ?? { color: nameColor(msg.senderId) }}
            onClick={() => onOpenProfile(msg.senderId)}
          >
            {displayNameOf(sender, '…')}
            <Badges
              verified={sender?.verified}
              scam={sender?.scam}
              premium={isPremium(sender)}
              emoji={sender?.emojiStatus}
              developer={sender?.developer}
              founder={sender?.founder}
              size={14}
            />
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
              {msg.call.duration > 0 && (
                <div className="muted small">{formatDuration(msg.call.duration)}</div>
              )}
            </div>
            <Icon name={msg.call.video ? 'video' : 'phone'} size={20} />
            {meta}
          </div>
        ) : (
          <>
            {photo && <PhotoMedia media={photo} uploading={msg.uploading} />}
            {video && <VideoMedia media={video} uploading={msg.uploading} />}
            {note && (
              <div className="msg-note">
                <VideoNoteMedia media={note} uploading={msg.uploading} />
                {meta}
              </div>
            )}
            {file && <FileMedia media={file} uploading={msg.uploading} />}
            {voice ? (
              <div className="msg-voice">
                <VoiceMedia media={voice} own={own} />
                {!msg.text && meta}
              </div>
            ) : null}
            {msg.poll ? (
              <div className="msg-text">
                <PollView msg={msg} canVote />
                {meta}
              </div>
            ) : note ? null : msg.text || !msg.media || file ? (
              <div className="msg-text">
                <MessageText text={msg.text} highlight={search} />
                {meta}
              </div>
            ) : (
              (photo || video) && <div className="msg-photo-meta">{meta}</div>
            )}
          </>
        )}
        {reactions.length > 0 && (
          <div className="reactions">
            {reactions.map((r) => (
              <button
                key={r.emoji}
                className={r.mine ? 'reaction mine' : 'reaction'}
                onClick={() => onReact(msg, r.emoji)}
              >
                <span>{r.emoji}</span>
                <span>{formatCount(r.count)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});
