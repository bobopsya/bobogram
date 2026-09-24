import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Chat, Message } from '../../firebase/types';
import { useApp, useMe } from '../../app/store';
import { draftChat, sendMessage } from '../../firebase/db';
import { notifyMessage } from '../../firebase/messaging';
import { authErrorKey } from '../../firebase/auth';
import { displayNameOf, peekProfile } from '../../app/profiles';
import { savedChatId } from '../../lib/ids';
import { toMillis } from '../../lib/time';
import { Modal } from '../../ui/Modal';
import { ChatAvatar, useChatMeta } from '../chats/chatMeta';

function Row({ chat, me, onPick }: { chat: Chat; me: string; onPick: () => void }) {
  const meta = useChatMeta(chat, me);
  return (
    <button className="list-item" onClick={onPick}>
      <ChatAvatar meta={meta} size={42} />
      <div className="list-item-body">
        <div className="list-item-title ellipsis">{meta.title}</div>
      </div>
    </button>
  );
}

export function ForwardDialog({ msg, fromChat, onClose }: { msg: Message; fromChat: Chat; onClose: () => void }) {
  const { t } = useTranslation();
  const me = useMe();
  const chats = useApp((s) => s.chats);
  const showToast = useApp((s) => s.showToast);
  const [q, setQ] = useState('');

  const targets = useMemo(() => {
    const list = chats
      .filter((c) => c.type !== 'channel' || c.admins.includes(me))
      .sort((a, b) => toMillis(b.updatedAt) - toMillis(a.updatedAt));
    const savedId = savedChatId(me);
    if (!list.some((c) => c.id === savedId)) {
      list.unshift({
        id: savedId,
        type: 'saved',
        members: [me],
        admins: [],
        ownerId: null,
        title: null,
        avatar: null,
        description: '',
        inviteCode: null,
        lastMessage: null,
        updatedAt: null,
        createdAt: null,
        pinnedMessageIds: [],
        readBy: {},
      });
    }
    return list;
  }, [chats, me]);

  const forward = (target: Chat) => {
    const exists = chats.some((c) => c.id === target.id);
    const original = msg.forwardedFrom ?? {
      senderName: displayNameOf(peekProfile(msg.senderId), '…'),
      chatTitle: fromChat.type === 'channel' ? fromChat.title : null,
    };
    const { id, done } = sendMessage(
      target.id,
      me,
      { text: msg.text, forwardedFrom: original },
      exists ? null : draftChat(target.id, me),
    );
    done.then(() => notifyMessage(target.id, id)).catch((err) => showToast(t(authErrorKey(err))));
    showToast(t('chat.forwardedDone'));
    onClose();
  };

  const query = q.trim().toLowerCase();

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
        {targets
          .filter((c) => !query || (c.title ?? displayNameOf(peekProfile(c.members.find((m) => m !== me) ?? ''), '')).toLowerCase().includes(query) || (c.type === 'saved' && t('chats.savedMessages').toLowerCase().includes(query)))
          .map((c) => (
            <Row key={c.id} chat={c} me={me} onPick={() => forward(c)} />
          ))}
      </div>
    </Modal>
  );
}
