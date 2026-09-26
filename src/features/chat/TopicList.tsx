import { useEffect, useState, type MouseEvent } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { Chat, Topic } from '../../supabase/types';
import { createTopic, deleteTopic, editTopic, errorKey, fetchTopics } from '../../supabase/api';
import { onDbEvent, onResync } from '../../supabase/realtime';
import { useApp, useMe } from '../../app/store';
import { displayNameOf, useProfile } from '../../app/profiles';
import { formatChatListTime, toDate } from '../../lib/time';
import { Icon } from '../../ui/Icon';
import { Menu, type MenuItem } from '../../ui/Menu';
import { Confirm, Modal } from '../../ui/Modal';
import { Spinner } from '../../ui/misc';
import { useLongPress } from '../../ui/useLongPress';
import { ChatAvatar, mediaLabel, systemText, useChatMeta } from '../chats/chatMeta';

const TOPIC_EMOJIS = [
  '💬',
  '📢',
  '🎮',
  '🎵',
  '🎬',
  '📚',
  '💡',
  '🔥',
  '❤️',
  '😂',
  '⚽',
  '🍕',
  '✈️',
  '💻',
  '🎨',
  '📷',
];

/** Темы группы: грузятся с сервера и обновляются при новых сообщениях и правках тем. */
export function useTopics(chatId: string, enabled = true): Topic[] | null {
  const [topics, setTopics] = useState<Topic[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: number | undefined;
    const load = () =>
      void fetchTopics(chatId)
        .then((list) => !cancelled && setTopics(list))
        .catch(() => undefined);
    const soon = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(load, 250);
    };
    load();
    const off = onDbEvent((e) => {
      const id = e.row.chat_id ?? e.old.chat_id;
      if ((e.table === 'topics' || e.table === 'messages') && id === chatId) soon();
      if (e.table === 'topics' && e.type === 'DELETE') soon();
    });
    const offResync = onResync(load);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      off();
      offResync();
    };
  }, [chatId, enabled]);
  return topics;
}

/** Текущая тема открытого чата (undefined — чат без тем). */
export function useTopic(chatId: string, topic: string | null | undefined): Topic | null {
  const topics = useTopics(chatId, topic !== undefined);
  if (topic === undefined || !topics) return null;
  return topics.find((x) => x.id === topic) ?? null;
}

function TopicRow({
  chat,
  topic,
  onMenu,
}: {
  chat: Chat;
  topic: Topic;
  onMenu?: (x: number, y: number) => void;
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const me = useMe();
  const last = topic.lastMessage;
  const sender = useProfile(last && !last.system && last.senderId !== me ? last.senderId : null);
  const longPress = useLongPress((x, y) => onMenu?.(x, y));

  let preview = '';
  if (last) {
    if (last.system) preview = systemText(last.system, last.senderId, t, me);
    else if (last.media) preview = last.text ? `${mediaLabel(last, t)}, ${last.text}` : mediaLabel(last, t);
    else preview = last.text;
  }
  const prefix =
    last && !last.system ? (last.senderId === me ? t('common.you') : displayNameOf(sender, '…')) + ': ' : '';
  const date = toDate(last?.createdAt ?? topic.createdAt);

  return (
    <button
      className="list-item chat-item"
      onClick={() => navigate(`/c/${chat.id}/t/${topic.id ?? 'general'}`)}
      onContextMenu={(e: MouseEvent) => {
        if (!onMenu) return;
        e.preventDefault();
        onMenu(e.clientX, e.clientY);
      }}
      {...(onMenu ? longPress : {})}
    >
      <span className="topic-icon">{topic.id ? (topic.emoji ?? '💬') : '#'}</span>
      <div className="list-item-body">
        <div className="list-item-row">
          <span className="list-item-title">
            <span className="ellipsis">{topic.id ? topic.title : t('topics.general')}</span>
            {topic.closed && <Icon name="lock" size={14} className="muted-icon" />}
          </span>
          <span className="list-item-time">{date ? formatChatListTime(date, i18n.language) : ''}</span>
        </div>
        <div className="list-item-row">
          <span className="list-item-sub ellipsis">
            {prefix && <span className="accent-text">{prefix}</span>}
            {preview || t('chats.noMessages')}
          </span>
          {topic.unread > 0 && (
            <span className={chat.muted ? 'badge muted' : 'badge'}>
              {topic.unread > 999 ? '999+' : topic.unread}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

function TopicDialog({
  chatId,
  topic,
  onClose,
}: {
  chatId: string;
  topic: Topic | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const showToast = useApp((s) => s.showToast);
  const [title, setTitle] = useState(topic?.title ?? '');
  const [emoji, setEmoji] = useState<string>(topic?.emoji ?? TOPIC_EMOJIS[0]);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      if (topic?.id) {
        await editTopic(topic.id, title.trim(), emoji, topic.closed);
        onClose();
      } else {
        const id = await createTopic(chatId, title.trim(), emoji);
        onClose();
        navigate(`/c/${chatId}/t/${id}`);
      }
    } catch (e) {
      showToast(t(errorKey(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={topic ? t('topics.edit') : t('topics.new')}
      onClose={onClose}
      footer={
        <button className="btn btn-primary" disabled={busy || !title.trim()} onClick={() => void save()}>
          {topic ? t('common.save') : t('topics.create')}
        </button>
      }
    >
      <div className="stack">
        <div className="topic-emoji-grid">
          {TOPIC_EMOJIS.map((e) => (
            <button
              key={e}
              className={e === emoji ? 'topic-emoji active' : 'topic-emoji'}
              onClick={() => setEmoji(e)}
              aria-label={e}
            >
              {e}
            </button>
          ))}
        </div>
        <label className="field">
          <span className="field-label">{t('topics.name')}</span>
          <input
            className="input"
            autoFocus
            maxLength={64}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && title.trim() && void save()}
            placeholder={t('topics.namePlaceholder')}
          />
        </label>
      </div>
    </Modal>
  );
}

/** Экран группы с темами: список тем, как в Telegram. */
export function TopicList({ chat }: { chat: Chat }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const meta = useChatMeta(chat);
  const showToast = useApp((s) => s.showToast);
  const isGlobalAdmin = useApp((s) => s.profile?.role === 'admin');
  const canManage = chat.myRole === 'owner' || chat.myRole === 'admin' || isGlobalAdmin;
  const topics = useTopics(chat.id);
  const [dialog, setDialog] = useState<{ topic: Topic | null } | null>(null);
  const [menu, setMenu] = useState<{ topic: Topic; x: number; y: number } | null>(null);
  const [deleting, setDeleting] = useState<Topic | null>(null);
  const fail = (e: unknown) => showToast(t(errorKey(e)));

  const menuItems = (topic: Topic): MenuItem[] => [
    { icon: 'edit', label: t('topics.edit'), onClick: () => setDialog({ topic }) },
    {
      icon: 'lock',
      label: topic.closed ? t('topics.reopen') : t('topics.close'),
      onClick: () => void editTopic(topic.id!, topic.title ?? '', topic.emoji, !topic.closed).catch(fail),
    },
    { icon: 'trash', label: t('topics.delete'), danger: true, onClick: () => setDeleting(topic) },
  ];

  return (
    <div className="screen">
      <header className="topbar chat-header">
        <button className="icon-btn back-btn" onClick={() => navigate('/')} aria-label={t('common.back')}>
          <Icon name="back" />
        </button>
        <button className="chat-header-main plain" onClick={() => navigate(`/c/${chat.id}/info`)}>
          <ChatAvatar meta={meta} size={40} />
          <div className="chat-header-text">
            <div className="chat-header-title">
              <span className="ellipsis">{meta.title}</span>
            </div>
            <div className="chat-header-sub">
              {t('topics.count', { count: topics ? topics.length : 0 })} ·{' '}
              {t('chats.members', { count: chat.memberCount })}
            </div>
          </div>
        </button>
        {canManage && (
          <button
            className="icon-btn"
            onClick={() => setDialog({ topic: null })}
            aria-label={t('topics.new')}
          >
            <Icon name="plus" />
          </button>
        )}
      </header>
      <div className="scroll">
        {!topics ? (
          <div className="center-pad">
            <Spinner />
          </div>
        ) : (
          <div className="topic-list">
            {topics.map((topic) => (
              <TopicRow
                key={topic.id ?? 'general'}
                chat={chat}
                topic={topic}
                onMenu={canManage && topic.id ? (x, y) => setMenu({ topic, x, y }) : undefined}
              />
            ))}
            {canManage && topics.length === 1 && (
              <p className="muted small center topic-hint">{t('topics.emptyHint')}</p>
            )}
          </div>
        )}
      </div>
      {dialog && <TopicDialog chatId={chat.id} topic={dialog.topic} onClose={() => setDialog(null)} />}
      {menu && <Menu x={menu.x} y={menu.y} items={menuItems(menu.topic)} onClose={() => setMenu(null)} />}
      {deleting && (
        <Confirm
          text={t('topics.deleteConfirm', { title: deleting.title })}
          confirmLabel={t('common.delete')}
          cancelLabel={t('common.cancel')}
          danger
          onConfirm={() => void deleteTopic(deleting.id!).catch(fail)}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
