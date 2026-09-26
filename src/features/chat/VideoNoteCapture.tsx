import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { VIDEO_NOTE_MAX_S, VideoNoteRecorder, type VideoNoteResult } from '../../lib/mediaFiles';
import { formatDuration } from '../../lib/time';
import { useApp } from '../../app/store';
import { Icon } from '../../ui/Icon';

/** Запись видеокружочка: круглое превью с фронталки, до 60 секунд. */
export function VideoNoteCapture({
  onCancel,
  onSend,
}: {
  onCancel: () => void;
  onSend: (note: VideoNoteResult) => void;
}) {
  const { t } = useTranslation();
  const showToast = useApp((s) => s.showToast);
  const video = useRef<HTMLVideoElement>(null);
  const recorder = useRef<VideoNoteRecorder | null>(null);
  const [time, setTime] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const rec = new VideoNoteRecorder();
    recorder.current = rec;
    let cancelled = false;
    rec
      .start()
      .then((stream) => {
        if (cancelled) return rec.cancel();
        if (video.current) video.current.srcObject = stream;
        setReady(true);
      })
      .catch(() => {
        showToast(t('media.cameraDenied'));
        onCancel();
      });
    const timer = window.setInterval(() => setTime(rec.elapsed), 200);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      rec.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finish = async () => {
    const rec = recorder.current;
    recorder.current = null;
    if (!rec) return;
    const note = await rec.stop().catch(() => null);
    if (note && note.duration >= 0.5 && note.blob.size > 0) onSend(note);
    else onCancel();
  };

  useEffect(() => {
    if (time >= VIDEO_NOTE_MAX_S) void finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [time]);

  return createPortal(
    <div className="note-capture" role="dialog">
      <div className="note-capture-circle">
        <video ref={video} autoPlay muted playsInline />
        <svg viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="48" pathLength="1" strokeDasharray={`${time / VIDEO_NOTE_MAX_S} 1`} />
        </svg>
      </div>
      <div className="note-capture-bar">
        <span className="rec-dot" />
        <span className="rec-time">{formatDuration(time)}</span>
        <button className="btn btn-text" onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <button
          className="icon-btn send-btn"
          disabled={!ready}
          onClick={() => void finish()}
          aria-label={t('chat.send')}
        >
          <Icon name="send" />
        </button>
      </div>
    </div>,
    document.body,
  );
}
