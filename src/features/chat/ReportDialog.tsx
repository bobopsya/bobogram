import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorKey, reportAbuse, type ReportReason } from '../../supabase/api';
import { useApp } from '../../app/store';
import { Modal } from '../../ui/Modal';

const REASONS: ReportReason[] = ['spam', 'abuse', 'scam', 'other'];

/** Жалоба на сообщение или пользователя: уходит администраторам в лог-группу. */
export function ReportDialog({
  userId,
  messageId,
  onClose,
}: {
  userId?: string;
  messageId?: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const showToast = useApp((s) => s.showToast);
  const [reason, setReason] = useState<ReportReason>('spam');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  const send = async () => {
    setBusy(true);
    try {
      await reportAbuse({ userId, messageId, reason, comment });
      showToast(t('report.sent'));
      onClose();
    } catch (e) {
      showToast(t(errorKey(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={t('report.title')}
      onClose={onClose}
      footer={
        <button className="btn btn-danger" disabled={busy} onClick={() => void send()}>
          {t('report.send')}
        </button>
      }
    >
      <div className="stack">
        {REASONS.map((r) => (
          <label key={r} className="radio-row">
            <input type="radio" name="reason" checked={reason === r} onChange={() => setReason(r)} />
            <span>{t(`report.reason_${r}`)}</span>
          </label>
        ))}
        <label className="field">
          <span className="field-label">{t('report.comment')}</span>
          <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} maxLength={500} />
        </label>
      </div>
    </Modal>
  );
}
