import { useEffect, useState, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  adminListReports,
  adminResolveReport,
  adminStats,
  errorKey,
  type ReportRow,
} from '../../supabase/api';
import { getOnline, onOnlineChange } from '../../supabase/realtime';
import { displayNameOf, useProfile } from '../../app/profiles';
import { useApp } from '../../app/store';
import { formatTime, toDate } from '../../lib/time';
import { Spinner } from '../../ui/misc';

function UserLink({ uid }: { uid: string | null }) {
  const p = useProfile(uid);
  const navigate = useNavigate();
  if (!uid) return <span>—</span>;
  return (
    <button className="plain accent-text" onClick={() => navigate(`/profile/${uid}`)}>
      {p ? '@' + p.username : displayNameOf(p, '…')}
    </button>
  );
}

/** Жалобы пользователей: открытые сверху, кнопка «Рассмотрено». */
export function ReportsTab() {
  const { t, i18n } = useTranslation();
  const showToast = useApp((s) => s.showToast);
  const [list, setList] = useState<ReportRow[] | null>(null);
  const [showDone, setShowDone] = useState(false);

  useEffect(() => {
    void adminListReports()
      .then(setList)
      .catch((e: unknown) => showToast(t(errorKey(e))));
  }, [showToast, t]);

  if (!list) {
    return (
      <div className="center-pad">
        <Spinner />
      </div>
    );
  }
  const shown = list.filter((r) => showDone || !r.resolved);

  return (
    <div className="pad-x stack">
      <label className="radio-row">
        <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
        <span>{t('report.showResolved')}</span>
      </label>
      {shown.length === 0 && <p className="muted center">{t('report.none')}</p>}
      {shown.map((r) => {
        const d = toDate(r.createdAt);
        return (
          <div key={r.id} className={r.resolved ? 'report-card resolved' : 'report-card'}>
            <div className="small muted">
              {d && `${d.toLocaleDateString(i18n.language)} ${formatTime(d, i18n.language)}`} ·{' '}
              {t(`report.reason_${r.reason}`)}
            </div>
            <div>
              <UserLink uid={r.reporterId} /> → <UserLink uid={r.targetUser} />
            </div>
            {r.snippet && <blockquote className="report-snippet">{r.snippet}</blockquote>}
            {r.comment && <div className="small">{r.comment}</div>}
            {!r.resolved && (
              <button
                className="btn btn-text"
                onClick={() =>
                  void adminResolveReport(r.id)
                    .then(() =>
                      setList((l) => l?.map((x) => (x.id === r.id ? { ...x, resolved: true } : x)) ?? null),
                    )
                    .catch((e: unknown) => showToast(t(errorKey(e))))
                }
              >
                {t('report.resolve')}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Сводка по сервису; «в сети сейчас» — по каналу присутствия. */
export function StatsTab() {
  const { t } = useTranslation();
  const showToast = useApp((s) => s.showToast);
  const [s, setS] = useState<Record<string, number> | null>(null);
  const online = useSyncExternalStore(onOnlineChange, () => getOnline().size);

  useEffect(() => {
    void adminStats()
      .then(setS)
      .catch((e: unknown) => showToast(t(errorKey(e))));
  }, [showToast, t]);

  if (!s) {
    return (
      <div className="center-pad">
        <Spinner />
      </div>
    );
  }
  const rows: [string, string | number][] = [
    [t('stats.users'), s.users],
    [t('stats.newDay'), `+${s.users_day}`],
    [t('stats.newWeek'), `+${s.users_week}`],
    [t('stats.onlineNow'), online],
    [t('stats.onlineHour'), s.online_hour],
    [t('stats.messagesDay'), s.messages_day],
    [t('stats.messagesWeek'), s.messages_week],
    [t('stats.groups'), s.groups],
    [t('stats.channels'), s.channels],
    [t('stats.premium'), s.premium],
    [t('stats.banned'), s.banned],
    [t('stats.spamblocked'), s.spamblocked],
    [t('stats.reportsOpen'), s.reports_open],
  ];
  return (
    <div className="stats-grid pad-x">
      {rows.map(([label, value]) => (
        <div key={label} className="stat-tile">
          <div className="stat-value">{value}</div>
          <div className="stat-label">{label}</div>
        </div>
      ))}
    </div>
  );
}
