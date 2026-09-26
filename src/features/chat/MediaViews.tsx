import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { MediaInfo } from '../../supabase/types';
import { useMediaUrl } from '../../supabase/media';
import { formatDuration } from '../../lib/time';
import { formatSize, WAVEFORM_BARS } from '../../lib/mediaFiles';
import { Icon } from '../../ui/Icon';

const PHOTO_MAX = 320;

export function PhotoMedia({ media, uploading }: { media: MediaInfo; uploading?: boolean }) {
  const { t } = useTranslation();
  const url = useMediaUrl(media.path);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const w = media.width ?? 1;
  const h = media.height ?? 1;
  // Очень вытянутые картинки не растягиваем на весь экран.
  const ratio = Math.min(Math.max(h / w, 0.4), 1.6);

  return (
    <>
      <button
        type="button"
        className="msg-photo plain"
        style={{ width: PHOTO_MAX, aspectRatio: `1 / ${ratio}` }}
        onClick={(e) => {
          e.stopPropagation();
          if (url) setOpen(true);
        }}
        aria-label={t('media.photo')}
      >
        {url && (
          <img
            src={url}
            alt=""
            draggable={false}
            onLoad={() => setLoaded(true)}
            className={loaded ? 'loaded' : ''}
          />
        )}
        {(uploading || !loaded) && <span className="msg-photo-spinner" />}
      </button>
      {open && url && createPortal(<PhotoViewer url={url} onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

function PhotoViewer({ url, onClose }: { url: string; onClose: () => void }) {
  const { t } = useTranslation();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="photo-viewer" role="dialog" aria-modal="true" onClick={onClose}>
      <img src={url} alt="" onClick={(e) => e.stopPropagation()} />
      <button className="icon-btn photo-viewer-close" onClick={onClose} aria-label={t('common.close')}>
        <Icon name="close" />
      </button>
    </div>
  );
}

/** Играет только одно голосовое за раз. */
let playing: HTMLAudioElement | null = null;

export function VoiceMedia({ media, own }: { media: MediaInfo; own: boolean }) {
  const { t } = useTranslation();
  const url = useMediaUrl(media.path);
  const audio = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [current, setCurrent] = useState(0);
  const duration = media.duration ?? 0;
  const bars = media.waveform?.length ? media.waveform : new Array<number>(WAVEFORM_BARS).fill(4);

  useEffect(
    () => () => {
      audio.current?.pause();
    },
    [],
  );

  const ensureAudio = (): HTMLAudioElement | null => {
    if (!url) return null;
    if (!audio.current) {
      const a = new Audio(url);
      a.preload = 'auto';
      a.ontimeupdate = () => {
        const total = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : duration;
        setCurrent(a.currentTime);
        setProgress(total ? Math.min(1, a.currentTime / total) : 0);
      };
      a.onplay = () => setPlaying(true);
      a.onpause = () => setPlaying(false);
      a.onended = () => {
        setPlaying(false);
        setProgress(0);
        setCurrent(0);
      };
      audio.current = a;
    }
    return audio.current;
  };

  const toggle = (e: MouseEvent) => {
    e.stopPropagation();
    const a = ensureAudio();
    if (!a) return;
    if (a.paused) {
      if (playing && playing !== a) playing.pause();
      playing = a;
      void a.play().catch(() => setPlaying(false));
    } else a.pause();
  };

  const seek = (e: MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const a = ensureAudio();
    if (!a) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const part = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const total = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : duration;
    if (total) a.currentTime = part * total;
    setProgress(part);
  };

  return (
    <div className={own ? 'voice own' : 'voice'}>
      <button
        type="button"
        className="voice-play"
        onClick={toggle}
        disabled={!url}
        aria-label={isPlaying ? t('media.pause') : t('media.play')}
      >
        <Icon name={isPlaying ? 'pause' : 'play'} size={20} />
      </button>
      <div className="voice-body">
        <div
          className="voice-wave"
          onClick={seek}
          role="slider"
          aria-valuenow={Math.round(progress * 100)}
          aria-label={t('media.voice')}
        >
          {bars.map((v, i) => (
            <span
              key={i}
              className={i / bars.length < progress ? 'on' : ''}
              style={{ height: `${Math.max(12, Math.round((v / 31) * 100))}%` }}
            />
          ))}
        </div>
        <div className="voice-time">{formatDuration(isPlaying || current > 0 ? current : duration)}</div>
      </div>
    </div>
  );
}

/** Видео в пузыре: превью по первому кадру, играет по нажатию со звуком. */
export function VideoMedia({ media, uploading }: { media: MediaInfo; uploading?: boolean }) {
  const url = useMediaUrl(media.path);
  const w = media.width ?? 16;
  const h = media.height ?? 9;
  const ratio = Math.min(Math.max(h / w, 0.4), 1.6);
  return (
    <div
      className="msg-photo msg-video"
      style={{ width: PHOTO_MAX, aspectRatio: `1 / ${ratio}` }}
      onClick={(e) => e.stopPropagation()}
    >
      {url && <video src={url} controls playsInline preload="metadata" />}
      {(uploading || !url) && <span className="msg-photo-spinner" />}
      {!!media.duration && <span className="msg-video-time">{formatDuration(media.duration)}</span>}
    </div>
  );
}

/** Документ: иконка, имя, размер; нажатие — скачать. */
export function FileMedia({ media, uploading }: { media: MediaInfo; uploading?: boolean }) {
  const { t } = useTranslation();
  const url = useMediaUrl(media.path);
  const name = media.name || t('media.file');
  const ext = (/\.([a-z0-9]{1,6})$/i.exec(name)?.[1] ?? 'FILE').toUpperCase();
  return (
    <a
      className="msg-file"
      href={url}
      download={name}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => {
        e.stopPropagation();
        if (!url) e.preventDefault();
      }}
    >
      <span className="msg-file-icon">
        {uploading || !url ? <span className="msg-photo-spinner" /> : ext}
      </span>
      <span className="min0">
        <span className="msg-file-name ellipsis">{name}</span>
        <span className="msg-file-size muted small">{formatSize(media.size)}</span>
      </span>
    </a>
  );
}

/** Кружок: играет без звука по кругу, по нажатию — со звуком с начала. */
export function VideoNoteMedia({ media, uploading }: { media: MediaInfo; uploading?: boolean }) {
  const url = useMediaUrl(media.path);
  const ref = useRef<HTMLVideoElement>(null);
  const [sound, setSound] = useState(false);
  const [progress, setProgress] = useState(0);
  return (
    <button
      type="button"
      className={sound ? 'video-note playing' : 'video-note'}
      onClick={(e: MouseEvent) => {
        e.stopPropagation();
        const v = ref.current;
        if (!v) return;
        if (sound) {
          v.muted = true;
          setSound(false);
        } else {
          v.currentTime = 0;
          v.muted = false;
          void v.play();
          setSound(true);
        }
      }}
    >
      {url && (
        <video
          ref={ref}
          src={url}
          muted
          autoPlay
          loop={!sound}
          playsInline
          onTimeUpdate={(e) => {
            const v = e.currentTarget;
            if (v.duration) setProgress(v.currentTime / v.duration);
          }}
          onEnded={() => {
            if (ref.current) ref.current.muted = true;
            setSound(false);
            void ref.current?.play();
          }}
        />
      )}
      {(uploading || !url) && <span className="msg-photo-spinner" />}
      {sound && (
        <svg className="video-note-ring" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="48" pathLength="1" strokeDasharray={`${progress} 1`} />
        </svg>
      )}
      {!sound && !!media.duration && <span className="msg-video-time">{formatDuration(media.duration)}</span>}
    </button>
  );
}
