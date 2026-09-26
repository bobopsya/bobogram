import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  deleteScheduled,
  errorKey,
  fetchScheduled,
  scheduleMessage,
  type ScheduledMessage,
} from '../../supabase/api';
import { stripMarkup } from '../../lib/markup';
import { useApp } from '../../app/store';
import { Modal } from '../../ui/Modal';
import { Icon } from '../../ui/Icon';

/** Значение для <input type="datetime-local"> в местном времени. */
function localInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** «Отправить позже»: выбор даты и времени. */
export function ScheduleDialog({
  chatId,
  topicId,
  text,
  onClose,
}: {
  chatId: string;
  topicId?: string | null;
  text: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const showToast = useApp((s) => s.showToast);
  const [at, setAt] = useState(() => localInput(new Date(Date.now() + 60 * 60 * 1000)));
  const [busy, setBusy] = useState(false);
  const presets: [string, number][] = [
    [t('schedule.in1h'), 60],
    [t('schedule.in3h'), 180],
    [t('schedule.tomorrow'), 0],
  ];
  const submit = async () => {
    setBusy(true);
    try {
      await scheduleMessage(chatId, text, new Date(at), topicId);
      showToast(
        t('schedule.done', {
          when: new Date(at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }),
        }),
      );
      onClose();
    } catch (e) {
      showToast(t(errorKey(e)));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={t('schedule.title')}
      onClose={onClose}
      footer={
        <button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>
          {t('schedule.send')}
        </button>
      }
    >
      <div className="stack">
        <blockquote className="md-quote small">{stripMarkup(text).slice(0, 200)}</blockquote>
        <div className="row gap wrap">
          {presets.map(([label, min]) => (
            <button
              key={label}
              className="btn btn-text small"
              onClick={() => {
                const d = new Date();
                if (min) d.setMinutes(d.getMinutes() + min);
                else {
                  d.setDate(d.getDate() + 1);
                  d.setHours(9, 0, 0, 0);
                }
                setAt(localInput(d));
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="field">
          <span className="field-label">{t('schedule.when')}</span>
          <input
            type="datetime-local"
            value={at}
            min={localInput(new Date())}
            onChange={(e) => setAt(e.target.value)}
          />
        </label>
      </div>
    </Modal>
  );
}

/** Отложенные сообщения этого чата: когда уйдут, удалить. */
export function ScheduledList({ chatId, onClose }: { chatId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const showToast = useApp((s) => s.showToast);
  const [list, setList] = useState<ScheduledMessage[] | null>(null);
  const load = () =>
    void fetchScheduled(chatId)
      .then(setList)
      .catch(() => setList([]));
  useEffect(load, [chatId]);
  return (
    <Modal title={t('schedule.list')} onClose={onClose}>
      {!list || list.length === 0 ? (
        <p className="muted">{t('schedule.empty')}</p>
      ) : (
        <div className="stack">
          {list.map((m) => (
            <div key={m.id} className="info-card row gap">
              <div className="grow min0">
                <div className="small accent-text">
                  {new Date(m.sendAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                </div>
                <div className="ellipsis">{stripMarkup(m.text)}</div>
              </div>
              <button
                className="icon-btn"
                aria-label={t('common.delete')}
                onClick={() =>
                  void deleteScheduled(m.id)
                    .then(load)
                    .catch((e: unknown) => showToast(t(errorKey(e))))
                }
              >
                <Icon name="trash" />
              </button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
