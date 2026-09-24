import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { Message } from '../../firebase/types';
import { MESSAGE_MAX_LENGTH } from '../../firebase/types';
import { displayNameOf, useProfile } from '../../app/profiles';
import { setTyping } from '../../firebase/rtdb';
import { isTouchDevice } from '../../app/effects';
import { Icon } from '../../ui/Icon';
import { EmojiPicker } from './EmojiPicker';

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
}

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

export function Composer({ chatId, me, replyTo, editing, onCancelReply, onCancelEdit, onSend, onEdit, onEditLast }: Props) {
  const { t } = useTranslation();
  const [text, setText] = useState(() => drafts.get(chatId) ?? '');
  const [emojiOpen, setEmojiOpen] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const typingSent = useRef(0);
  const typingTimer = useRef<number | undefined>(undefined);
  const replyAuthor = useProfile(replyTo?.senderId ?? null);

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
      setTyping(chatId, me, false);
    },
    [chatId, me],
  );

  const stopTyping = () => {
    window.clearTimeout(typingTimer.current);
    if (typingSent.current) {
      typingSent.current = 0;
      setTyping(chatId, me, false);
    }
  };

  const onChange = (value: string) => {
    setText(value);
    if (editing) return;
    const now = Date.now();
    if (value && now - typingSent.current > 3000) {
      typingSent.current = now;
      setTyping(chatId, me, true);
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

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !isTouchDevice()) {
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
        <div className="ellipsis muted">{replyTo.text}</div>
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
      {bar}
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
          onFocus={() => isTouchDevice() && setEmojiOpen(false)}
          enterKeyHint={isTouchDevice() ? 'enter' : 'send'}
        />
        <button
          className="icon-btn send-btn"
          onClick={submit}
          disabled={!text.trim()}
          aria-label={t('chat.send')}
          onMouseDown={(e) => e.preventDefault()}
        >
          <Icon name={editing ? 'check' : 'send'} />
        </button>
      </div>
    </div>
  );
}
