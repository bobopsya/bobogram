import { createPortal } from 'react-dom';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp, useMe } from '../../app/store';
import { createStory, deleteStory, errorKey, fetchActiveStories, markStoryViewed } from '../../supabase/api';
import type { Story } from '../../supabase/types';
import { uploadMedia, useMediaUrl } from '../../supabase/media';
import { preparePhoto } from '../../lib/mediaFiles';
import { Avatar } from '../../ui/Avatar';
import { Icon } from '../../ui/Icon';
import { displayNameOf, useProfile } from '../../app/profiles';

/**
 * Сторис как в Telegram: лента кружков над чатами, цветное кольцо у непросмотренных,
 * просмотр — карточка по центру на ПК и весь экран на телефоне, 5 секунд на фото.
 */
const STORY_MS = 5000;

// ---------- общий кэш всех активных сторис ----------
let all: Story[] = [];
let loaded = false;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function refreshStories(): Promise<void> {
  loading ??= fetchActiveStories()
    .then((list) => {
      all = list;
      loaded = true;
      emit();
    })
    .catch(() => undefined)
    .finally(() => {
      loading = null;
    });
  return loading;
}

function markViewedLocal(id: string) {
  all = all.map((s) => (s.id === id ? { ...s, viewed: true } : s));
  emit();
}

function subscribe(l: () => void) {
  listeners.add(l);
  if (!loaded) void refreshStories();
  return () => listeners.delete(l);
}

function useAllStories(): Story[] {
  return useSyncExternalStore(subscribe, () => all);
}

/** Сторис автора (по времени) и есть ли непросмотренные. */
export function useAuthorStories(authorId: string | null | undefined) {
  const list = useAllStories();
  return useMemo(() => {
    const stories = authorId ? list.filter((s) => s.authorId === authorId) : [];
    return { stories, hasUnviewed: stories.some((s) => !s.viewed) };
  }, [list, authorId]);
}

// Раз в минуту и при возвращении в приложение — свежие сторис.
if (typeof window !== 'undefined') {
  window.setInterval(() => document.visibilityState === 'visible' && loaded && void refreshStories(), 60_000);
  document.addEventListener(
    'visibilitychange',
    () => document.visibilityState === 'visible' && void refreshStories(),
  );
}

// ---------- кольцо вокруг аватарки ----------
function ring(hasStories: boolean, unviewed: boolean) {
  if (!hasStories) return 'story-avatar';
  return unviewed ? 'story-avatar has unviewed' : 'story-avatar has viewed';
}

export function StoryAvatar({
  userId,
  name,
  seed,
  src,
  size,
  online,
  children,
}: {
  userId: string | null | undefined;
  name: string;
  seed: string;
  src?: string | null;
  size?: number;
  online?: boolean;
  children?: ReactNode;
}) {
  const { stories, hasUnviewed } = useAuthorStories(userId);
  const [open, setOpen] = useState(false);
  const has = stories.length > 0;
  return (
    <>
      <span
        className={ring(has, hasUnviewed)}
        role={has ? 'button' : undefined}
        tabIndex={has ? 0 : undefined}
        onClick={(e) => {
          if (!has) return;
          e.stopPropagation();
          e.preventDefault();
          setOpen(true);
        }}
        onKeyDown={(e) => has && (e.key === 'Enter' || e.key === ' ') && setOpen(true)}
      >
        <Avatar name={name} seed={seed} src={src} size={size} online={online} />
        {children}
      </span>
      {open && userId && <StoryViewer authors={[userId]} onClose={() => setOpen(false)} />}
    </>
  );
}

// ---------- лента над списком чатов ----------
function useUploadStory() {
  const { t } = useTranslation();
  const me = useMe();
  const showToast = useApp((s) => s.showToast);
  const [busy, setBusy] = useState(false);
  const publish = async (file: File | undefined) => {
    if (!file || busy) return;
    setBusy(true);
    try {
      const photo = await preparePhoto(file);
      const path = `${me}/story-${crypto.randomUUID()}.jpg`;
      await uploadMedia(path, photo.blob, 'image/jpeg');
      await createStory({
        mediaPath: path,
        mime: 'image/jpeg',
        size: photo.blob.size,
        width: photo.width,
        height: photo.height,
      });
      await refreshStories();
      showToast(t('stories.published'));
    } catch (e) {
      showToast(t(errorKey(e)));
    } finally {
      setBusy(false);
    }
  };
  return { busy, publish };
}

function StoryBubble({
  uid,
  label,
  unviewed,
  mine,
  onOpen,
}: {
  uid: string;
  label: string;
  unviewed: boolean;
  mine?: { has: boolean; onAdd: () => void };
  onOpen: () => void;
}) {
  const p = useProfile(uid);
  return (
    <button
      className="story-bubble"
      onClick={() => (mine && !mine.has ? mine.onAdd() : onOpen())}
      aria-label={label}
    >
      <span className={mine && !mine.has ? 'story-avatar' : ring(true, unviewed)}>
        <Avatar name={displayNameOf(p, label)} seed={uid} src={p?.avatar} size={56} />
        {mine && (
          <span
            className="story-plus"
            role="button"
            aria-label="+"
            onClick={(e) => {
              e.stopPropagation();
              mine.onAdd();
            }}
          >
            <Icon name="plus" size={14} />
          </span>
        )}
      </span>
      <span className="story-bubble-name">{label}</span>
    </button>
  );
}

/** Кружки сторис над списком чатов: «Моя история», затем непросмотренные, затем просмотренные. */
export function StoriesBar() {
  const { t } = useTranslation();
  const me = useMe();
  const list = useAllStories();
  const chats = useApp((s) => s.chats);
  const { busy, publish } = useUploadStory();
  const input = useRef<HTMLInputElement>(null);
  const [viewer, setViewer] = useState<{ authors: string[]; start: number } | null>(null);

  // Сторис людей, с которыми есть личная переписка (как «контакты» в Telegram).
  const authors = useMemo(() => {
    const partners = new Set(chats.filter((c) => c.type === 'private' && c.otherId).map((c) => c.otherId!));
    const byAuthor = new Map<string, { last: number; unviewed: boolean }>();
    for (const s of list) {
      if (s.authorId === me || !partners.has(s.authorId)) continue;
      const cur = byAuthor.get(s.authorId) ?? { last: 0, unviewed: false };
      byAuthor.set(s.authorId, {
        last: Math.max(cur.last, s.createdAt),
        unviewed: cur.unviewed || !s.viewed,
      });
    }
    return [...byAuthor.entries()]
      .sort((a, b) => Number(b[1].unviewed) - Number(a[1].unviewed) || b[1].last - a[1].last)
      .map(([uid, v]) => ({ uid, unviewed: v.unviewed }));
  }, [list, chats, me]);
  const myStories = list.filter((s) => s.authorId === me);

  return (
    <div className="stories-bar" role="list">
      <StoryBubble
        uid={me}
        label={busy ? t('common.loading') : t('stories.mine')}
        unviewed={false}
        mine={{ has: myStories.length > 0, onAdd: () => input.current?.click() }}
        onOpen={() => setViewer({ authors: [me], start: 0 })}
      />
      {authors.map((a, i) => (
        <AuthorBubble
          key={a.uid}
          uid={a.uid}
          unviewed={a.unviewed}
          onOpen={() => setViewer({ authors: authors.map((x) => x.uid), start: i })}
        />
      ))}
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          void publish(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      {viewer && (
        <StoryViewer authors={viewer.authors} start={viewer.start} onClose={() => setViewer(null)} />
      )}
    </div>
  );
}

function AuthorBubble({ uid, unviewed, onOpen }: { uid: string; unviewed: boolean; onOpen: () => void }) {
  const p = useProfile(uid);
  return <StoryBubble uid={uid} label={displayNameOf(p, '…')} unviewed={unviewed} onOpen={onOpen} />;
}

/** Кнопка «Добавить историю» (в профиле). */
export function AddStoryButton({ variant = 'button' }: { variant?: 'button' | 'icon' }) {
  const { t } = useTranslation();
  const { busy, publish } = useUploadStory();
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      {variant === 'icon' ? (
        <button
          className="story-add-btn"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          aria-label={t('stories.add')}
        >
          <Icon name="plus" size={20} />
        </button>
      ) : (
        <button className="action-btn" onClick={() => inputRef.current?.click()} disabled={busy}>
          <Icon name="image" />
          <span>{t('stories.add')}</span>
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          void publish(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </>
  );
}

// ---------- просмотр ----------
function StoryViewer({
  authors,
  start = 0,
  onClose,
}: {
  authors: string[];
  start?: number;
  onClose: () => void;
}) {
  const list = useAllStories();
  const [authorIdx, setAuthorIdx] = useState(start);
  const authorId = authors[authorIdx];
  const stories = useMemo(() => list.filter((s) => s.authorId === authorId), [list, authorId]);
  // С первой непросмотренной, как в Telegram.
  const [index, setIndex] = useState(() =>
    Math.max(
      0,
      stories.findIndex((s) => !s.viewed),
    ),
  );

  const nextAuthor = () => {
    if (authorIdx < authors.length - 1) {
      const nextId = authors[authorIdx + 1];
      const nextStories = list.filter((s) => s.authorId === nextId);
      setAuthorIdx(authorIdx + 1);
      setIndex(
        Math.max(
          0,
          nextStories.findIndex((s) => !s.viewed),
        ),
      );
    } else onClose();
  };
  const prevAuthor = () => {
    if (authorIdx > 0) {
      setAuthorIdx(authorIdx - 1);
      setIndex(0);
    }
  };

  useEffect(() => {
    if (stories.length === 0) onClose();
  }, [stories.length, onClose]);

  if (stories.length === 0) return null;
  const story = stories[Math.min(index, stories.length - 1)];

  return createPortal(
    <div
      className="story-viewer"
      role="dialog"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <StoryCard
        key={story.id}
        story={story}
        count={stories.length}
        index={Math.min(index, stories.length - 1)}
        onNext={() => (index < stories.length - 1 ? setIndex(index + 1) : nextAuthor())}
        onPrev={() => (index > 0 ? setIndex(index - 1) : prevAuthor())}
        onClose={onClose}
      />
    </div>,
    document.body,
  );
}

function StoryCard({
  story,
  count,
  index,
  onNext,
  onPrev,
  onClose,
}: {
  story: Story;
  count: number;
  index: number;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const me = useMe();
  const showToast = useApp((s) => s.showToast);
  const author = useProfile(story.authorId);
  const url = useMediaUrl(story.mediaPath);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const holdTimer = useRef<number | undefined>(undefined);
  const held = useRef(false);
  const nextRef = useRef(onNext);
  useEffect(() => {
    nextRef.current = onNext;
  });

  useEffect(() => {
    if (!story.viewed) {
      markViewedLocal(story.id);
      void markStoryViewed(story.id).catch(() => undefined);
    }
  }, [story.id, story.viewed]);

  // Таймер 5 секунд, пока фото загружено и не на паузе.
  useEffect(() => {
    if (!url || paused) return;
    let last = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      setProgress((p) => {
        const next = p + (now - last) / STORY_MS;
        last = now;
        if (next >= 1) {
          window.setTimeout(() => nextRef.current(), 0);
          return 1;
        }
        return next;
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [url, paused]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') onNext();
      else if (e.key === 'ArrowLeft') onPrev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onNext, onPrev]);

  const time = new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit' }).format(
    story.createdAt,
  );
  const name = displayNameOf(author, t('profile.title'));

  // Удержание — пауза; короткое нажатие — назад/вперёд по половинам экрана.
  const down = () => {
    held.current = false;
    holdTimer.current = window.setTimeout(() => {
      held.current = true;
      setPaused(true);
    }, 220);
  };
  const up = (side: 'left' | 'right') => {
    window.clearTimeout(holdTimer.current);
    setPaused(false);
    if (!held.current) (side === 'left' ? onPrev : onNext)();
  };

  return (
    <div className="story-card">
      {url ? (
        <img className="story-photo" src={url} alt="" draggable={false} />
      ) : (
        <div className="story-loading">{t('common.loading')}</div>
      )}
      <div className="story-shade" />
      <div className="story-progress">
        {Array.from({ length: count }, (_, i) => (
          <span key={i}>
            <i style={{ width: `${(i < index ? 1 : i === index ? progress : 0) * 100}%` }} />
          </span>
        ))}
      </div>
      <div className="story-top">
        <Avatar name={name} seed={story.authorId} src={author?.avatar} size={36} />
        <div className="min0 grow">
          <div className="ellipsis story-name">{name}</div>
          <div className="story-time">{time}</div>
        </div>
        {story.authorId === me && (
          <button
            className="icon-btn"
            aria-label={t('common.delete')}
            onClick={() =>
              void deleteStory(story.id)
                .then(refreshStories)
                .catch((e: unknown) => showToast(t(errorKey(e))))
            }
          >
            <Icon name="trash" />
          </button>
        )}
        <button className="icon-btn" onClick={onClose} aria-label={t('common.close')}>
          <Icon name="close" />
        </button>
      </div>
      <button
        className="story-zone left"
        onPointerDown={down}
        onPointerUp={() => up('left')}
        onPointerLeave={() => window.clearTimeout(holdTimer.current)}
        aria-label={t('common.back')}
      />
      <button
        className="story-zone right"
        onPointerDown={down}
        onPointerUp={() => up('right')}
        onPointerLeave={() => window.clearTimeout(holdTimer.current)}
        aria-label={t('common.next')}
      />
    </div>
  );
}
