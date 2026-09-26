import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useApp, useMe } from '../../app/store';
import {
  deleteFolder,
  errorKey,
  fetchFolders,
  openPrivateChat,
  openSavedChat,
  searchMessages,
  searchUsers,
  type ChatFolder,
  type SearchHit,
} from '../../supabase/api';
import { stripMarkup } from '../../lib/markup';
import { FolderDialog } from './FolderDialog';
import { isPremium, matchedUsername, type Chat, type UserProfile } from '../../supabase/types';
import { Badges } from '../../ui/Badges';
import { Icon } from '../../ui/Icon';
import { Menu, type MenuItem } from '../../ui/Menu';
import { Spinner } from '../../ui/misc';
import { ChatListItem } from './ChatListItem';
import { displayNameOf, peekProfile } from '../../app/profiles';
import { refreshChats } from '../../app/session';
import { StoriesBar, StoryAvatar } from '../stories/Stories';

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
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [folder, setFolder] = useState<string>('all');
  const [folders, setFolders] = useState<ChatFolder[]>([]);
  const [folderEdit, setFolderEdit] = useState<ChatFolder | 'new' | null>(null);
  const [folderMenu, setFolderMenu] = useState<{ f: ChatFolder; x: number; y: number } | null>(null);
  const loadFolders = () =>
    void fetchFolders()
      .then(setFolders)
      .catch(() => undefined);
  useEffect(loadFolders, []);
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
      if (query.length >= 2) {
        searchMessages(query)
          .then((list) => !cancelled && setHits(list))
          .catch(() => !cancelled && setHits([]));
      } else setHits(null);
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  const inFolder = useMemo(() => {
    const custom = folders.find((f) => f.id === folder);
    return sorted.filter((c) => {
      if (custom) return custom.chatIds.includes(c.id);
      if (folder === 'private') return c.type === 'private' || c.type === 'saved';
      if (folder === 'groups') return c.type === 'group';
      if (folder === 'channels') return c.type === 'channel';
      if (folder === 'unread') return c.unread > 0;
      return true;
    });
  }, [sorted, folder, folders]);

  const matchedChats = useMemo(() => {
    if (!query) return inFolder;
    return sorted.filter((c) =>
      chatSearchText(c, t('chats.savedMessages')).includes(query.replace(/^@/, '')),
    );
  }, [sorted, inFolder, query, t]);

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
        {!query && <StoriesBar />}
        {!query && (
          <div className="folder-tabs" role="tablist">
            {[
              ['all', t('folders.all')],
              ['private', t('folders.private')],
              ['groups', t('folders.groups')],
              ['channels', t('folders.channels')],
              ['unread', t('folders.unread')],
            ].map(([id, label]) => (
              <button
                key={id}
                role="tab"
                aria-selected={folder === id}
                className={folder === id ? 'folder-tab active' : 'folder-tab'}
                onClick={() => setFolder(id)}
              >
                {label}
              </button>
            ))}
            {folders.map((f) => (
              <button
                key={f.id}
                role="tab"
                aria-selected={folder === f.id}
                className={folder === f.id ? 'folder-tab active' : 'folder-tab'}
                onClick={() => setFolder(f.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setFolderMenu({ f, x: e.clientX, y: e.clientY });
                }}
                onDoubleClick={(e) => setFolderMenu({ f, x: e.clientX, y: e.clientY })}
              >
                {f.title}
              </button>
            ))}
            <button
              className="folder-tab add"
              onClick={() => setFolderEdit('new')}
              aria-label={t('folders.new')}
            >
              <Icon name="plus" size={16} />
            </button>
          </div>
        )}
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

        {query && hits && hits.length > 0 && (
          <>
            <div className="list-caption">{t('chats.messages')}</div>
            {hits.map((h) => {
              const c = chats.find((x) => x.id === h.chatId);
              return (
                <button
                  key={h.id}
                  className="list-item search-hit"
                  onClick={() => {
                    setQ('');
                    navigate(`/c/${h.chatId}`, { state: { jump: h.id } });
                  }}
                >
                  <div className="list-item-body">
                    <div className="list-item-row">
                      <span className="list-item-title ellipsis">
                        {c ? chatSearchTitle(c, t('chats.savedMessages')) : '…'}
                      </span>
                      <span className="list-item-time">{new Date(h.createdAt).toLocaleDateString()}</span>
                    </div>
                    <div className="list-item-sub ellipsis">{stripMarkup(h.text)}</div>
                  </div>
                </button>
              );
            })}
          </>
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
                  <StoryAvatar userId={p.uid} name={p.displayName} seed={p.uid} src={p.avatar} size={46} />
                  <div className="list-item-body">
                    <div className="list-item-title">
                      <span className="ellipsis">{p.displayName}</span>
                      <Badges
                        verified={p.verified}
                        scam={p.scam}
                        premium={isPremium(p)}
                        emoji={p.emojiStatus}
                        developer={p.developer}
                        founder={p.founder}
                        size={15}
                      />
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
      {folderMenu && (
        <Menu
          x={folderMenu.x}
          y={folderMenu.y}
          onClose={() => setFolderMenu(null)}
          items={[
            { icon: 'edit', label: t('folders.edit'), onClick: () => setFolderEdit(folderMenu.f) },
            {
              icon: 'trash',
              label: t('folders.delete'),
              danger: true,
              onClick: () =>
                void deleteFolder(folderMenu.f.id).then(() => {
                  setFolder('all');
                  loadFolders();
                }),
            },
          ]}
        />
      )}
      {folderEdit && (
        <FolderDialog
          folder={folderEdit === 'new' ? null : folderEdit}
          chats={sorted}
          onClose={() => setFolderEdit(null)}
          onSaved={loadFolders}
        />
      )}
    </div>
  );
}

export function chatSearchTitle(chat: Chat, savedLabel: string): string {
  if (chat.type === 'saved') return savedLabel;
  if (chat.type === 'private' && chat.otherId) return displayNameOf(peekProfile(chat.otherId), '…');
  return chat.title ?? '';
}

function chatSearchText(chat: Chat, savedLabel: string): string {
  if (chat.type === 'saved') return savedLabel.toLowerCase();
  if (chat.type === 'private' && chat.otherId) {
    const p = peekProfile(chat.otherId);
    return `${displayNameOf(p)} ${p?.username ?? ''}`.toLowerCase();
  }
  return (chat.title ?? '').toLowerCase();
}
