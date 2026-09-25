import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  adminBoostChannelViews,
  adminBoostMembers,
  adminSetAutoBoost,
  errorKey,
  fetchChannelBoost,
} from '../../supabase/api';
import { useApp } from '../../app/store';
import { Modal } from '../../ui/Modal';
import { Icon } from '../../ui/Icon';
import { Spinner } from '../../ui/misc';

const EMOJIS = ['👍', '❤️', '🔥', '😂', '😮', '🎉', '👏', '💯'];

/** Накрутка канала: подписчики, просмотры всем постам, авто-накрутка новых постов. */
export function ChannelBoostDialog({
  chatId,
  title,
  realMembers,
  onClose,
}: {
  chatId: string;
  title: string;
  realMembers?: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const showToast = useApp((s) => s.showToast);
  const [loaded, setLoaded] = useState(false);
  const [members, setMembers] = useState('');
  const [views, setViews] = useState('');
  const [autoViews, setAutoViews] = useState('');
  const [autoReactions, setAutoReactions] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetchChannelBoost(chatId)
      .then((b) => {
        setMembers(b.boostMembers ? String(b.boostMembers) : '');
        setAutoViews(b.views ? String(b.views) : '');
        setAutoReactions(Object.fromEntries(Object.entries(b.reactions).map(([e, n]) => [e, String(n)])));
        setLoaded(true);
      })
      .catch((e: unknown) => showToast(t(errorKey(e))));
  }, [chatId, showToast, t]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      showToast(ok);
    } catch (e) {
      showToast(t(errorKey(e)));
    } finally {
      setBusy(false);
    }
  };

  const num = (v: string) => Math.max(0, Math.round(Number(v) || 0));
  const reactions = () =>
    Object.fromEntries(
      Object.entries(autoReactions)
        .map(([e, v]) => [e, num(v)] as const)
        .filter(([, n]) => n > 0),
    );

  return (
    <Modal title={t('boost.title', { title })} onClose={onClose}>
      {!loaded ? (
        <div className="center-pad">
          <Spinner />
        </div>
      ) : (
        <div className="stack">
          <section className="boost-section">
            <div className="field-label boost-head">
              <Icon name="users" size={14} /> {t('boost.members')}
            </div>
            {realMembers !== undefined && (
              <p className="muted small">{t('admin.boostMembersHint', { count: realMembers })}</p>
            )}
            <div className="row gap">
              <input
                className="input"
                type="number"
                min={0}
                inputMode="numeric"
                value={members}
                onChange={(e) => setMembers(e.target.value)}
              />
              <button
                className="btn btn-primary"
                disabled={busy}
                onClick={() => void run(() => adminBoostMembers(chatId, num(members)), t('admin.boostSaved'))}
              >
                {t('common.save')}
              </button>
            </div>
          </section>

          <section className="boost-section">
            <div className="field-label boost-head">
              <Icon name="eye" size={14} /> {t('boost.viewsAll')}
            </div>
            <p className="muted small">{t('boost.viewsAllHint')}</p>
            <div className="row gap">
              <input
                className="input"
                type="number"
                min={1}
                inputMode="numeric"
                value={views}
                onChange={(e) => setViews(e.target.value)}
              />
              <button
                className="btn btn-primary"
                disabled={busy || num(views) < 1}
                onClick={() =>
                  void run(async () => {
                    const n = await adminBoostChannelViews(chatId, num(views));
                    setViews('');
                    return n;
                  }, t('admin.boostSaved'))
                }
              >
                {t('boost.add')}
              </button>
            </div>
          </section>

          <section className="boost-section">
            <div className="field-label boost-head">
              <Icon name="star" size={14} /> {t('boost.auto')}
            </div>
            <p className="muted small">{t('boost.autoHint')}</p>
            <label className="field">
              <span className="field-label">{t('admin.extraViews')}</span>
              <input
                className="input"
                type="number"
                min={0}
                inputMode="numeric"
                placeholder="0"
                value={autoViews}
                onChange={(e) => setAutoViews(e.target.value)}
              />
            </label>
            <div className="boost-grid">
              {EMOJIS.map((e) => (
                <label key={e} className="boost-cell">
                  <span>{e}</span>
                  <input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    placeholder="0"
                    value={autoReactions[e] ?? ''}
                    onChange={(ev) => setAutoReactions((r) => ({ ...r, [e]: ev.target.value }))}
                  />
                </label>
              ))}
            </div>
            <div className="row gap">
              <button
                className="btn btn-primary"
                disabled={busy}
                onClick={() =>
                  void run(
                    () => adminSetAutoBoost(chatId, num(autoViews), reactions()),
                    t('admin.boostSaved'),
                  )
                }
              >
                {t('common.save')}
              </button>
              <button
                className="btn btn-text"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await adminSetAutoBoost(chatId, 0, {});
                    setAutoViews('');
                    setAutoReactions({});
                  }, t('boost.autoOff'))
                }
              >
                {t('boost.turnOff')}
              </button>
            </div>
          </section>
        </div>
      )}
    </Modal>
  );
}
