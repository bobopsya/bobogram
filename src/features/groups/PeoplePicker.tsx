import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp, useMe } from '../../app/store';
import { searchUsers } from '../../supabase/api';
import type { UserProfile } from '../../supabase/types';
import { displayNameOf, peekProfile, useProfile } from '../../app/profiles';
import { Avatar } from '../../ui/Avatar';
import { Icon } from '../../ui/Icon';

function Chip({ uid, onRemove }: { uid: string; onRemove: () => void }) {
  const p = useProfile(uid);
  return (
    <button className="chip" onClick={onRemove}>
      <Avatar name={displayNameOf(p, '?')} seed={uid} src={p?.avatar} size={24} />
      <span>{displayNameOf(p, '…')}</span>
      <Icon name="close" size={14} />
    </button>
  );
}

function PersonRow({ uid, checked, disabled, onToggle }: { uid: string; checked: boolean; disabled: boolean; onToggle: () => void }) {
  const p = useProfile(uid);
  return (
    <button className="list-item" onClick={onToggle} disabled={disabled && !checked}>
      <Avatar name={displayNameOf(p, '?')} seed={uid} src={p?.avatar} size={42} />
      <div className="list-item-body">
        <div className="list-item-title">{displayNameOf(p, '…')}</div>
        {p && <div className="list-item-sub">@{p.username}</div>}
      </div>
      <span className={checked ? 'checkbox checked' : 'checkbox'}>{checked && <Icon name="check" size={14} />}</span>
    </button>
  );
}

interface Props {
  selected: string[];
  onChange: (uids: string[]) => void;
  max: number;
  exclude?: string[];
}

/** Выбор людей: собеседники из личных чатов + поиск по @имени. */
export function PeoplePicker({ selected, onChange, max, exclude = [] }: Props) {
  const { t } = useTranslation();
  const me = useMe();
  const chats = useApp((s) => s.chats);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<UserProfile[]>([]);

  const contacts = useMemo(
    () => chats.filter((c) => c.type === 'private' && c.otherId).map((c) => c.otherId!),
    [chats],
  );

  useEffect(() => {
    const query = q.trim();
    if (!query) {
      setFound([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      searchUsers(query)
        .then((list) => !cancelled && setFound(list))
        .catch(() => undefined);
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [q]);

  const query = q.trim().toLowerCase().replace(/^@/, '');
  const list = query
    ? [
        ...new Set([
          ...contacts.filter((uid) => {
            const p = peekProfile(uid);
            return `${p?.displayName ?? ''} ${p?.username ?? ''}`.toLowerCase().includes(query);
          }),
          ...found.map((p) => p.uid),
        ]),
      ]
    : contacts;
  const visible = list.filter((uid) => uid !== me && !exclude.includes(uid));

  const toggle = (uid: string) =>
    onChange(selected.includes(uid) ? selected.filter((x) => x !== uid) : [...selected, uid]);

  return (
    <div className="people-picker">
      {selected.length > 0 && (
        <div className="chips">
          {selected.map((uid) => (
            <Chip key={uid} uid={uid} onRemove={() => toggle(uid)} />
          ))}
        </div>
      )}
      <input
        className="input"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t('groups.searchPeople')}
        autoCapitalize="none"
        autoCorrect="off"
      />
      <div className="muted small pad-x">{t('groups.selected', { count: selected.length, max })}</div>
      {visible.map((uid) => (
        <PersonRow
          key={uid}
          uid={uid}
          checked={selected.includes(uid)}
          disabled={selected.length >= max}
          onToggle={() => toggle(uid)}
        />
      ))}
    </div>
  );
}
