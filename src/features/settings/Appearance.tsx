import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useApp, type ThemeMode } from '../../app/store';
import {
  appearanceVars,
  BACKGROUNDS,
  BUBBLE_COLORS,
  DEFAULT_APPEARANCE,
  FONT_RANGE,
  RADIUS_RANGE,
  THEMES,
} from '../../app/themes';
import { isPremium } from '../../supabase/types';
import { Icon } from '../../ui/Icon';
import { PageHeader, Section } from '../../ui/misc';

/** Экран «Оформление»: тема, фон, пузыри, текст — с живым предпросмотром. */
export function AppearanceScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const theme = useApp((s) => s.theme);
  const setTheme = useApp((s) => s.setTheme);
  const a = useApp((s) => s.appearance);
  const set = useApp((s) => s.setAppearance);
  const premium = useApp((s) => isPremium(s.profile));
  const showToast = useApp((s) => s.showToast);
  const dark = document.documentElement.dataset.theme === 'dark';

  const pick = (isPremiumOnly: boolean, apply: () => void) => {
    if (isPremiumOnly && !premium) {
      showToast(t('premium.onlyPremium'));
      navigate('/settings/premium');
      return;
    }
    apply();
  };

  return (
    <div className="screen">
      <PageHeader title={t('appearance.title')} back="/settings" />
      <div className="scroll">
        <div className="appearance-preview" style={{ background: 'var(--chat-pattern)' }}>
          <div className="msg-row last">
            <div className="bubble">
              <div className="msg-text">
                {t('appearance.sampleIn')}
                <span className="msg-meta">12:30</span>
              </div>
            </div>
          </div>
          <div className="msg-row own last">
            <div className="bubble">
              <div className="msg-text">
                {t('appearance.sampleOut')}
                <span className="msg-meta">
                  12:31 <Icon name="checks" size={15} className="tick" />
                </span>
              </div>
            </div>
          </div>
        </div>

        <Section title={t('settings.theme')}>
          <div className="segmented">
            {(['system', 'light', 'dark'] as ThemeMode[]).map((m) => (
              <button key={m} className={theme === m ? 'active' : ''} onClick={() => setTheme(m)}>
                {t(m === 'system' ? 'settings.themeSystem' : m === 'light' ? 'settings.themeLight' : 'settings.themeDark')}
              </button>
            ))}
          </div>
        </Section>

        <Section title={t('appearance.colors')}>
          <div className="swatch-grid">
            {THEMES.map((th) => {
              const p = dark ? th.dark : th.light;
              return (
                <button
                  key={th.id}
                  className={a.theme === th.id ? 'swatch active' : 'swatch'}
                  onClick={() => pick(th.premium, () => set({ theme: th.id }))}
                  aria-label={t(`appearance.theme_${th.id}`)}
                >
                  <span className="swatch-colors">
                    <span style={{ background: p.accent }} />
                    <span style={{ background: p.bubbleOut }} />
                  </span>
                  <span className="swatch-name">
                    {t(`appearance.theme_${th.id}`)} {th.premium && (premium ? '⭐' : '🔒')}
                  </span>
                </button>
              );
            })}
          </div>
        </Section>

        <Section title={t('appearance.background')}>
          <div className="swatch-grid">
            {BACKGROUNDS.map((bg) => (
              <button
                key={bg.id}
                className={a.background === bg.id ? 'swatch bg active' : 'swatch bg'}
                onClick={() => pick(bg.premium, () => set({ background: bg.id }))}
                aria-label={t(`appearance.bg_${bg.id}`)}
              >
                <span className="swatch-bg" style={{ background: dark ? bg.dark : bg.light }} />
                <span className="swatch-name">
                  {t(`appearance.bg_${bg.id}`)} {bg.premium && (premium ? '⭐' : '🔒')}
                </span>
              </button>
            ))}
          </div>
        </Section>

        <Section title={t('appearance.bubbleColor')}>
          <div className="color-row">
            {BUBBLE_COLORS.map((c) => {
              const shown = c ?? appearanceVars({ ...a, bubbleColor: null }, dark, premium)['--bubble-out'];
              return (
                <button
                  key={c ?? 'theme'}
                  className={a.bubbleColor === c ? 'color-dot active' : 'color-dot'}
                  style={{ background: shown }}
                  onClick={() => set({ bubbleColor: c })}
                  aria-label={c ?? t('appearance.fromTheme')}
                  title={c ?? t('appearance.fromTheme')}
                >
                  {c === null && <span className="color-dot-label">A</span>}
                </button>
              );
            })}
          </div>
        </Section>

        <Section title={t('appearance.bubbles')}>
          <label className="slider-row">
            <span>{t('appearance.radius')}</span>
            <input
              type="range"
              min={RADIUS_RANGE.min}
              max={RADIUS_RANGE.max}
              value={a.radius}
              onChange={(e) => set({ radius: Number(e.target.value) })}
            />
            <span className="muted">{a.radius}</span>
          </label>
          <label className="slider-row">
            <span>{t('appearance.fontSize')}</span>
            <input
              type="range"
              min={FONT_RANGE.min}
              max={FONT_RANGE.max}
              value={a.fontSize}
              onChange={(e) => set({ fontSize: Number(e.target.value) })}
            />
            <span className="muted">{a.fontSize}</span>
          </label>
        </Section>

        <Section>
          <button className="setting-row" onClick={() => set(DEFAULT_APPEARANCE)}>
            <Icon name="flip" />
            <span>{t('appearance.reset')}</span>
          </button>
        </Section>
      </div>
    </div>
  );
}
