import { useTranslation } from 'react-i18next';
import { LANGUAGES, setLanguage, type LanguageCode } from '../../i18n';

export function LanguagePicker({ compact }: { compact?: boolean }) {
  const { i18n, t } = useTranslation();
  return (
    <label className={compact ? 'lang-picker compact' : 'lang-picker'}>
      {!compact && <span>{t('settings.language')}</span>}
      <select
        value={i18n.language}
        onChange={(e) => setLanguage(e.target.value as LanguageCode)}
        aria-label={t('settings.language')}
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.label}
          </option>
        ))}
      </select>
    </label>
  );
}
