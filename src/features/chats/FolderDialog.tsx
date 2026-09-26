import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Chat } from '../../supabase/types';
import { errorKey, saveFolder, type ChatFolder } from '../../supabase/api';
import { useApp } from '../../app/store';
import { Modal } from '../../ui/Modal';
import { ChatAvatar, useChatMeta } from './chatMeta';

function ChatCheck({ chat, checked, onToggle }: { chat: Chat; checked: boolean; onToggle: () => void }) {
  const meta = useChatMeta(chat);
  return (
    <label className="list-item folder-chat">
      <input type="checkbox" checked={checked} onChange={onToggle} />
      <ChatAvatar meta={meta} size={36} />
      <span className="ellipsis">{meta.title}</span>
    </label>
  );
}

/** Своя папка: название и чаты в ней. */
export function FolderDialog({
  folder,
  chats,
  onClose,
  onSaved,
}: {
  folder: ChatFolder | null;
  chats: Chat[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const showToast = useApp((s) => s.showToast);
  const [title, setTitle] = useState(folder?.title ?? '');
  const [ids, setIds] = useState<string[]>(folder?.chatIds ?? []);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await saveFolder({ id: folder?.id, title: title.trim(), chatIds: ids });
      onSaved();
      onClose();
    } catch (e) {
      showToast(t(errorKey(e)));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={folder ? t('folders.edit') : t('folders.new')}
      onClose={onClose}
      footer={
        <button className="btn btn-primary" disabled={busy || !title.trim()} onClick={() => void save()}>
          {t('common.save')}
        </button>
      }
    >
      <label className="field">
        <span className="field-label">{t('folders.name')}</span>
        <input value={title} maxLength={24} onChange={(e) => setTitle(e.target.value)} autoFocus />
      </label>
      <div className="field-label">{t('folders.chats', { count: ids.length })}</div>
      <div className="folder-chats">
        {chats.map((c) => (
          <ChatCheck
            key={c.id}
            chat={c}
            checked={ids.includes(c.id)}
            onToggle={() => setIds((l) => (l.includes(c.id) ? l.filter((x) => x !== c.id) : [...l, c.id]))}
          />
        ))}
      </div>
    </Modal>
  );
}
