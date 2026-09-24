import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useTranslation } from 'react-i18next';
import { useApp } from '../../app/store';
import { Modal } from '../../ui/Modal';
import { Icon } from '../../ui/Icon';

/** QR-код и ссылка на профиль или приглашение. */
export function ShareLink({ link, title, onClose }: { link: string; title: string; onClose: () => void }) {
  const { t } = useTranslation();
  const showToast = useApp((s) => s.showToast);
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    void QRCode.toDataURL(link, { width: 480, margin: 1, color: { dark: '#1c2733', light: '#ffffff' } }).then(setQr);
  }, [link]);

  const share = () => {
    if (navigator.share) void navigator.share({ url: link, title }).catch(() => undefined);
    else void navigator.clipboard?.writeText(link).then(() => showToast(t('common.copied')));
  };

  return (
    <Modal title={title} onClose={onClose}>
      <div className="qr-box">
        {qr ? <img src={qr} alt="QR" /> : <div className="qr-placeholder" />}
        <p className="muted small">{t('profile.qrHint')}</p>
        <div className="link-box">{link}</div>
        <div className="row gap">
          <button
            className="btn"
            onClick={() => void navigator.clipboard?.writeText(link).then(() => showToast(t('common.copied')))}
          >
            <Icon name="copy" size={18} /> {t('common.copy')}
          </button>
          <button className="btn btn-primary" onClick={share}>
            <Icon name="forward" size={18} /> {t('common.share')}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function ShareProfile({ username, onClose }: { username: string; onClose: () => void }) {
  const link = `${window.location.origin}${import.meta.env.BASE_URL}#/u/${username}`;
  return <ShareLink link={link} title={'@' + username} onClose={onClose} />;
}
