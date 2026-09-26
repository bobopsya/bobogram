import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Message } from '../../supabase/types';
import { createPoll, errorKey, fetchMyPollVotes, fetchPollVoters, votePoll } from '../../supabase/api';
import { displayNameOf, peekProfile, useProfilesLoaded } from '../../app/profiles';
import { useApp } from '../../app/store';
import { Modal } from '../../ui/Modal';
import { Switch } from '../../ui/misc';
import { Icon } from '../../ui/Icon';

/** Опрос в пузыре: до голоса — варианты, после — проценты с полосками. */
export function PollView({ msg, canVote }: { msg: Message; canVote: boolean }) {
  const { t } = useTranslation();
  const showToast = useApp((s) => s.showToast);
  const poll = msg.poll!;
  const [mine, setMine] = useState<number[] | null>(null);
  const [draft, setDraft] = useState<number[]>([]);
  const [voters, setVoters] = useState<{ option: number; userId: string }[] | null>(null);
  const voted = !!mine && mine.length > 0;

  useEffect(() => {
    if (msg.pending) return;
    void fetchMyPollVotes(msg.id)
      .then(setMine)
      .catch(() => setMine([]));
  }, [msg.id, msg.pending]);

  const vote = (options: number[]) =>
    void votePoll(msg.id, options)
      .then(() => {
        setMine(options);
        setDraft([]);
      })
      .catch((e: unknown) => showToast(t(errorKey(e))));

  const total = Math.max(
    1,
    poll.counts.reduce((a, b) => a + b, 0),
  );
  useProfilesLoaded(voters ? [...new Set(voters.map((v) => v.userId))] : []);

  return (
    <div className="poll" onClick={(e) => e.stopPropagation()}>
      <div className="poll-question">{poll.question}</div>
      <div className="poll-kind muted small">
        {poll.anonymous ? t('poll.anonymous') : t('poll.public')}
        {poll.multiple ? ` · ${t('poll.multipleShort')}` : ''}
      </div>
      {poll.options.map((opt, i) => {
        const count = poll.counts[i] ?? 0;
        const pct = Math.round((count / total) * 100);
        const chosen = voted ? mine!.includes(i) : draft.includes(i);
        return (
          <button
            key={i}
            className={voted ? 'poll-option voted' : 'poll-option'}
            disabled={!canVote || msg.pending}
            onClick={() => {
              if (voted) return;
              if (!poll.multiple) vote([i]);
              else setDraft((d) => (d.includes(i) ? d.filter((x) => x !== i) : [...d, i]));
            }}
          >
            {voted ? (
              <>
                <span className="poll-pct">{pct}%</span>
                <span className="poll-label">
                  {opt}
                  {chosen && <Icon name="check" size={14} className="poll-check" />}
                </span>
                <span className="poll-bar" style={{ width: `${pct}%` }} />
              </>
            ) : (
              <>
                <span className={chosen ? 'poll-radio on' : 'poll-radio'} />
                <span className="poll-label">{opt}</span>
              </>
            )}
          </button>
        );
      })}
      <div className="poll-footer">
        <span className="muted small">{t('poll.votes', { count: poll.voters })}</span>
        {poll.multiple && !voted && draft.length > 0 && (
          <button className="btn btn-text small" onClick={() => vote(draft)}>
            {t('poll.vote')}
          </button>
        )}
        {voted && canVote && (
          <button className="btn btn-text small" onClick={() => vote([])}>
            {t('poll.retract')}
          </button>
        )}
        {!poll.anonymous && poll.voters > 0 && (
          <button
            className="btn btn-text small"
            onClick={() =>
              void fetchPollVoters(msg.id)
                .then(setVoters)
                .catch((e: unknown) => showToast(t(errorKey(e))))
            }
          >
            {t('poll.whoVoted')}
          </button>
        )}
      </div>
      {voters && (
        <Modal title={poll.question} onClose={() => setVoters(null)}>
          <div className="stack">
            {poll.options.map((opt, i) => (
              <div key={i}>
                <div className="field-label">{opt}</div>
                <div className="small">
                  {voters
                    .filter((v) => v.option === i)
                    .map((v) => displayNameOf(peekProfile(v.userId), '…'))
                    .join(', ') || '—'}
                </div>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

/** Создание опроса: вопрос, 2–10 вариантов, анонимный/открытый, несколько ответов. */
export function PollDialog({
  chatId,
  topicId,
  onClose,
}: {
  chatId: string;
  topicId?: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const showToast = useApp((s) => s.showToast);
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [anonymous, setAnonymous] = useState(true);
  const [multiple, setMultiple] = useState(false);
  const [busy, setBusy] = useState(false);
  const filled = options.map((o) => o.trim()).filter(Boolean);
  const ok = question.trim().length > 0 && filled.length >= 2;

  const submit = async () => {
    setBusy(true);
    try {
      await createPoll({
        id: crypto.randomUUID(),
        chatId,
        question: question.trim(),
        options: filled,
        anonymous,
        multiple,
        topicId,
      });
      onClose();
    } catch (e) {
      showToast(t(errorKey(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={t('poll.new')}
      onClose={onClose}
      footer={
        <button className="btn btn-primary" disabled={!ok || busy} onClick={() => void submit()}>
          {t('poll.create')}
        </button>
      }
    >
      <div className="stack">
        <label className="field">
          <span className="field-label">{t('poll.question')}</span>
          <input value={question} maxLength={300} onChange={(e) => setQuestion(e.target.value)} autoFocus />
        </label>
        <div className="field-label">{t('poll.options')}</div>
        {options.map((o, i) => (
          <div key={i} className="row gap">
            <input
              className="input grow"
              value={o}
              maxLength={100}
              placeholder={t('poll.option', { n: i + 1 })}
              onChange={(e) => setOptions((list) => list.map((x, j) => (j === i ? e.target.value : x)))}
            />
            {options.length > 2 && (
              <button
                className="icon-btn small"
                aria-label={t('common.delete')}
                onClick={() => setOptions((list) => list.filter((_, j) => j !== i))}
              >
                <Icon name="close" size={16} />
              </button>
            )}
          </div>
        ))}
        {options.length < 10 && (
          <button className="btn btn-text" onClick={() => setOptions((l) => [...l, ''])}>
            + {t('poll.addOption')}
          </button>
        )}
        <div className="info-item">
          <div className="grow">{t('poll.anonymous')}</div>
          <Switch checked={anonymous} onChange={setAnonymous} />
        </div>
        <div className="info-item">
          <div className="grow">{t('poll.multiple')}</div>
          <Switch checked={multiple} onChange={setMultiple} />
        </div>
      </div>
    </Modal>
  );
}
