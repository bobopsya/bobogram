import { useTranslation } from 'react-i18next';
import type { ProfileStyle } from '../../supabase/api';
import { NAME_COLORS, PROFILE_BGS } from '../../app/themes';

/** Выбор цвета имени, эмодзи-статуса и фона профиля. */
export function StylePicker({
  value,
  onChange,
}: {
  value: ProfileStyle;
  onChange: (v: ProfileStyle) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="style-picker">
      <div className="field-label">{t('style.nameColor')}</div>
      <div className="swatches">
        <button
          type="button"
          className={!value.nameColor ? 'style-swatch none active' : 'style-swatch none'}
          onClick={() => onChange({ ...value, nameColor: null })}
          aria-label={t('style.none')}
        />
        {NAME_COLORS.map((c) => (
          <button
            type="button"
            key={c.id}
            className={value.nameColor === c.id ? 'style-swatch active' : 'style-swatch'}
            style={{ background: c.css }}
            onClick={() => onChange({ ...value, nameColor: c.id })}
            aria-label={c.id}
          />
        ))}
      </div>

      <label className="field">
        <span className="field-label">{t('style.emoji')}</span>
        <input
          value={value.emojiStatus ?? ''}
          maxLength={16}
          placeholder="🔥"
          onChange={(e) => onChange({ ...value, emojiStatus: e.target.value.trim() || null })}
        />
      </label>

      <div className="field-label">{t('style.background')}</div>
      <div className="swatches">
        <button
          type="button"
          className={!value.profileBg ? 'style-swatch wide none active' : 'style-swatch wide none'}
          onClick={() => onChange({ ...value, profileBg: null })}
          aria-label={t('style.none')}
        />
        {PROFILE_BGS.map((b) => (
          <button
            type="button"
            key={b.id}
            className={value.profileBg === b.id ? 'style-swatch wide active' : 'style-swatch wide'}
            style={{ background: b.css }}
            onClick={() => onChange({ ...value, profileBg: b.id })}
            aria-label={b.id}
          />
        ))}
      </div>
    </div>
  );
}
