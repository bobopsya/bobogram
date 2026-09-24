import { useEffect, useState } from 'react';
import { onSnapshot } from 'firebase/firestore';
import { useTranslation } from 'react-i18next';
import type { Chat, Message } from '../../firebase/types';
import { messageRef, setPinnedMessages, toMessage } from '../../firebase/db';
import { Icon } from '../../ui/Icon';

/** Плашка закреплённого сообщения; клик перебирает закрепы от новых к старым. */
export function PinnedBar({ chat, canUnpin, onJump }: { chat: Chat; canUnpin: boolean; onJump: (id: string) => void }) {
  const { t } = useTranslation();
  const ids = chat.pinnedMessageIds;
  const [index, setIndex] = useState(ids.length - 1);
  const safeIndex = Math.min(Math.max(index, 0), ids.length - 1);
  const id = ids[safeIndex];
  const [msg, setMsg] = useState<Message | null>(null);

  useEffect(() => setIndex(ids.length - 1), [ids.length]);

  useEffect(() => {
    if (!id) return;
    return onSnapshot(
      messageRef(chat.id, id),
      (snap) => setMsg(snap.exists() ? toMessage(snap) : null),
      () => setMsg(null),
    );
  }, [chat.id, id]);

  if (!id) return null;
  const text = msg?.deleted ? t('chats.deletedMessage') : (msg?.text ?? '…');

  return (
    <div className="pinned-bar">
      <button
        className="pinned-main plain"
        onClick={() => {
          onJump(id);
          setIndex((i) => (i <= 0 ? ids.length - 1 : i - 1));
        }}
      >
        <div className="pinned-line" />
        <div className="pinned-body">
          <div className="accent-text small">
            {ids.length > 1 ? t('chat.pinnedN', { n: safeIndex + 1 }) : t('chat.pinned')}
          </div>
          <div className="ellipsis">{text}</div>
        </div>
      </button>
      {canUnpin && (
        <button
          className="icon-btn small"
          aria-label={t('chat.unpin')}
          onClick={() => void setPinnedMessages(chat.id, ids.filter((x) => x !== id))}
        >
          <Icon name="close" size={18} />
        </button>
      )}
    </div>
  );
}
