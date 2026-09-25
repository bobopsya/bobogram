import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useApp, useMe } from '../../app/store';
import { errorKey, openPrivateChat, openSavedChat, searchUsers } from '../../supabase/api';
import { isPremium, matchedUsername, type Chat, type UserProfile } from '../../supabase/types';
import { Badges } from '../../ui/Badges';
import { Icon } from '../../ui/Icon';
import { Menu, type MenuItem } from '../../ui/Menu';
import { Avatar } from '../../ui/Avatar';
import { Spinner } from '../../ui/misc';
import { ChatListItem } from './ChatListItem';
import { displayNameOf, peekProfile } from '../../app/profiles';
import { refreshChats } from '../../app/session';

/** Открыть личку с человеком (или «Избранное», если это я). */
export function useOpenChatWith() {
  const navigate = useNavigate();
  const me = useMe();
  const showToast = useApp((s) => s.showToast);
  const { t } = useTranslation();
  return async (uid: string) => {
    try {
      const id = uid === me ? await openSavedChat() : await openPrivateChat(uid);
      refreshChats(0);
      navigate(`/c/${id}`);
    } catch (err) {
      showToast(t(errorKey(err)));
    }
  };
}

/** «@имя» или «💎 @нфт», если человек нашёлся по коллекционному имени. */
function usernameLabel(p: UserProfile, query: string): string {
  const m = matchedUsername(p, query);
  return (m.nft ? '💎 @' : '@') + m.name;
}

export function ChatList() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const me = useMe();
  const profile = useApp((s) => s.profile);
  const chats = useApp((s) => s.chats);
  const chatsLoaded = useApp((s) => s.chatsLoaded);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [fabMenu, setFabMenu] = useState<{ x: number; y: number } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  const [people, setPeople] = useState<UserProfile[] | null>(null);
  const openChatWith = useOpenChatWith();

  const activeId = location.pathname.match(/^\/c\/([^/]+)/)?.[1] ?? null;

  const sorted = useMemo(
    () =>
      chats
        // Пустые личные чаты (открыли профиль, но не написали) не показываем.
        .filter((c) => c.lastMessage || c.type !== 'private' || c.id === activeId)
        .sort((a, b) => (a.pinned !== b.pinned ? (a.pinned ? -1 : 1) : b.updatedAt - a.updatedAt)),
    [chats, activeId],
  );

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
    return sorted.filter((c) =>
      chatSearchText(c, t('chats.savedMessages')).includes(query.replace(/^@/, '')),
    );
  }, [sorted, query, t]);

  const menuItems: MenuItem[] = [
    { icon: 'user', label: t('profile.myProfile'), onClick: () => navigate('/settings/profile') },
    { icon: 'users', label: t('chats.newGroup'), onClick: () => navigate('/new/group') },
    { icon: 'megaphone', label: t('chats.newChannel'), onClick: () => navigate('/new/channel') },
    { icon: 'bookmark', label: t('chats.savedMessages'), onClick: () => void openChatWith(me) },
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
        {!chatsLoaded && chats.length === 0 ? (
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
                    void openChatWith(p.uid);
                  }}
                >
                  <Avatar name={p.displayName} seed={p.uid} src={p.avatar} size={46} />
                  <div className="list-item-body">
                    <div className="list-item-title">
                      <span className="ellipsis">{p.displayName}</span>
                      <Badges verified={p.verified} scam={p.scam} premium={isPremium(p)} size={15} />
                    </div>
                    <div className="list-item-sub accent">{usernameLabel(p, query)}</div>
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

function chatSearchText(chat: Chat, savedLabel: string): string {
  if (chat.type === 'saved') return savedLabel.toLowerCase();
  if (chat.type === 'private' && chat.otherId) {
    const p = peekProfile(chat.otherId);
    return `${displayNameOf(p)} ${p?.username ?? ''}`.toLowerCase();
  }
  return (chat.title ?? '').toLowerCase();
}
