import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Message } from '../../supabase/types';
import {
  addComment,
  deleteComment,
  errorKey,
  fetchComments,
  toComment,
  type PostComment,
} from '../../supabase/api';
import { onDbEvent } from '../../supabase/realtime';
import { displayNameOf, useProfile } from '../../app/profiles';
import { useApp, useMe } from '../../app/store';
import { formatTime, toDate } from '../../lib/time';
import { stripMarkup } from '../../lib/markup';
import { Avatar } from '../../ui/Avatar';
import { Icon } from '../../ui/Icon';
import { Modal } from '../../ui/Modal';
import { MessageText } from './MessageText';

function CommentRow({ c, canDelete }: { c: PostComment; canDelete: boolean }) {
  const { i18n, t } = useTranslation();
  const p = useProfile(c.senderId);
  const showToast = useApp((s) => s.showToast);
  const d = toDate(c.createdAt);
  return (
    <div className={c.deleted ? 'comment deleted' : 'comment'}>
      <Avatar name={displayNameOf(p, '?')} seed={c.senderId} src={p?.avatar} size={34} />
      <div className="comment-body">
        <div className="comment-head">
          <span className="comment-name">{displayNameOf(p, '…')}</span>
          <span className="muted small">{d ? formatTime(d, i18n.language) : ''}</span>
        </div>
        <div className="comment-text">
          {c.deleted ? t('chats.deletedMessage') : <MessageText text={c.text} />}
        </div>
      </div>
      {canDelete && !c.deleted && (
        <button
          className="icon-btn small"
          aria-label={t('common.delete')}
          onClick={() => void deleteComment(c.id).catch((e: unknown) => showToast(t(errorKey(e))))}
        >
          <Icon name="trash" size={16} />
        </button>
      )}
    </div>
  );
}

/** Комментарии к посту канала: лента и поле ввода, обновляются в реальном времени. */
export function CommentsSheet({
  post,
  isAdmin,
  onClose,
}: {
  post: Message;
  isAdmin: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const me = useMe();
  const showToast = useApp((s) => s.showToast);
  const [list, setList] = useState<PostComment[] | null>(null);
  const [text, setText] = useState('');
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void fetchComments(post.id)
      .then(setList)
      .catch(() => setList([]));
    return onDbEvent((e) => {
      if (e.table !== 'post_comments' || e.row.post_id !== post.id) return;
      const c = toComment(e.row);
      setList((l) => {
        const rest = (l ?? []).filter((x) => x.id !== c.id);
        return [...rest, c].sort((a, b) => a.createdAt - b.createdAt);
      });
    });
  }, [post.id]);

  useEffect(() => bottom.current?.scrollIntoView({ block: 'end' }), [list?.length]);

  const send = () => {
    const v = text.trim();
    if (!v) return;
    setText('');
    void addComment(post.id, v).catch((e: unknown) => {
      setText(v);
      showToast(t(errorKey(e)));
    });
  };

  return (
    <Modal
      title={t('comments.title', { count: list?.filter((c) => !c.deleted).length ?? 0 })}
      onClose={onClose}
      wide
    >
      <div className="comments">
        <blockquote className="md-quote comments-post">
          {stripMarkup(post.text).slice(0, 300) || '…'}
        </blockquote>
        {list && list.length === 0 && <p className="muted center">{t('comments.empty')}</p>}
        {list?.map((c) => (
          <CommentRow key={c.id} c={c} canDelete={c.senderId === me || isAdmin} />
        ))}
        <div ref={bottom} />
      </div>
      <div className="comments-input row gap">
        <input
          className="input grow"
          value={text}
          maxLength={4096}
          placeholder={t('comments.placeholder')}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && send()}
        />
        <button
          className="icon-btn send-btn"
          onClick={send}
          disabled={!text.trim()}
          aria-label={t('chat.send')}
        >
          <Icon name="send" />
        </button>
      </div>
    </Modal>
  );
}
