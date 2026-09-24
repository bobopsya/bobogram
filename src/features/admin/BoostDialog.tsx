import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Message } from '../../supabase/types';
import { adminBoostMessage, errorKey } from '../../supabase/api';
import { useApp } from '../../app/store';
import { Modal } from '../../ui/Modal';
import { Icon } from '../../ui/Icon';

const EMOJIS = ['👍', '❤️', '🔥', '😂', '😮', '🎉', '👏', '😢', '💯', '🤩'];

/** Админ сервиса: накрутка просмотров и реакций поста (прибавляется к настоящим). */
export function BoostDialog({ msg, onClose }: { msg: Message; onClose: () => void }) {
  const { t } = useTranslation();
  const showToast = useApp((s) => s.showToast);
  const [views, setViews] = useState(String(msg.boostViews || ''));
  const [reactions, setReactions] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(msg.boostReactions).map(([e, n]) => [e, String(n)])),
  );
  const [busy, setBusy] = useState(false);

  const emojis = [...new Set([...Object.keys(reactions), ...EMOJIS])];

  const save = async () => {
    setBusy(true);
    const clean: Record<string, number> = {};
    for (const [e, v] of Object.entries(reactions)) {
      const n = Math.round(Number(v));
      if (n > 0) clean[e] = n;
    }
    try {
      await adminBoostMessage(msg.id, Number(views) || 0, clean);
      showToast(t('admin.boostSaved'));
      onClose();
    } catch (err) {
      showToast(t(errorKey(err)));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={t('admin.boostPost')}
      onClose={onClose}
      footer={
        <button className="btn btn-primary" onClick={() => void save()} disabled={busy}>
          {t('common.save')}
        </button>
      }
    >
      <p className="muted small">{t('admin.boostHint', { views: msg.views })}</p>
      <label className="field">
        <span className="field-label">
          <Icon name="eye" size={14} /> {t('admin.extraViews')}
        </span>
        <input type="number" min={0} inputMode="numeric" value={views} onChange={(e) => setViews(e.target.value)} />
      </label>
      <div className="field-label">{t('admin.extraReactions')}</div>
      <div className="boost-grid">
        {emojis.map((e) => (
          <label key={e} className="boost-cell">
            <span>{e}</span>
            <input
              type="number"
              min={0}
              inputMode="numeric"
              placeholder="0"
              value={reactions[e] ?? ''}
              onChange={(ev) => setReactions((r) => ({ ...r, [e]: ev.target.value }))}
            />
          </label>
        ))}
      </div>
    </Modal>
  );
}
