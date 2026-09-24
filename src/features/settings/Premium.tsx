import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp, useMe, useMyProfile } from '../../app/store';
import { errorKey, myPremiumRequest, requestPremium, type PremiumRequest } from '../../supabase/api';
import { BIO_MAX, BIO_MAX_PREMIUM, GROUP_MAX_MEMBERS, GROUP_MAX_MEMBERS_PREMIUM, isPremium, PINNED_CHATS_MAX, PINNED_CHATS_MAX_PREMIUM } from '../../supabase/types';
import { PremiumIcon } from '../../ui/Badges';
import { PageHeader, Spinner } from '../../ui/misc';

/** Экран «Премиум»: статус и преимущества, или заявка администратору. */
export function PremiumScreen() {
  const { t, i18n } = useTranslation();
  const me = useMe();
  const profile = useMyProfile();
  const showToast = useApp((s) => s.showToast);
  const premium = isPremium(profile);
  const [request, setRequest] = useState<PremiumRequest | null | undefined>(undefined);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void myPremiumRequest(me)
      .then(setRequest)
      .catch(() => setRequest(null));
  }, [me]);

  const send = async () => {
    setBusy(true);
    try {
      await requestPremium(note);
      setRequest(await myPremiumRequest(me));
      showToast(t('premium.requestSent'));
    } catch (err) {
      showToast(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  const forever = profile.premiumUntil && new Date(profile.premiumUntil).getFullYear() >= 9999;
  const perks = [
    ['⭐', t('premium.perkBadge')],
    ['🎨', t('premium.perkThemes')],
    ['📌', t('premium.perkPins', { free: PINNED_CHATS_MAX, premium: PINNED_CHATS_MAX_PREMIUM })],
    ['✍️', t('premium.perkBio', { free: BIO_MAX, premium: BIO_MAX_PREMIUM })],
    ['👥', t('premium.perkGroups', { free: GROUP_MAX_MEMBERS, premium: GROUP_MAX_MEMBERS_PREMIUM })],
  ];

  return (
    <div className="screen">
      <PageHeader title={t('premium.title')} back="/settings" />
      <div className="scroll form-page">
        <div className="premium-hero">
          <PremiumIcon size={72} />
          <h2>Bobogram Premium</h2>
          {premium ? (
            <p className="accent-text">
              {forever
                ? t('premium.activeForever')
                : t('premium.activeUntil', { date: new Date(profile.premiumUntil!).toLocaleDateString(i18n.language) })}
            </p>
          ) : (
            <p className="muted">{t('premium.subtitle')}</p>
          )}
        </div>

        <div className="perk-list">
          {perks.map(([emoji, text]) => (
            <div key={text} className="perk">
              <span className="perk-emoji">{emoji}</span>
              <span>{text}</span>
            </div>
          ))}
        </div>

        {!premium &&
          (request === undefined ? (
            <div className="center-pad">
              <Spinner />
            </div>
          ) : request?.status === 'pending' ? (
            <p className="form-info center">{t('premium.pending')}</p>
          ) : (
            <>
              {request?.status === 'rejected' && <p className="form-error">{t('premium.rejected')}</p>}
              <label className="field">
                <span className="field-label">{t('premium.note')}</span>
                <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} rows={3} />
              </label>
              <button className="btn btn-primary btn-block premium-btn" onClick={() => void send()} disabled={busy}>
                {t('premium.request')}
              </button>
            </>
          ))}
      </div>
    </div>
  );
}
