import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../../app/store';

const DATA_URL = (locale: string) =>
  `https://cdn.jsdelivr.net/npm/emoji-picker-element-data@^1/${locale}/emojibase/data.json`;

const I18N: Record<string, () => Promise<{ default: unknown }>> = {
  ru: () => import('emoji-picker-element/i18n/ru_RU.js'),
  hi: () => import('emoji-picker-element/i18n/hi.js'),
  zh: () => import('emoji-picker-element/i18n/zh_CN.js'),
};

type PickerElement = HTMLElement & { locale: string; dataSource: string; i18n: unknown };

/** Обёртка над веб-компонентом emoji-picker-element (грузится лениво). */
export function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const { i18n } = useTranslation();
  const theme = useApp((s) => s.theme);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  useEffect(() => {
    let el: PickerElement | null = null;
    let cancelled = false;
    const lang = i18n.language;
    (async () => {
      await import('emoji-picker-element');
      const strings = I18N[lang] ? (await I18N[lang]()).default : undefined;
      if (cancelled || !host.current) return;
      el = document.createElement('emoji-picker') as PickerElement;
      if (strings) el.i18n = strings;
      el.locale = lang;
      el.dataSource = DATA_URL(lang);
      const dark = document.documentElement.dataset.theme === 'dark';
      el.classList.add(dark ? 'dark' : 'light');
      el.addEventListener('emoji-click', (e) => {
        const unicode = (e as CustomEvent<{ unicode?: string }>).detail.unicode;
        if (unicode) onPickRef.current(unicode);
      });
      host.current.appendChild(el);
    })();
    return () => {
      cancelled = true;
      el?.remove();
    };
  }, [i18n.language, theme]);

  return <div className="emoji-host" ref={host} />;
}
