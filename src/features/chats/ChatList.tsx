import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useApp, useMe } from '../../app/store';
import { searchUsers } from '../../firebase/db';
import type { Chat, UserProfile } from '../../firebase/types';
import { privateChatId, savedChatId } from '../../lib/ids';
import { toMillis } from '../../lib/time';
import { Icon } from '../../ui/Icon';
import { Menu, type MenuItem } from '../../ui/Menu';
import { Avatar } from '../../ui/Avatar';
import { Spinner } from '../../ui/misc';
import { ChatListItem } from './ChatListItem';
import { displayNameOf, peekProfile } from '../../app/profiles';
import { otherMember } from '../../lib/ids';

export function ChatList() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const me = useMe();
  const profile = useApp((s) => s.profile);
  const chats = useApp((s) => s.chats);
  const chatsLoaded = useApp((s) => s.chatsLoaded);
  const prefs = useApp((s) => s.prefs);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [fabMenu, setFabMenu] = useState<{ x: number; y: number } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  const [people, setPeople] = useState<UserProfile[] | null>(null);

  const activeId = location.pathname.match(/^\/c\/([^/]+)/)?.[1] ?? null;

  const sorted = useMemo(() => {
    return [...chats].sort((a, b) => {
      const pa = prefs[a.id]?.pinned ? 1 : 0;
      const pb = prefs[b.id]?.pinned ? 1 : 0;
      if (pa !== pb) return pb - pa;
      return toMillis(b.updatedAt) - toMillis(a.updatedAt);
    });
  }, [chats, prefs]);

  const query = q.trim().toLowerCase();

  // Поиск людей по @имени с задержкой.
  useEffect(() => {
    if (!query) {
      setPeople(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      searchUsers(query)
        .then((list) => !cancelled && setPeople(list))
        .catch(() => !cancelled && setPeople([]));
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  const matchedChats = useMemo(() => {
    if (!query) return sorted;
    return sorted.filter((c) => chatSearchText(c, me, t('chats.savedMessages')).includes(query.replace(/^@/, '')));
  }, [sorted, query, me, t]);

  const menuItems: MenuItem[] = [
    { icon: 'user', label: t('profile.myProfile'), onClick: () => navigate('/settings/profile') },
    { icon: 'users', label: t('chats.newGroup'), onClick: () => navigate('/new/group') },
    { icon: 'megaphone', label: t('chats.newChannel'), onClick: () => navigate('/new/channel') },
    { icon: 'bookmark', label: t('chats.savedMessages'), onClick: () => navigate(`/c/${savedChatId(me)}`) },
    { icon: 'settings', label: t('settings.title'), onClick: () => navigate('/settings') },
  ];
  if (profile?.role === 'admin') {
    menuItems.push({ icon: 'shield', label: t('settings.adminPanel'), onClick: () => navigate('/admin') });
  }

  return (
    <div className="chat-list">
      <header className="topbar">
        <button
          className="icon-btn"
          aria-label="menu"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setMenu({ x: r.left, y: r.bottom + 4 });
          }}
        >
          <Icon name="menu" />
        </button>
        <div className="search-box">
          <Icon name="search" size={18} />
          <input
            ref={searchRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('chats.searchPlaceholder')}
            autoCapitalize="none"
            autoCorrect="off"
            enterKeyHint="search"
          />
          {q && (
            <button className="icon-btn small" onClick={() => setQ('')} aria-label={t('common.close')}>
              <Icon name="close" size={16} />
            </button>
          )}
        </div>
      </header>

      <div className="chat-list-scroll">
        {query && <div className="list-caption">{t('chats.yourChats')}</div>}
        {!chatsLoaded ? (
          <div className="center-pad">
            <Spinner />
          </div>
        ) : matchedChats.length === 0 && !query ? (
          <div className="list-empty">{t('chats.noChats')}</div>
        ) : (
          matchedChats.map((chat) => (
            <ChatListItem
              key={chat.id}
              chat={chat}
              active={chat.id === activeId}
              prefs={prefs[chat.id]}
              onClick={() => {
                setQ('');
                navigate(`/c/${chat.id}`);
              }}
            />
          ))
        )}

        {query && (
          <>
            <div className="list-caption">{t('chats.people')}</div>
            {people === null ? (
              <div className="center-pad">
                <Spinner size={22} />
              </div>
            ) : people.length === 0 ? (
              <div className="list-empty small">{t('chats.noResults')}</div>
            ) : (
              people.map((p) => (
                <button
                  key={p.uid}
                  className="list-item"
                  onClick={() => {
                    setQ('');
                    navigate(p.uid === me ? `/c/${savedChatId(me)}` : `/c/${privateChatId(me, p.uid)}`);
                  }}
                >
                  <Avatar name={p.displayName} seed={p.uid} src={p.avatar} size={46} />
                  <div className="list-item-body">
                    <div className="list-item-title">{p.displayName}</div>
                    <div className="list-item-sub accent">@{p.username}</div>
                  </div>
                </button>
              ))
            )}
          </>
        )}
      </div>

      <button
        className="fab"
        aria-label={t('chats.newMessage')}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setFabMenu({ x: r.right - 220, y: r.top - 150 });
        }}
      >
        <Icon name="edit" />
      </button>
      {fabMenu && (
        <Menu
          x={fabMenu.x}
          y={fabMenu.y}
          onClose={() => setFabMenu(null)}
          items={[
            { icon: 'user', label: t('chats.newMessage'), onClick: () => searchRef.current?.focus() },
            { icon: 'users', label: t('chats.newGroup'), onClick: () => navigate('/new/group') },
            { icon: 'megaphone', label: t('chats.newChannel'), onClick: () => navigate('/new/channel') },
          ]}
        />
      )}

      {menu && <Menu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />}
    </div>
  );
}

function chatSearchText(chat: Chat, me: string, savedLabel: string): string {
  if (chat.type === 'saved') return savedLabel.toLowerCase();
  if (chat.type === 'private') {
    const p = peekProfile(otherMember(chat.members, me));
    return `${displayNameOf(p)} ${p?.username ?? ''}`.toLowerCase();
  }
  return (chat.title ?? '').toLowerCase();
}
