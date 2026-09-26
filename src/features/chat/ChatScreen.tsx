import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { stripMarkup } from '../../lib/markup';
import { useLocation, useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useApp, useMe } from '../../app/store';
import type { Chat, Message } from '../../supabase/types';
import {
  clearChatForMe,
  deleteMessage,
  editMessage,
  errorKey,
  markRead,
  markTopicRead,
  searchMessages,
  setChatTtl,
  setBlocked,
  setChatPrefs,
  setPinnedMessages,
  snippetOf,
  toggleReaction,
} from '../../supabase/api';
import { refreshBlocked, refreshChats } from '../../app/session';
import { discardFailed, queueMedia, queueMessage, retryFailed } from '../../app/outbox';
import {
  fileExt,
  FILE_MAX_BYTES,
  preparePhoto,
  readVideoMeta,
  type VideoNoteResult,
  type VoiceResult,
} from '../../lib/mediaFiles';
import { mediaLabel } from '../chats/chatMeta';
import { dayLabel, isReadByOthers, isSameDay, toDate } from '../../lib/time';
import { Icon } from '../../ui/Icon';
import { Menu, type MenuItem } from '../../ui/Menu';
import { Modal } from '../../ui/Modal';
import { FullScreenSpinner, PageHeader, Spinner } from '../../ui/misc';
import { useChat, useMessages } from './useChatData';
import { TopicList, useTopic } from './TopicList';
import { PollDialog } from './Poll';
import { ScheduleDialog, ScheduledList } from './Scheduled';
import { ChatHeader } from './ChatHeader';
import { MessageBubble } from './MessageBubble';
import { Composer, splitText } from './Composer';
import { EmojiPicker } from './EmojiPicker';
import { PinnedBar } from './PinnedBar';
import { ReportDialog } from './ReportDialog';
import { ChannelBoostDialog } from '../admin/ChannelBoostDialog';
import { ForwardDialog } from './ForwardDialog';
import { startCall } from '../calls/callStore';
import { BoostDialog } from '../admin/BoostDialog';
import { ScamWarning } from '../../ui/Badges';
import { useProfile } from '../../app/profiles';

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥', '👎', '🎉'];
const GROUP_GAP_MS = 5 * 60 * 1000;

export function ChatScreen() {
  const { chatId = '', topicId } = useParams();
  return <ChatView key={`${chatId}/${topicId ?? ''}`} chatId={chatId} topicParam={topicId} />;
}

function ChatView({ chatId, topicParam }: { chatId: string; topicParam?: string }) {
  const { t } = useTranslation();
  const me = useMe();
  const { chat, status } = useChat(chatId);

  if (status === 'loading') return <FullScreenSpinner />;
  if (!chat) {
    return (
      <div className="screen">
        <PageHeader title="" back="/" />
        <div className="empty-main">
          <span className="pill">{t('chat.chatNotFound')}</span>
        </div>
      </div>
    );
  }
  // Группа с темами: сначала список тем, переписка — внутри темы («general» — «Общее»).
  if (chat.forum && chat.type === 'group') {
    if (topicParam === undefined) return <TopicList chat={chat} />;
    return <ChatBody chat={chat} me={me} topic={topicParam === 'general' ? null : topicParam} />;
  }
  return <ChatBody chat={chat} me={me} />;
}

function ChatBody({ chat, me, topic }: { chat: Chat; me: string; topic?: string | null }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const profile = useApp((s) => s.profile);
  const blocked = useApp((s) => s.blocked);
  const showToast = useApp((s) => s.showToast);
  const { messages, hasMore, loaded, loadMore } = useMessages(chat.id, topic);
  const topicId = topic ?? null;
  const topicInfo = useTopic(chat.id, topic);

  const isMember = chat.myRole !== null;
  const isChatAdmin = chat.myRole === 'owner' || chat.myRole === 'admin';
  const moderatable = chat.type === 'group' || chat.type === 'channel';
  const isGlobalAdmin = profile?.role === 'admin';
  const topicClosed = !!topicInfo?.closed && !isChatAdmin && !isGlobalAdmin;
  const canPost = isMember && (chat.type !== 'channel' || isChatAdmin) && !topicClosed;
  const canPin = isMember && (!moderatable || isChatAdmin);
  const otherUid = chat.type === 'private' ? chat.otherId : null;
  const iBlocked = !!otherUid && blocked.includes(otherUid);
  const muted = chat.muted;

  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [menu, setMenu] = useState<{ msg: Message; x: number; y: number } | null>(null);
  const [headerMenu, setHeaderMenu] = useState<{ x: number; y: number } | null>(null);
  const [reactFor, setReactFor] = useState<Message | null>(null);
  const [deleting, setDeleting] = useState<Message | null>(null);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [forwarding, setForwarding] = useState<Message | null>(null);
  const [boosting, setBoosting] = useState<Message | null>(null);
  const [reporting, setReporting] = useState<Message | null>(null);
  const [channelBoostOpen, setChannelBoostOpen] = useState(false);
  const [pollOpen, setPollOpen] = useState(false);
  const [ttlMenu, setTtlMenu] = useState<MenuItem[] | null>(null);
  const [scheduleText, setScheduleText] = useState<string | null>(null);
  const [scheduledOpen, setScheduledOpen] = useState(false);
  const other = useProfile(chat.type === 'private' ? chat.otherId : null);
  const scam = chat.scam || (chat.type === 'private' && other?.scam === true);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [searchIdx, setSearchIdx] = useState(0);
  const [atBottom, setAtBottom] = useState(true);
  // Плавающая дата при прокрутке (вместо sticky: в Safari sticky в column-reverse съезжает).
  const [floatDate, setFloatDate] = useState<string | null>(null);
  const floatTimer = useRef<number | undefined>(undefined);
  const scrollFrame = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const pendingJump = useRef<{ id: string; tries: number } | null>(null);

  const visible = useMemo(
    () => messages.filter((m) => m.createdAt > chat.clearedAt && !m.deleted && !m.deletedFor.includes(me)),
    [messages, me, chat.clearedAt],
  );

  // ---------- прочитанность ----------
  const lastId = chat.lastMessage?.id;
  const needsRead = chat.unread > 0 || (chat.lastMessage?.createdAt ?? 0) > chat.lastReadAt;
  useEffect(() => {
    if (!isMember || !loaded || !lastId || !needsRead) return;
    const mark = () => {
      if (document.visibilityState === 'visible') {
        void markRead(chat.id)
          .then(() => refreshChats(0))
          .catch(() => undefined);
      }
    };
    mark();
    document.addEventListener('visibilitychange', mark);
    return () => document.removeEventListener('visibilitychange', mark);
  }, [isMember, loaded, lastId, needsRead, chat.id]);

  // Прочитанность темы: при открытии и при новых сообщениях, пока тема на экране.
  const lastVisibleId = messages[messages.length - 1]?.id;
  useEffect(() => {
    if (topic === undefined || !isMember || !loaded) return;
    const mark = () => {
      if (document.visibilityState === 'visible') void markTopicRead(chat.id, topic).catch(() => undefined);
    };
    mark();
    document.addEventListener('visibilitychange', mark);
    return () => document.removeEventListener('visibilitychange', mark);
  }, [topic, isMember, loaded, lastVisibleId, chat.id]);

  // ---------- подгрузка истории при прокрутке вверх ----------
  useEffect(() => {
    const el = topRef.current;
    if (!el || !hasMore) return;
    const io = new IntersectionObserver((entries) => entries[0].isIntersecting && loadMore(), {
      root: scrollRef.current,
      rootMargin: '400px 0px 0px 0px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loadMore, visible.length]);

  const scrollToBottom = useCallback((smooth = true) => {
    scrollRef.current?.scrollTo({ top: 0, behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  // ---------- переход к сообщению (ответ, закреп, поиск) ----------
  const jumpTo = useCallback(
    (id: string) => {
      const el = document.getElementById(`m-${id}`);
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        setHighlight(id);
        window.setTimeout(() => setHighlight((h) => (h === id ? null : h)), 1600);
        pendingJump.current = null;
      } else if (hasMore) {
        pendingJump.current = {
          id,
          tries: (pendingJump.current?.id === id ? pendingJump.current.tries : 0) + 1,
        };
        if (pendingJump.current.tries <= 10) void loadMore(100);
      }
    },
    [hasMore, loadMore],
  );

  useEffect(() => {
    const p = pendingJump.current;
    if (p) jumpTo(p.id);
  }, [visible, jumpTo]);

  // ---------- поиск по чату ----------
  const q = search.trim().toLowerCase();
  // По всей истории на сервере; пока ответа нет — по загруженным сообщениям.
  const [serverMatches, setServerMatches] = useState<string[] | null>(null);
  useEffect(() => {
    setServerMatches(null);
    if (q.length < 2) return;
    let cancelled = false;
    const timer = window.setTimeout(
      () =>
        void searchMessages(q, chat.id)
          .then((hits) => !cancelled && setServerMatches(hits.map((h) => h.id)))
          .catch(() => undefined),
      250,
    );
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [q, chat.id]);
  const matches = useMemo(
    () =>
      q
        ? (serverMatches ??
          visible
            .filter((m) => m.text.toLowerCase().includes(q))
            .map((m) => m.id)
            .reverse())
        : [],
    [visible, q, serverMatches],
  );

  // Переход к сообщению из глобального поиска.
  const location = useLocation();
  const jumpTarget = (location.state as { jump?: string } | null)?.jump;
  useEffect(() => {
    if (jumpTarget && loaded) {
      jumpTo(jumpTarget);
      navigate(location.pathname, { replace: true, state: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpTarget, loaded]);
  useEffect(() => setSearchIdx(0), [q]);
  useEffect(() => {
    if (matches[searchIdx]) jumpTo(matches[searchIdx]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchIdx, matches.length, q]);

  // ---------- действия ----------
  const fail = useCallback((err: unknown) => showToast(t(errorKey(err))), [showToast, t]);

  const send = (text: string) => {
    const reply = replyRef();
    splitText(text).forEach((part, i) => {
      queueMessage(
        { id: crypto.randomUUID(), chatId: chat.id, topicId, text: part, replyTo: i === 0 ? reply : null },
        me,
      );
    });
    setReplyTo(null);
    scrollToBottom(false);
  };

  const replyRef = () =>
    replyTo
      ? {
          id: replyTo.id,
          senderId: replyTo.senderId,
          snippet: snippetOf(stripMarkup(replyTo.text) || mediaLabel(replyTo, t), 80),
        }
      : null;

  const sendPhotos = async (files: File[], caption: string) => {
    const reply = replyRef();
    setReplyTo(null);
    for (const [i, file] of files.entries()) {
      try {
        if (file.type.startsWith('video/')) {
          if (file.size > FILE_MAX_BYTES) {
            showToast(t('media.tooBig'));
            continue;
          }
          const meta = await readVideoMeta(file);
          queueMedia(
            {
              id: crypto.randomUUID(),
              chatId: chat.id,
              topicId,
              text: i === 0 ? caption : '',
              replyTo: i === 0 ? reply : null,
              media: { kind: 'video', mime: file.type, ...meta },
            },
            file,
            fileExt(file),
            me,
          );
          continue;
        }
        const photo = await preparePhoto(file);
        queueMedia(
          {
            id: crypto.randomUUID(),
            chatId: chat.id,
            topicId,
            text: i === 0 ? caption : '',
            replyTo: i === 0 ? reply : null,
            media: { kind: 'photo', mime: 'image/jpeg', width: photo.width, height: photo.height },
          },
          photo.blob,
          'jpg',
          me,
        );
      } catch {
        showToast(t('media.badPhoto'));
      }
    }
    scrollToBottom(false);
  };

  const sendFile = (file: File) => {
    if (file.size > FILE_MAX_BYTES) {
      showToast(t('media.tooBig'));
      return;
    }
    queueMedia(
      {
        id: crypto.randomUUID(),
        chatId: chat.id,
        topicId,
        text: '',
        replyTo: replyRef(),
        media: { kind: 'file', mime: file.type || 'application/octet-stream', name: file.name.slice(0, 200) },
      },
      file,
      fileExt(file),
      me,
    );
    setReplyTo(null);
    scrollToBottom(false);
  };

  const sendVideoNote = (note: VideoNoteResult) => {
    queueMedia(
      {
        id: crypto.randomUUID(),
        chatId: chat.id,
        topicId,
        text: '',
        replyTo: replyRef(),
        media: { kind: 'video_note', mime: note.mime, duration: note.duration, width: 480, height: 480 },
      },
      note.blob,
      note.ext,
      me,
    );
    setReplyTo(null);
    scrollToBottom(false);
  };

  const sendVoice = (voice: VoiceResult) => {
    queueMedia(
      {
        id: crypto.randomUUID(),
        chatId: chat.id,
        topicId,
        text: '',
        replyTo: replyRef(),
        media: {
          kind: 'voice',
          mime: voice.mime,
          duration: Math.round(voice.duration * 10) / 10,
          waveform: voice.waveform,
        },
      },
      voice.blob,
      voice.ext,
      me,
    );
    setReplyTo(null);
    scrollToBottom(false);
  };

  const onMenu = useCallback((msg: Message, x: number, y: number) => setMenu({ msg, x, y }), []);
  const onReact = useCallback(
    (msg: Message, emoji: string) => {
      if (!msg.pending) void toggleReaction(msg.id, emoji).catch(fail);
    },
    [fail],
  );
  const openProfile = useCallback((uid: string) => navigate(`/profile/${uid}`), [navigate]);

  const editLast = () => {
    const mine = [...visible].reverse().find((m) => m.senderId === me && !m.system && !m.call && !m.pending);
    if (mine) setEditing(mine);
  };

  const togglePin = (msg: Message) => {
    const pinned = chat.pinnedMessageIds.includes(msg.id);
    const ids = pinned
      ? chat.pinnedMessageIds.filter((x) => x !== msg.id)
      : [...chat.pinnedMessageIds, msg.id];
    void setPinnedMessages(chat.id, ids)
      .then(() => refreshChats(0))
      .catch(fail);
  };

  const menuItems = (msg: Message): MenuItem[] => {
    const own = msg.senderId === me;
    const items: MenuItem[] = [];
    if (msg.pending) {
      if (msg.failed)
        items.push({ icon: 'flip', label: t('chat.retry'), onClick: () => retryFailed(msg.id) });
      if (msg.text) {
        items.push({
          icon: 'copy',
          label: t('chat.copy'),
          onClick: () =>
            void navigator.clipboard?.writeText(msg.text).then(() => showToast(t('common.copied'))),
        });
      }
      items.push({
        icon: 'trash',
        label: t('common.delete'),
        danger: true,
        onClick: () => discardFailed(msg.id),
      });
      return items;
    }
    if (canPost && !msg.call)
      items.push({ icon: 'reply', label: t('chat.reply'), onClick: () => setReplyTo(msg) });
    if (msg.text) {
      items.push({
        icon: 'copy',
        label: t('chat.copy'),
        onClick: () =>
          void navigator.clipboard?.writeText(msg.text).then(() => showToast(t('common.copied'))),
      });
    }
    if (msg.text)
      items.push({ icon: 'forward', label: t('chat.forward'), onClick: () => setForwarding(msg) });
    if (canPin) {
      const pinned = chat.pinnedMessageIds.includes(msg.id);
      items.push({
        icon: 'pin',
        label: pinned ? t('chat.unpin') : t('chat.pin'),
        onClick: () => togglePin(msg),
      });
    }
    if (own && !msg.call && isMember)
      items.push({ icon: 'edit', label: t('chat.edit'), onClick: () => setEditing(msg) });
    if (isGlobalAdmin && moderatable && !msg.system) {
      items.push({ icon: 'star', label: t('admin.boostPost'), onClick: () => setBoosting(msg) });
    }
    if (!own && !msg.system && !msg.pending && msg.senderId !== me) {
      items.push({ icon: 'flag', label: t('report.action'), onClick: () => setReporting(msg) });
    }
    items.push({ icon: 'trash', label: t('common.delete'), danger: true, onClick: () => setDeleting(msg) });
    return items;
  };

  const canDeleteForAll = (msg: Message) =>
    msg.senderId === me || (moderatable && (isChatAdmin || isGlobalAdmin));

  const headerItems: MenuItem[] = [];
  const setMuted = (m: boolean) => void setChatPrefs(chat.id, { muted: m }).then(() => refreshChats(0));
  const block = (b: boolean) => void setBlocked(otherUid!, b).then(refreshBlocked).catch(fail);
  if (isMember && chat.type !== 'saved') {
    headerItems.push(
      muted
        ? { icon: 'bell', label: t('chats.unmute'), onClick: () => setMuted(false) }
        : { icon: 'bellOff', label: t('chats.mute'), onClick: () => setMuted(true) },
    );
  }
  if (isMember) {
    headerItems.push({
      icon: 'trash',
      label: t('chat.clearForMe'),
      danger: true,
      onClick: () => setClearConfirm(true),
    });
  }
  if (chat.type === 'channel' && isGlobalAdmin) {
    headerItems.push({ icon: 'star', label: t('boost.menu'), onClick: () => setChannelBoostOpen(true) });
  }
  headerItems.push({ icon: 'search', label: t('chat.searchInChat'), onClick: () => setSearchOpen(true) });
  if (isMember && chat.type !== 'saved' && (chat.type === 'private' || isChatAdmin)) {
    headerItems.push({
      icon: 'timer',
      label: t('ttl.menu'),
      onClick: () =>
        setTtlMenu([
          { icon: 'close', label: t('ttl.off'), onClick: () => void setChatTtl(chat.id, null).catch(fail) },
          ...[86400, 604800, 2592000].map((s) => ({
            icon: 'timer' as const,
            label: t(`ttl.s${s}`),
            onClick: () => void setChatTtl(chat.id, s).catch(fail),
          })),
        ]),
    });
  }
  if (canPost) {
    headerItems.push({ icon: 'clock', label: t('schedule.list'), onClick: () => setScheduledOpen(true) });
  }
  if (moderatable)
    headerItems.push({ icon: 'users', label: t('chat.info'), onClick: () => navigate(`/c/${chat.id}/info`) });
  if (otherUid) {
    headerItems.push({
      icon: 'video',
      label: t('chat.callVideo'),
      onClick: () => startCall(chat.id, otherUid, true),
    });
    headerItems.push({
      icon: 'user',
      label: t('profile.title'),
      onClick: () => navigate(`/profile/${otherUid}`),
    });
    headerItems.push(
      iBlocked
        ? { icon: 'ban', label: t('profile.unblock'), onClick: () => block(false) }
        : { icon: 'ban', label: t('profile.block'), danger: true, onClick: () => block(true) },
    );
  }

  // ---------- строки списка ----------
  const dateText = useCallback(
    (d: Date) => {
      const label = dayLabel(d, i18n.language);
      return label.kind === 'today'
        ? t('chat.today')
        : label.kind === 'yesterday'
          ? t('chat.yesterday')
          : label.text;
    },
    [i18n.language, t],
  );

  const onListScroll = (el: HTMLDivElement) => {
    const bottomNow = el.scrollTop > -120;
    setAtBottom(bottomNow);
    window.clearTimeout(floatTimer.current);
    floatTimer.current = window.setTimeout(() => setFloatDate(null), 1200);
    if (bottomNow) {
      setFloatDate(null);
      return;
    }
    if (scrollFrame.current) return;
    scrollFrame.current = requestAnimationFrame(() => {
      scrollFrame.current = 0;
      const top = el.getBoundingClientRect().top;
      let best: { top: number; date: number } | null = null;
      for (const row of el.querySelectorAll<HTMLElement>('[data-date]')) {
        const r = row.getBoundingClientRect();
        if (r.bottom > top + 4 && (!best || r.top < best.top))
          best = { top: r.top, date: Number(row.dataset.date) };
      }
      const d = best ? toDate(best.date) : null;
      setFloatDate(d ? dateText(d) : null);
    });
  };
  useEffect(() => () => window.clearTimeout(floatTimer.current), []);

  const rows = useMemo(() => {
    const out: {
      key: string;
      node: 'date' | 'msg';
      label?: string;
      msg?: Message;
      first?: boolean;
      last?: boolean;
    }[] = [];
    visible.forEach((m, i) => {
      const prev = visible[i - 1];
      const next = visible[i + 1];
      const d = toDate(m.createdAt) ?? new Date();
      const pd = prev ? (toDate(prev.createdAt) ?? new Date()) : null;
      if (!pd || !isSameDay(d, pd)) {
        out.push({ key: `d-${m.id}`, node: 'date', label: dateText(d) });
      }
      const sameAsPrev =
        !!prev &&
        !prev.system &&
        prev.senderId === m.senderId &&
        pd !== null &&
        isSameDay(d, pd) &&
        m.createdAt - prev.createdAt < GROUP_GAP_MS;
      const nd = next ? toDate(next.createdAt) : null;
      const sameAsNext =
        !!next &&
        !next.system &&
        next.senderId === m.senderId &&
        !!nd &&
        isSameDay(d, nd) &&
        next.createdAt - m.createdAt < GROUP_GAP_MS;
      out.push({ key: m.id, node: 'msg', msg: m, first: !sameAsPrev, last: !sameAsNext });
    });
    return out.reverse();
  }, [visible, dateText]);

  // ---------- нижняя панель ----------
  let bottom: ReactNode;
  if (!isMember) {
    bottom = <div className="bottom-bar muted">{t('chat.notMember')}</div>;
  } else if (iBlocked) {
    bottom = (
      <button className="bottom-bar btn-text" onClick={() => block(false)}>
        {t('chat.unblock')}
      </button>
    );
  } else if (other?.dmVerifiedOnly && !profile?.verified && profile?.role !== 'admin') {
    bottom = <div className="bottom-bar muted">{t('chat.verifiedOnly')}</div>;
  } else if (topicClosed) {
    bottom = <div className="bottom-bar muted">{t('topics.closedBar')}</div>;
  } else if (!canPost) {
    bottom = (
      <button className="bottom-bar btn-text" onClick={() => setMuted(!muted)}>
        {muted ? t('chats.unmute') : t('chats.mute')}
      </button>
    );
  } else {
    bottom = (
      <Composer
        chatId={chat.id}
        me={me}
        replyTo={replyTo}
        editing={editing}
        onCancelReply={() => setReplyTo(null)}
        onCancelEdit={() => setEditing(null)}
        onSend={send}
        onEdit={(msg, text) => void editMessage(msg.id, text).catch(fail)}
        onEditLast={editLast}
        onSendPhotos={(files, caption) => void sendPhotos(files, caption)}
        onSendVoice={sendVoice}
        onSendFile={sendFile}
        onSendVideoNote={sendVideoNote}
        onSchedule={(text) => setScheduleText(text)}
        mentions={chat.type === 'group'}
        attachItems={
          moderatable ? [{ icon: 'poll', label: t('poll.new'), onClick: () => setPollOpen(true) }] : []
        }
      />
    );
  }

  return (
    <div className="screen chat-screen">
      <ChatHeader
        chat={chat}
        me={me}
        topic={
          topic === undefined
            ? undefined
            : {
                title: topicInfo?.title ?? t('topics.general'),
                emoji: topicInfo?.emoji ?? (topic ? null : '#'),
              }
        }
        onSearch={() => setSearchOpen(true)}
        onCall={(video) => otherUid && startCall(chat.id, otherUid, video)}
        onClear={isMember ? () => setClearConfirm(true) : undefined}
        onMenu={(x, y) => setHeaderMenu({ x, y })}
      />

      {searchOpen && (
        <div className="chat-search">
          <Icon name="search" size={18} />
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('chat.searchInChat')}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setSearchIdx((i) => Math.min(i + 1, Math.max(matches.length - 1, 0)));
              if (e.key === 'Escape') setSearchOpen(false);
            }}
          />
          <span className="muted small nowrap">
            {q
              ? matches.length
                ? t('chat.matchOf', { current: searchIdx + 1, total: matches.length })
                : t('chat.noMatches')
              : ''}
          </span>
          {hasMore && q && (
            <button className="btn btn-text small" onClick={() => void loadMore(200)}>
              <Icon name="download" size={16} />
            </button>
          )}
          <button
            className="icon-btn small"
            disabled={searchIdx >= matches.length - 1}
            onClick={() => setSearchIdx((i) => i + 1)}
          >
            <Icon name="up" size={18} />
          </button>
          <button
            className="icon-btn small"
            disabled={searchIdx <= 0}
            onClick={() => setSearchIdx((i) => i - 1)}
          >
            <Icon name="down" size={18} />
          </button>
          <button
            className="icon-btn small"
            onClick={() => {
              setSearchOpen(false);
              setSearch('');
            }}
          >
            <Icon name="close" size={18} />
          </button>
        </div>
      )}

      {scam && <ScamWarning />}

      {chat.pinnedMessageIds.length > 0 && <PinnedBar chat={chat} canUnpin={canPin} onJump={jumpTo} />}

      <div className="messages-wrap">
        {floatDate && <span className="pill floating-date">{floatDate}</span>}
        <div className="messages" ref={scrollRef} onScroll={(e) => onListScroll(e.currentTarget)}>
          {rows.map((row) =>
            row.node === 'date' ? (
              <div key={row.key} className="msg-row system date-sep">
                <span className="pill">{row.label}</span>
              </div>
            ) : (
              <Fragment key={row.key}>
                <MessageBubble
                  msg={row.msg!}
                  me={me}
                  chatType={chat.type}
                  read={isReadByOthers(row.msg!.createdAt, chat.othersReadAt)}
                  first={row.first!}
                  last={row.last!}
                  highlighted={highlight === row.msg!.id}
                  search={q || undefined}
                  onMenu={onMenu}
                  onReact={onReact}
                  onJump={jumpTo}
                  onOpenProfile={openProfile}
                />
              </Fragment>
            ),
          )}
          {loaded && visible.length === 0 && (
            <div className="msg-row system">
              <span className="pill">{chat.type === 'saved' ? t('chats.savedHint') : t('chat.empty')}</span>
            </div>
          )}
          <div ref={topRef} className="history-sentinel">
            {(hasMore || !loaded) && <Spinner size={22} />}
          </div>
        </div>
      </div>

      {!atBottom && (
        <button className="fab to-bottom" onClick={() => scrollToBottom()} aria-label={t('chat.toBottom')}>
          <Icon name="down" />
        </button>
      )}

      {bottom}

      {menu && (
        <Menu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={menuItems(menu.msg)}
          header={
            !menu.msg.call && isMember ? (
              <div className="quick-reactions">
                {QUICK_REACTIONS.map((e) => (
                  <button
                    key={e}
                    onClick={() => {
                      onReact(menu.msg, e);
                      setMenu(null);
                    }}
                  >
                    {e}
                  </button>
                ))}
                <button
                  aria-label={t('chat.moreEmoji')}
                  onClick={() => {
                    setReactFor(menu.msg);
                    setMenu(null);
                  }}
                >
                  <Icon name="plus" size={18} />
                </button>
              </div>
            ) : undefined
          }
        />
      )}

      {headerMenu && (
        <Menu x={headerMenu.x} y={headerMenu.y} items={headerItems} onClose={() => setHeaderMenu(null)} />
      )}

      {reactFor && (
        <Modal title={t('chat.reactions')} onClose={() => setReactFor(null)}>
          <EmojiPicker
            onPick={(e) => {
              onReact(reactFor, e);
              setReactFor(null);
            }}
          />
        </Modal>
      )}

      {deleting && (
        <Modal onClose={() => setDeleting(null)} title={t('chat.deleteTitle')}>
          <div className="stack">
            {canDeleteForAll(deleting) && (
              <button
                className="btn btn-danger btn-block"
                onClick={() => {
                  void deleteMessage(deleting.id, true).catch(fail);
                  setDeleting(null);
                }}
              >
                {chat.type === 'saved' ? t('common.delete') : t('chat.deleteForAll')}
              </button>
            )}
            {chat.type !== 'saved' && isMember && (
              <button
                className="btn btn-block"
                onClick={() => {
                  void deleteMessage(deleting.id, false).catch(fail);
                  setDeleting(null);
                }}
              >
                {t('chat.deleteForMe')}
              </button>
            )}
            <button className="btn btn-text btn-block" onClick={() => setDeleting(null)}>
              {t('common.cancel')}
            </button>
          </div>
        </Modal>
      )}

      {clearConfirm && (
        <Modal onClose={() => setClearConfirm(false)} title={t('chat.clearTitle')}>
          <div className="stack">
            <p className="confirm-text">{t('chat.clearConfirm')}</p>
            <button
              className="btn btn-danger btn-block"
              onClick={() => {
                void clearChatForMe(chat.id)
                  .then(() => refreshChats(0))
                  .catch(fail);
                setClearConfirm(false);
              }}
            >
              {t('chat.clearForMe')}
            </button>
            <button className="btn btn-text btn-block" onClick={() => setClearConfirm(false)}>
              {t('common.cancel')}
            </button>
          </div>
        </Modal>
      )}

      {boosting && <BoostDialog msg={boosting} onClose={() => setBoosting(null)} />}
      {reporting && <ReportDialog messageId={reporting.id} onClose={() => setReporting(null)} />}
      {ttlMenu && headerMenu === null && (
        <Menu x={window.innerWidth - 240} y={64} items={ttlMenu} onClose={() => setTtlMenu(null)} />
      )}
      {scheduleText !== null && (
        <ScheduleDialog
          chatId={chat.id}
          topicId={topicId}
          text={scheduleText}
          onClose={() => setScheduleText(null)}
        />
      )}
      {scheduledOpen && <ScheduledList chatId={chat.id} onClose={() => setScheduledOpen(false)} />}
      {pollOpen && <PollDialog chatId={chat.id} topicId={topicId} onClose={() => setPollOpen(false)} />}
      {channelBoostOpen && (
        <ChannelBoostDialog
          chatId={chat.id}
          title={chat.title ?? ''}
          onClose={() => {
            setChannelBoostOpen(false);
            void refreshChats(0);
          }}
        />
      )}
      {forwarding && <ForwardDialog msg={forwarding} fromChat={chat} onClose={() => setForwarding(null)} />}
    </div>
  );
}
