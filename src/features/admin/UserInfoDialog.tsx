import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { UserProfile } from '../../supabase/types';
import { adminBanDevice, adminUserDevices, errorKey, type UserDevice } from '../../supabase/api';
import { describeUserAgent } from '../../lib/device';
import { useApp } from '../../app/store';
import { Modal } from '../../ui/Modal';
import { Spinner } from '../../ui/misc';

function when(ms: number | null | undefined, locale: string): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' });
}

function Row({ label, value, copy }: { label: string; value: string; copy?: boolean }) {
  const showToast = useApp((s) => s.showToast);
  const { t } = useTranslation();
  return (
    <div className="info-row">
      <span className="muted">{label}</span>
      {copy ? (
        <button
          className="plain info-value accent-text"
          onClick={() => void navigator.clipboard?.writeText(value).then(() => showToast(t('common.copied')))}
        >
          {value}
        </button>
      ) : (
        <span className="info-value">{value}</span>
      )}
    </div>
  );
}

/** Отладочная информация о пользователе: аккаунт и устройства (IP, система, браузер, PWA, пуши). */
export function UserInfoDialog({
  user,
  onClose,
  onChanged,
}: {
  user: UserProfile;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const showToast = useApp((s) => s.showToast);
  const [devices, setDevices] = useState<UserDevice[] | null>(null);

  const load = () =>
    adminUserDevices(user.uid)
      .then(setDevices)
      .catch((e: unknown) => {
        showToast(t(errorKey(e)));
        setDevices([]);
      });
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.uid]);

  const ban = (d: UserDevice, kind: 'ip' | 'device', on: boolean) =>
    void adminBanDevice(user.uid, d.deviceId, kind, on)
      .then(() => {
        showToast(t(on ? 'admin.banDone' : 'admin.unbanDone'));
        if (on) onChanged?.();
        return load();
      })
      .catch((e: unknown) => showToast(t(errorKey(e))));

  const yes = (v: unknown) => (v ? t('common.yes') : t('common.no'));

  return (
    <Modal title={t('admin.infoTitle', { name: '@' + user.username })} onClose={onClose} wide>
      <div className="stack">
        <section className="info-card">
          <Row label="ID" value={user.uid} copy />
          <Row label={t('admin.infoCreated')} value={when(user.createdAt, i18n.language)} />
          <Row label={t('admin.infoLastSeen')} value={when(user.lastSeen, i18n.language)} />
          <Row
            label={t('admin.infoRole')}
            value={user.role === 'admin' ? t('admin.adminRole') : t('admin.userRole')}
          />
        </section>
        <div className="field-label">{t('admin.infoDevices', { count: devices?.length ?? 0 })}</div>
        {!devices ? (
          <div className="center-pad">
            <Spinner />
          </div>
        ) : devices.length === 0 ? (
          <p className="muted small">{t('admin.infoNoDevices')}</p>
        ) : (
          devices.map((d) => {
            const ua = describeUserAgent(d.userAgent);
            const i = d.info;
            return (
              <section key={d.deviceId} className="info-card">
                <div className="info-card-title">
                  {ua.device} · {ua.os} · {ua.browser}
                  {i.pwa ? ` · ${t('admin.infoPwa')}` : ''}
                </div>
                <Row label="IP" value={`${d.ip ?? '—'}${d.country ? ` (${d.country})` : ''}`} copy={!!d.ip} />
                <Row label={t('admin.infoApp')} value={String(i.app ?? '—')} />
                <Row label={t('admin.infoPush')} value={String(i.push ?? '—')} />
                <Row
                  label={t('admin.infoScreen')}
                  value={`${String(i.screen ?? '—')} · ${String(i.viewport ?? '')}`}
                />
                <Row label={t('admin.infoLang')} value={`${String(i.lang ?? '—')} · ${String(i.tz ?? '')}`} />
                <Row
                  label={t('admin.infoHardware')}
                  value={`${i.cores ?? '?'} ${t('admin.infoCores')}${i.memory ? ` · ${String(i.memory)} ГБ` : ''}${
                    i.net ? ` · ${String(i.net)}` : ''
                  } · ${t('admin.infoTouch')}: ${yes(i.touch)}`}
                />
                <Row label={t('admin.infoFirst')} value={when(d.firstSeen, i18n.language)} />
                <Row label={t('admin.infoLast')} value={when(d.lastSeen, i18n.language)} />
                <div className="row gap wrap">
                  <button
                    className={d.deviceBanned ? 'btn btn-text' : 'btn btn-text danger'}
                    onClick={() => ban(d, 'device', !d.deviceBanned)}
                  >
                    {d.deviceBanned ? t('admin.unbanDevice') : t('admin.banDevice')}
                  </button>
                  {d.ip && (
                    <button
                      className={d.ipBanned ? 'btn btn-text' : 'btn btn-text danger'}
                      onClick={() => ban(d, 'ip', !d.ipBanned)}
                    >
                      {d.ipBanned ? t('admin.unbanIp') : t('admin.banIp')}
                    </button>
                  )}
                </div>
                <details className="info-ua">
                  <summary className="muted small">User-Agent</summary>
                  <code>{d.userAgent}</code>
                </details>
              </section>
            );
          })
        )}
      </div>
    </Modal>
  );
}
