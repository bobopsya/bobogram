import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { stripMarkup, wrapSelection, TEXT_EFFECTS } from '../../lib/markup';
import { NAME_COLORS } from '../../app/themes';
import { isPremium } from '../../supabase/types';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { Message } from '../../supabase/types';
import { MESSAGE_MAX_LENGTH } from '../../supabase/types';
import { displayNameOf, peekProfile, useProfile, useProfilesLoaded } from '../../app/profiles';
import { fetchMembers } from '../../supabase/api';
import { Avatar } from '../../ui/Avatar';
import { sendTyping } from '../../supabase/realtime';
import { isTouchDevice } from '../../app/effects';
import { Icon } from '../../ui/Icon';
import { Menu, type MenuItem } from '../../ui/Menu';
import { useLongPress } from '../../ui/useLongPress';
import { EmojiPicker } from './EmojiPicker';
import { canRecordVoice, VoiceRecorder, type VideoNoteResult, type VoiceResult } from '../../lib/mediaFiles';
import { VideoNoteCapture } from './VideoNoteCapture';
import { formatDuration } from '../../lib/time';
import { useApp } from '../../app/store';
import { PhotoSendDialog } from './PhotoSendDialog';
import { mediaLabel } from '../chats/chatMeta';

const drafts = new Map<string, string>();

interface Props {
  chatId: string;
  me: string;
  replyTo: Message | null;
  editing: Message | null;
  onCancelReply: () => void;
  onCancelEdit: () => void;
  onSend: (text: string) => void;
  onEdit: (msg: Message, text: string) => void;
  onEditLast: () => void;
  onSendPhotos: (files: File[], caption: string) => void;
  onSendVoice: (voice: VoiceResult) => void;
  onSendFile?: (file: File) => void;
  /** Отправить позже (долгое нажатие или правый клик на «Отправить»). */
  onSchedule?: (text: string) => void;
  onSendVideoNote?: (note: VideoNoteResult) => void;
  /** Дополнительные пункты меню скрепки (опрос, файл…). */
  attachItems?: MenuItem[];
  /** Группа: при вводе @ подсказывать участников. */
  mentions?: boolean;
}

const imagesOf = (list: FileList | File[] | null | undefined): File[] =>
  [...(list ?? [])].filter((f) => f.type.startsWith('image/') || f.type.startsWith('video/')).slice(0, 10);

/** Делит длинный текст на части по 4096 символов (по возможности по переносу строки). */
export function splitText(text: string, max = MESSAGE_MAX_LENGTH): string[] {
  const parts: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n', max);
    if (cut < max / 2) cut = rest.lastIndexOf(' ', max);
    if (cut < max / 2) cut = max;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\s+/, '');
  }
  if (rest) parts.push(rest);
  return parts;
}

export function Composer(props: Props) {
  const {
    chatId,
    me,
    replyTo,
    editing,
    onCancelReply,
    onCancelEdit,
    onSend,
    onEdit,
    onEditLast,
    onSendPhotos,
    onSendVoice,
    attachItems = [],
    mentions = false,
    onSendFile,
    onSendVideoNote,
    onSchedule,
  } = props;
  const [sendMenu, setSendMenu] = useState<{ x: number; y: number } | null>(null);
  const sendLongPress = useLongPress(
    (x, y) => !editing && onSchedule && text.trim() && setSendMenu({ x: x - 200, y: y - 60 }),
  );
  const docInput = useRef<HTMLInputElement>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [members, setMembers] = useState<string[]>([]);
  const [caret, setCaret] = useState(0);
  useEffect(() => {
    if (!mentions) return;
    void fetchMembers(chatId)
      .then((list) => setMembers(list.map((m) => m.userId).filter((u) => u !== me)))
      .catch(() => undefined);
  }, [mentions, chatId, me]);
  useProfilesLoaded(members);
  const [attachMenu, setAttachMenu] = useState<{ x: number; y: number } | null>(null);
  const { t } = useTranslation();
  const showToast = useApp((s) => s.showToast);
  const enterToSend = useApp((s) => s.enterToSend);
  const [photos, setPhotos] = useState<File[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const recorder = useRef<VoiceRecorder | null>(null);
  const [recording, setRecording] = useState(false);
  const [recTime, setRecTime] = useState(0);
  const [recLevel, setRecLevel] = useState(0);
  const [text, setText] = useState(() => drafts.get(chatId) ?? '');
  const [emojiOpen, setEmojiOpen] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  // Выделен текст — над полем панель форматирования.
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const [stylesOpen, setStylesOpen] = useState(false);
  const premium = useApp((s) => isPremium(s.profile));
  const navigate = useNavigate();
  const typingSent = useRef(0);
  const typingTimer = useRef<number | undefined>(undefined);
  const replyAuthor = useProfile(replyTo?.senderId ?? null);
  const mentionQuery = mentions
    ? /(?:^|\s)@([A-Za-z0-9_]{0,32})$/.exec(text.slice(0, caret))?.[1]
    : undefined;
  const suggestions =
    mentionQuery === undefined
      ? []
      : members
          .map((uid) => peekProfile(uid))
          .filter((p): p is NonNullable<typeof p> => !!p)
          .filter(
            (p) =>
              p.username.toLowerCase().startsWith(mentionQuery.toLowerCase()) ||
              p.displayName.toLowerCase().startsWith(mentionQuery.toLowerCase()),
          )
          .slice(0, 6);
  const insertMention = (username: string) => {
    const before = text.slice(0, caret).replace(/@([A-Za-z0-9_]{0,32})$/, `@${username} `);
    const next = before + text.slice(caret);
    onChange(next);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(before.length, before.length);
      setCaret(before.length);
    });
  };

  // Начали редактировать — подставляем текст.
  useEffect(() => {
    if (editing) {
      setText(editing.text);
      ref.current?.focus();
    }
  }, [editing]);

  useEffect(() => {
    if (replyTo) ref.current?.focus();
  }, [replyTo]);

  useEffect(() => {
    if (!editing) drafts.set(chatId, text);
  }, [chatId, text, editing]);

  // Высота поля под текст (до 8 строк).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 180) + 'px';
  }, [text]);

  useEffect(
    () => () => {
      window.clearTimeout(typingTimer.current);
      if (typingSent.current) sendTyping(chatId, me, true);
    },
    [chatId, me],
  );

  const stopTyping = () => {
    window.clearTimeout(typingTimer.current);
    if (typingSent.current) {
      typingSent.current = 0;
      sendTyping(chatId, me, true);
    }
  };

  const onChange = (value: string) => {
    setText(value);
    setCaret(ref.current?.selectionEnd ?? value.length);
    if (editing) return;
    const now = Date.now();
    if (value && now - typingSent.current > 3000) {
      typingSent.current = now;
      sendTyping(chatId, me);
    }
    window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(stopTyping, 5000);
  };

  const submit = () => {
    const value = text.trim();
    if (!value) return;
    if (editing) {
      if (value.length > MESSAGE_MAX_LENGTH) return;
      if (value !== editing.text) onEdit(editing, value);
      onCancelEdit();
      setText(drafts.get(chatId) ?? '');
      return;
    }
    onSend(value);
    setText('');
    drafts.delete(chatId);
    stopTyping();
    // На телефоне клавиатура остаётся открытой, как в Telegram.
    ref.current?.focus();
  };

  const readSelection = () => {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: start, selectionEnd: end } = el;
    setCaret(end);
    setSelection(start !== end ? { start, end } : null);
    if (start === end) setStylesOpen(false);
  };

  const applyFormat = (open: string, close = open) => {
    const el = ref.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    if (start === end) return;
    const next = wrapSelection(text, start, end, open, close);
    onChange(next.text);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(next.start, next.end);
      setSelection({ start: next.start, end: next.end });
    });
  };

  const addLink = () => {
    const url = window.prompt(t('format.linkPrompt'), 'https://');
    if (url && /^https?:\/\/\S+$/.test(url.trim())) applyFormat('[', `](${url.trim()})`);
  };

  const premiumStyle = (id: string) => {
    if (!premium) {
      navigate('/settings/premium');
      return;
    }
    applyFormat(`{${id}|`, '}');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && !e.altKey && ['b', 'i', 'u', 'x', 'm', 'p', 'k'].includes(key)) {
      const format: Record<string, [string, string?]> = {
        b: ['**'],
        i: ['__'],
        u: ['--'],
        x: ['~~'],
        m: ['`'],
        p: ['||'],
      };
      const el = e.currentTarget;
      if (
        el.selectionStart !== el.selectionEnd &&
        (key === 'b' || key === 'i' || key === 'u' || e.shiftKey)
      ) {
        e.preventDefault();
        if (key === 'k') addLink();
        else if (format[key]) applyFormat(...(format[key] as [string, string?]));
        return;
      }
    }
    if (
      e.key === 'Enter' &&
      !e.shiftKey &&
      !e.nativeEvent.isComposing &&
      (enterToSend || e.ctrlKey || e.metaKey)
    ) {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') {
      if (editing) {
        onCancelEdit();
        setText(drafts.get(chatId) ?? '');
      } else if (replyTo) onCancelReply();
    } else if (e.key === 'ArrowUp' && !text) {
      // как в Telegram: стрелка вверх — править последнее своё сообщение
      e.preventDefault();
      onEditLast();
    }
  };

  const insertEmoji = (emoji: string) => {
    const el = ref.current;
    if (!el) return setText((v) => v + emoji);
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    const next = text.slice(0, start) + emoji + text.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      el.selectionStart = el.selectionEnd = start + emoji.length;
    });
  };

  // ---------- голосовые ----------
  useEffect(() => {
    if (!recording) return;
    const id = window.setInterval(() => {
      setRecTime(recorder.current?.elapsed ?? 0);
      setRecLevel(recorder.current?.level ?? 0);
    }, 100);
    return () => window.clearInterval(id);
  }, [recording]);

  useEffect(() => () => recorder.current?.cancel(), []);

  const startRecording = async () => {
    if (recording) return;
    const rec = new VoiceRecorder();
    try {
      await rec.start();
    } catch {
      rec.cancel();
      showToast(t('media.micDenied'));
      return;
    }
    recorder.current = rec;
    setRecTime(0);
    setRecording(true);
    sendTyping(chatId, me);
  };

  const cancelRecording = () => {
    recorder.current?.cancel();
    recorder.current = null;
    setRecording(false);
    sendTyping(chatId, me, true);
  };

  const finishRecording = async () => {
    const rec = recorder.current;
    recorder.current = null;
    setRecording(false);
    sendTyping(chatId, me, true);
    if (!rec) return;
    const voice = await rec.stop().catch(() => null);
    // Случайное касание — меньше полусекунды не отправляем.
    if (voice && voice.duration >= 0.5 && voice.blob.size > 0) onSendVoice(voice);
  };

  const pickPhotos = (files: File[]) => {
    if (files.length) setPhotos(files);
  };

  const bar = editing ? (
    <div className="composer-bar">
      <Icon name="edit" size={20} className="accent-text" />
      <div className="composer-bar-body">
        <div className="accent-text">{t('chat.editing')}</div>
        <div className="ellipsis muted">{editing.text}</div>
      </div>
      <button
        className="icon-btn small"
        onClick={() => {
          onCancelEdit();
          setText(drafts.get(chatId) ?? '');
        }}
        aria-label={t('common.cancel')}
      >
        <Icon name="close" size={18} />
      </button>
    </div>
  ) : replyTo ? (
    <div className="composer-bar">
      <Icon name="reply" size={20} className="accent-text" />
      <div className="composer-bar-body">
        <div className="accent-text">{t('chat.replyTo', { name: displayNameOf(replyAuthor, '…') })}</div>
        <div className="ellipsis muted">{stripMarkup(replyTo.text) || mediaLabel(replyTo, t)}</div>
      </div>
      <button className="icon-btn small" onClick={onCancelReply} aria-label={t('common.cancel')}>
        <Icon name="close" size={18} />
      </button>
    </div>
  ) : null;

  return (
    <div className="composer-wrap">
      {emojiOpen && (
        <div className="emoji-panel">
          <EmojiPicker onPick={insertEmoji} />
        </div>
      )}
      {selection && !recording && (
        <div
          className="format-bar"
          onPointerDown={(e) => e.preventDefault()}
          onMouseDown={(e) => e.preventDefault()}
        >
          <button className="format-btn" onClick={() => applyFormat('**')} aria-label={t('format.bold')}>
            <b>B</b>
          </button>
          <button className="format-btn" onClick={() => applyFormat('__')} aria-label={t('format.italic')}>
            <i>I</i>
          </button>
          <button className="format-btn" onClick={() => applyFormat('~~')} aria-label={t('format.strike')}>
            <s>S</s>
          </button>
          <button className="format-btn" onClick={() => applyFormat('--')} aria-label={t('format.underline')}>
            <u>U</u>
          </button>
          <button className="format-btn mono" onClick={() => applyFormat('`')} aria-label={t('format.code')}>
            {'</>'}
          </button>
          <button className="format-btn" onClick={() => applyFormat('||')} aria-label={t('format.spoiler')}>
            <span className="format-spoiler">••</span>
          </button>
          <button className="format-btn" onClick={addLink} aria-label={t('format.link')}>
            <Icon name="link" size={18} />
          </button>
          <button
            className={stylesOpen ? 'format-btn premium active' : 'format-btn premium'}
            onClick={() => (premium ? setStylesOpen((v) => !v) : navigate('/settings/premium'))}
            aria-label={t('format.premium')}
          >
            ⭐
          </button>
          {stylesOpen && (
            <div className="format-styles">
              {NAME_COLORS.map((c) => (
                <button
                  key={c.id}
                  className="format-color"
                  style={{ background: c.css }}
                  onClick={() => premiumStyle(c.id)}
                  aria-label={c.id}
                />
              ))}
              {TEXT_EFFECTS.map((fx) => (
                <button
                  key={fx}
                  className="format-btn"
                  onClick={() => premiumStyle(fx)}
                  aria-label={t(`format.${fx}`)}
                >
                  <span className={`md-${fx}`} style={fx === 'big' ? { fontSize: '1.1em' } : undefined}>
                    {t(`format.${fx}Short`)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {suggestions.length > 0 && (
        <div
          className="mention-list"
          onPointerDown={(e) => e.preventDefault()}
          onMouseDown={(e) => e.preventDefault()}
        >
          {suggestions.map((p) => (
            <button key={p.uid} className="list-item mention-item" onClick={() => insertMention(p.username)}>
              <Avatar name={displayNameOf(p)} seed={p.uid} src={p.avatar} size={32} />
              <span className="ellipsis">{displayNameOf(p)}</span>
              <span className="muted small">@{p.username}</span>
            </button>
          ))}
        </div>
      )}
      {sendMenu && (
        <Menu
          x={sendMenu.x}
          y={sendMenu.y}
          onClose={() => setSendMenu(null)}
          items={[
            {
              icon: 'clock',
              label: t('schedule.later'),
              onClick: () => {
                onSchedule?.(text.trim());
                setText('');
                drafts.delete(chatId);
              },
            },
          ]}
        />
      )}
      {attachMenu && (
        <Menu
          x={attachMenu.x}
          y={attachMenu.y}
          onClose={() => setAttachMenu(null)}
          items={[
            { icon: 'image', label: t('media.photoOrVideo'), onClick: () => fileInput.current?.click() },
            ...(onSendFile
              ? [{ icon: 'file' as const, label: t('media.file'), onClick: () => docInput.current?.click() }]
              : []),
            ...attachItems,
          ]}
        />
      )}
      {bar}
      {photos.length > 0 && (
        <PhotoSendDialog
          files={photos}
          initialCaption={text}
          onCancel={() => setPhotos([])}
          onSend={(caption) => {
            onSendPhotos(photos, caption);
            setPhotos([]);
            if (caption === text.trim()) {
              setText('');
              drafts.delete(chatId);
            }
          }}
        />
      )}
      <input
        ref={docInput}
        type="file"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onSendFile?.(f);
          e.target.value = '';
        }}
      />
      {noteOpen && onSendVideoNote && (
        <VideoNoteCapture
          onCancel={() => setNoteOpen(false)}
          onSend={(note) => {
            setNoteOpen(false);
            onSendVideoNote(note);
          }}
        />
      )}
      <input
        ref={fileInput}
        type="file"
        accept="image/*,video/*"
        multiple
        hidden
        onChange={(e) => {
          pickPhotos(imagesOf(e.target.files));
          e.target.value = '';
        }}
      />
      {recording ? (
        <div className="composer recording">
          <span className="rec-dot" style={{ transform: `scale(${1 + recLevel * 0.8})` }} />
          <span className="rec-time">{formatDuration(recTime)}</span>
          <button className="rec-cancel plain" onClick={cancelRecording}>
            {t('common.cancel')}
          </button>
          <button
            className="icon-btn send-btn"
            onClick={() => void finishRecording()}
            aria-label={t('chat.send')}
          >
            <Icon name="send" />
          </button>
        </div>
      ) : (
        <div className="composer">
          <button
            className={emojiOpen ? 'icon-btn active' : 'icon-btn'}
            onClick={() => setEmojiOpen((v) => !v)}
            aria-label={t('chat.emoji')}
          >
            <Icon name="emoji" />
          </button>
          <textarea
            ref={ref}
            rows={1}
            value={text}
            placeholder={t('chat.placeholder')}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            onSelect={readSelection}
            onBlur={() => window.setTimeout(readSelection, 150)}
            onPaste={(e) => {
              const files = imagesOf(e.clipboardData?.files);
              if (files.length && !editing) {
                e.preventDefault();
                pickPhotos(files);
              }
            }}
            onFocus={() => isTouchDevice() && setEmojiOpen(false)}
            enterKeyHint={enterToSend ? 'send' : 'enter'}
          />
          {!editing && (
            <button
              className="icon-btn"
              onClick={(e) => {
                const count = attachItems.length + (onSendFile ? 1 : 0);
                if (count === 0) return fileInput.current?.click();
                const r = e.currentTarget.getBoundingClientRect();
                setAttachMenu({ x: r.right - 200, y: r.top - 8 - 44 * (count + 1) });
              }}
              aria-label={t('media.attach')}
            >
              <Icon name="attach" />
            </button>
          )}
          {!text.trim() && !editing && canRecordVoice() && onSendVideoNote && (
            <button className="icon-btn" onClick={() => setNoteOpen(true)} aria-label={t('media.recordNote')}>
              <Icon name="circle" />
            </button>
          )}
          {!text.trim() && !editing && canRecordVoice() ? (
            <button
              className="icon-btn send-btn"
              onClick={() => void startRecording()}
              aria-label={t('media.record')}
            >
              <Icon name="mic" />
            </button>
          ) : (
            <button
              className="icon-btn send-btn"
              onClick={submit}
              disabled={!text.trim()}
              aria-label={t('chat.send')}
              onMouseDown={(e) => e.preventDefault()}
              onContextMenu={(e) => {
                if (editing || !onSchedule || !text.trim()) return;
                e.preventDefault();
                setSendMenu({ x: e.clientX - 200, y: e.clientY - 60 });
              }}
              {...sendLongPress}
            >
              <Icon name={editing ? 'check' : 'send'} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
