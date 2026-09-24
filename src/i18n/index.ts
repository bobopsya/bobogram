import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ru from './ru.json';
import en from './en.json';
import hi from './hi.json';
import zh from './zh.json';

export const LANGUAGES = [
  { code: 'ru', label: 'Русский' },
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'zh', label: '中文' },
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]['code'];

const STORAGE_KEY = 'bobogram.lang';

function initialLanguage(): LanguageCode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && LANGUAGES.some((l) => l.code === saved)) return saved as LanguageCode;
  } catch {
    // localStorage может быть недоступен (приватный режим)
  }
  const nav = navigator.language.slice(0, 2);
  return (LANGUAGES.find((l) => l.code === nav)?.code ?? 'ru') as LanguageCode;
}

void i18n.use(initReactI18next).init({
  resources: { ru: { translation: ru }, en: { translation: en }, hi: { translation: hi }, zh: { translation: zh } },
  lng: initialLanguage(),
  fallbackLng: 'ru',
  interpolation: { escapeValue: false },
});

document.documentElement.lang = i18n.language;

export function setLanguage(code: LanguageCode) {
  void i18n.changeLanguage(code);
  document.documentElement.lang = code;
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch {
    // ignore
  }
}

export default i18n;
