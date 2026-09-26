import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp, useMe } from '../../app/store';
import { errorKey, createStory, fetchStories, fetchStorySummary, markStoryViewed } from '../../supabase/api';
import type { Story, StorySummary } from '../../supabase/types';
import { uploadMedia, useMediaUrl } from '../../supabase/media';
import { preparePhoto } from '../../lib/mediaFiles';
import { Avatar } from '../../ui/Avatar';
import { Icon } from '../../ui/Icon';
import { displayNameOf, useProfile } from '../../app/profiles';

const emptySummary: StorySummary = { count: 0, hasUnviewed: false, firstStoryId: null };
const STORY_EVENT = 'bobogram:stories-changed';

function notifyStoriesChanged(authorId: string) {
  window.dispatchEvent(new CustomEvent(STORY_EVENT, { detail: { authorId } }));
}

function useStorySummary(authorId: string | null | undefined): StorySummary {
  const [summary, setSummary] = useState<StorySummary>(emptySummary);
  useEffect(() => {
    if (!authorId) {
      setSummary(emptySummary);
      return;
    }
    let cancelled = false;
    fetchStorySummary(authorId)
      .then((s) => !cancelled && setSummary(s))
      .catch(() => !cancelled && setSummary(emptySummary));
    const onChange = (event: Event) => {
      const changed = (event as CustomEvent<{ authorId?: string }>).detail?.authorId;
      if (!changed || changed === authorId) {
        void fetchStorySummary(authorId).then((s) => setSummary(s)).catch(() => setSummary(emptySummary));
      }
    };
    window.addEventListener(STORY_EVENT, onChange);
    return () => {
      cancelled = true;
      window.removeEventListener(STORY_EVENT, onChange);
    };
  }, [authorId]);
  return summary;
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
  const summary = useStorySummary(userId);
  const [open, setOpen] = useState(false);
  const hasStories = summary.count > 0;

  return (
    <>
      <span
        className={hasStories ? `story-avatar ${summary.hasUnviewed ? 'unviewed' : 'viewed'}` : 'story-avatar'}
        role={hasStories ? 'button' : undefined}
        tabIndex={hasStories ? 0 : undefined}
        onClick={(e) => {
          if (!hasStories) return;
          e.stopPropagation();
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (hasStories && (e.key === 'Enter' || e.key === ' ')) setOpen(true);
        }}
      >
        <Avatar name={name} seed={seed} src={src} size={size} online={online} />
        {children}
      </span>
      {open && userId && <StoryViewer authorId={userId} onClose={() => setOpen(false)} />}
    </>
  );
}

export function AddStoryButton({ variant = 'button' }: { variant?: 'button' | 'icon' }) {
  const { t } = useTranslation();
  const me = useMe();
  const showToast = useApp((s) => s.showToast);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

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
      notifyStoriesChanged(me);
      showToast(t('stories.published'));
    } catch (e) {
      showToast(t(errorKey(e)));
    } finally {
      setBusy(false);
    }
  };

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

function StoryViewer({ authorId, onClose }: { authorId: string; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const author = useProfile(authorId);
  const [stories, setStories] = useState<Story[] | null>(null);
  const [index, setIndex] = useState(0);
  const story = stories?.[index] ?? null;
  const url = useMediaUrl(story?.mediaPath);

  useEffect(() => {
    let cancelled = false;
    fetchStories(authorId)
      .then((s) => !cancelled && setStories(s))
      .catch(() => !cancelled && setStories([]));
    return () => {
      cancelled = true;
    };
  }, [authorId]);

  useEffect(() => {
    if (story) {
      void markStoryViewed(story.id)
        .then(() => notifyStoriesChanged(authorId))
        .catch(() => undefined);
    }
  }, [authorId, story]);

  if (stories && stories.length === 0) return null;

  const next = () => {
    if (!stories) return;
    if (index < stories.length - 1) setIndex(index + 1);
    else onClose();
  };
  const prev = () => index > 0 && setIndex(index - 1);
  const time = story
    ? new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit' }).format(story.createdAt)
    : '';

  return (
    <div className="story-viewer" role="dialog" aria-label={t('stories.title')}>
      <div className="story-progress">
        {(stories ?? [null]).map((_, i) => (
          <span key={i} className={i <= index ? 'active' : undefined} />
        ))}
      </div>
      <div className="story-top">
        <Avatar
          name={displayNameOf(author, t('profile.title'))}
          seed={authorId}
          src={author?.avatar}
          size={38}
        />
        <div className="min0">
          <div className="ellipsis">{displayNameOf(author, t('profile.title'))}</div>
          <div className="muted small">{time}</div>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label={t('common.close')}>
          <Icon name="close" />
        </button>
      </div>
      <button className="story-zone left" onClick={prev} aria-label={t('common.back')} />
      <button className="story-zone right" onClick={next} aria-label={t('common.next')} />
      {url ? <img className="story-photo" src={url} alt="" /> : <div className="story-loading">{t('common.loading')}</div>}
    </div>
  );
}
