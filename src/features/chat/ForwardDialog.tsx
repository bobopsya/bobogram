import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Chat, Message } from '../../supabase/types';
import { useApp, useMe } from '../../app/store';
import { errorKey, openSavedChat } from '../../supabase/api';
import { queueMessage } from '../../app/outbox';
import { refreshChats } from '../../app/session';
import { displayNameOf, peekProfile } from '../../app/profiles';
import { Modal } from '../../ui/Modal';
import { Icon } from '../../ui/Icon';
import { Avatar } from '../../ui/Avatar';
import { ChatAvatar, useChatMeta } from '../chats/chatMeta';

function Row({ chat, onPick }: { chat: Chat; onPick: () => void }) {
  const meta = useChatMeta(chat);
  return (
    <button className="list-item" onClick={onPick}>
      <ChatAvatar meta={meta} size={42} />
      <div className="list-item-body">
        <div className="list-item-title ellipsis">{meta.title}</div>
      </div>
    </button>
  );
}

export function ForwardDialog({
  msg,
  fromChat,
  onClose,
}: {
  msg: Message;
  fromChat: Chat;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const me = useMe();
  const chats = useApp((s) => s.chats);
  const showToast = useApp((s) => s.showToast);
  const [q, setQ] = useState('');

  const targets = useMemo(
    () =>
      chats
        .filter((c) => c.type !== 'channel' || c.myRole === 'owner' || c.myRole === 'admin')
        .filter((c) => c.type !== 'private' || c.lastMessage)
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [chats],
  );
  const hasSaved = targets.some((c) => c.type === 'saved');

  const forward = (chatId: string) => {
    const original = msg.forwardedFrom ?? {
      senderName: displayNameOf(peekProfile(msg.senderId), '…'),
      chatTitle: fromChat.type === 'channel' ? fromChat.title : null,
    };
    queueMessage(
      { id: crypto.randomUUID(), chatId, text: msg.text, forwardedFrom: original, media: msg.media },
      me,
    );
    showToast(t('chat.forwardedDone'));
    onClose();
  };

  const toSaved = async () => {
    try {
      const id = await openSavedChat();
      refreshChats(0);
      forward(id);
    } catch (err) {
      showToast(t(errorKey(err)));
    }
  };

  const query = q.trim().toLowerCase();
  const titleOf = (c: Chat) =>
    c.type === 'saved'
      ? t('chats.savedMessages')
      : c.type === 'private'
        ? displayNameOf(peekProfile(c.otherId ?? ''), '')
        : (c.title ?? '');

  return (
    <Modal title={t('chat.forwardTo')} onClose={onClose}>
      <input
        className="input"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t('common.search')}
        autoFocus
      />
      <div className="modal-list">
        {!hasSaved && (!query || t('chats.savedMessages').toLowerCase().includes(query)) && (
          <button className="list-item" onClick={() => void toSaved()}>
            <Avatar name="" seed={me} icon="bookmark" size={42} />
            <div className="list-item-body">
              <div className="list-item-title">{t('chats.savedMessages')}</div>
            </div>
            <Icon name="forward" size={18} />
          </button>
        )}
        {targets
          .filter((c) => !query || titleOf(c).toLowerCase().includes(query))
          .map((c) => (
            <Row key={c.id} chat={c} onPick={() => forward(c.id)} />
          ))}
      </div>
    </Modal>
  );
}
