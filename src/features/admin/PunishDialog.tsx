import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { adminBanUser, adminSetSpamblock, errorKey, PREMIUM_FOREVER } from '../../supabase/api';
import type { UserProfile } from '../../supabase/types';
import { useApp } from '../../app/store';
import { Modal } from '../../ui/Modal';

const HOUR = 3_600_000;
/** Срок наказания в часах; null — навсегда. */
const DURATIONS: { key: string; hours: number | null }[] = [
  { key: 'dur1h', hours: 1 },
  { key: 'dur1d', hours: 24 },
  { key: 'dur7d', hours: 24 * 7 },
  { key: 'dur30d', hours: 24 * 30 },
  { key: 'durForever', hours: null },
];

/** Бан или спамблок: причина и срок. Бан заодно блокирует IP и устройства, чтобы не вернулись со второго аккаунта. */
export function PunishDialog({
  user,
  kind,
  onClose,
  onDone,
}: {
  user: UserProfile;
  kind: 'ban' | 'spam';
  onClose: () => void;
  onDone: (change: Partial<UserProfile>) => void;
}) {
  const { t } = useTranslation();
  const showToast = useApp((s) => s.showToast);
  const [reason, setReason] = useState('');
  const [hours, setHours] = useState<number | null>(24 * 7);
  const [ip, setIp] = useState(true);
  const [device, setDevice] = useState(true);
  const [busy, setBusy] = useState(false);

  const submit = () => {
    setBusy(true);
    const at = hours === null ? null : new Date(Date.now() + hours * HOUR).toISOString();
    const run =
      kind === 'ban'
        ? adminBanUser(user.uid, { reason, until: at, ip, device }).then(() => onDone({ banned: true }))
        : adminSetSpamblock(user.uid, at ?? PREMIUM_FOREVER, reason).then(() =>
            onDone({ spamUntil: Date.parse(at ?? PREMIUM_FOREVER) }),
          );
    run.then(onClose).catch((e: unknown) => {
      setBusy(false);
      showToast(t(errorKey(e)));
    });
  };

  return (
    <Modal
      title={t(kind === 'ban' ? 'admin.punishBanTitle' : 'admin.punishSpamTitle', { name: '@' + user.username })}
      onClose={onClose}
      footer={
        <button className="btn btn-danger" disabled={busy} onClick={submit}>
          {t(kind === 'ban' ? 'admin.punishBan' : 'admin.punishSpam')}
        </button>
      }
    >
      <div className="stack">
        <label className="field">
          <span className="field-label">{t('admin.punishReason')}</span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={300}
            placeholder={t('admin.punishReasonPlaceholder')}
          />
          <span className="field-hint">{t(kind === 'ban' ? 'admin.punishReasonHintBan' : 'admin.punishReasonHintSpam')}</span>
        </label>
        <div className="field-label">{t('admin.punishDuration')}</div>
        {DURATIONS.map((d) => (
          <label key={d.key} className="radio-row">
            <input type="radio" name="duration" checked={hours === d.hours} onChange={() => setHours(d.hours)} />
            <span>{t(`admin.${d.key}`)}</span>
          </label>
        ))}
        {kind === 'ban' && (
          <>
            <label className="radio-row">
              <input type="checkbox" checked={ip} onChange={(e) => setIp(e.target.checked)} />
              <span>{t('admin.punishIp')}</span>
            </label>
            <label className="radio-row">
              <input type="checkbox" checked={device} onChange={(e) => setDevice(e.target.checked)} />
              <span>{t('admin.punishDevice')}</span>
            </label>
            <p className="muted small">{t('admin.punishScopeHint')}</p>
          </>
        )}
      </div>
    </Modal>
  );
}
