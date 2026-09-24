import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteField,
  doc,
  FieldPath,
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type DocumentSnapshot,
  type QueryDocumentSnapshot,
  type Timestamp,
} from 'firebase/firestore';
import { db } from './init';
import type {
  Chat,
  ChatType,
  ForwardRef,
  LastMessage,
  Message,
  ReplyRef,
  SystemEvent,
  UserChatPrefs,
  UserProfile,
} from './types';
import { privateMembers, randomCode, savedChatId } from '../lib/ids';
import { normalizeUsername } from '../lib/username';

// ---------- ссылки ----------
export const userRef = (uid: string) => doc(db, 'users', uid);
export const usernameRef = (name: string) => doc(db, 'usernames', normalizeUsername(name).toLowerCase());
export const chatRef = (chatId: string) => doc(db, 'chats', chatId);
export const messagesCol = (chatId: string) => collection(db, 'chats', chatId, 'messages');
export const messageRef = (chatId: string, id: string) => doc(db, 'chats', chatId, 'messages', id);
export const userChatsCol = (uid: string) => collection(db, 'userChats', uid, 'items');
export const userChatRef = (uid: string, chatId: string) => doc(db, 'userChats', uid, 'items', chatId);
export const blocksRef = (uid: string) => doc(db, 'blocks', uid);
export const inviteRef = (code: string) => doc(db, 'invites', code);

// ---------- преобразование документов ----------
type Snap = DocumentSnapshot<DocumentData> | QueryDocumentSnapshot<DocumentData>;

export function toProfile(snap: Snap): UserProfile | null {
  const d = snap.data({ serverTimestamps: 'estimate' });
  if (!d) return null;
  return {
    uid: snap.id,
    username: d.username ?? '',
    usernameLower: d.usernameLower ?? '',
    displayName: d.displayName ?? '',
    bio: d.bio ?? '',
    avatar: d.avatar ?? null,
    createdAt: d.createdAt ?? null,
    role: d.role === 'admin' ? 'admin' : 'user',
    banned: d.banned === true,
    hideLastSeen: d.hideLastSeen === true,
  };
}

export function toChat(snap: Snap): Chat | null {
  const d = snap.data({ serverTimestamps: 'estimate' });
  if (!d) return null;
  return {
    id: snap.id,
    type: d.type,
    members: d.members ?? [],
    admins: d.admins ?? [],
    ownerId: d.ownerId ?? null,
    title: d.title ?? null,
    avatar: d.avatar ?? null,
    description: d.description ?? '',
    inviteCode: d.inviteCode ?? null,
    lastMessage: d.lastMessage ?? null,
    updatedAt: d.updatedAt ?? null,
    createdAt: d.createdAt ?? null,
    pinnedMessageIds: d.pinnedMessageIds ?? [],
    readBy: d.readBy ?? {},
  };
}

export function toMessage(snap: Snap): Message {
  const d = snap.data({ serverTimestamps: 'estimate' }) ?? {};
  return {
    id: snap.id,
    senderId: d.senderId,
    text: d.text ?? '',
    createdAt: d.createdAt ?? null,
    editedAt: d.editedAt ?? null,
    deleted: d.deleted === true,
    deletedFor: d.deletedFor ?? [],
    replyTo: d.replyTo ?? null,
    forwardedFrom: d.forwardedFrom ?? null,
    reactions: d.reactions ?? {},
    system: d.system ?? null,
    call: d.call ?? null,
    pending: snap.metadata.hasPendingWrites,
  };
}

export function toPrefs(data: DocumentData | undefined): UserChatPrefs {
  return { pinned: data?.pinned === true, mutedUntil: data?.mutedUntil ?? null };
}

// ---------- профиль ----------
export async function isUsernameFree(name: string, myUid?: string): Promise<boolean> {
  const snap = await getDoc(usernameRef(name));
  return !snap.exists() || snap.data().uid === myUid;
}

/** Создаёт профиль и «занимает» юзернейм одной атомарной записью. */
export async function createProfile(uid: string, username: string, displayName: string): Promise<void> {
  const name = normalizeUsername(username);
  const batch = writeBatch(db);
  batch.set(userRef(uid), {
    username: name,
    usernameLower: name.toLowerCase(),
    displayName: displayName.trim(),
    bio: '',
    avatar: null,
    createdAt: serverTimestamp(),
    role: 'user',
    banned: false,
    hideLastSeen: false,
  });
  batch.set(usernameRef(name), { uid });
  await batch.commit();
}

export async function updateProfile(
  uid: string,
  patch: Partial<Pick<UserProfile, 'displayName' | 'bio' | 'avatar' | 'hideLastSeen'>>,
): Promise<void> {
  await updateDoc(userRef(uid), patch);
}

/** Меняет юзернейм: новый занимается, старый освобождается. */
export async function changeUsername(uid: string, oldName: string, newName: string): Promise<void> {
  const name = normalizeUsername(newName);
  const batch = writeBatch(db);
  batch.update(userRef(uid), { username: name, usernameLower: name.toLowerCase() });
  if (oldName.toLowerCase() !== name.toLowerCase()) {
    batch.set(usernameRef(name), { uid });
    batch.delete(usernameRef(oldName));
  }
  await batch.commit();
}

export async function findUserByUsername(name: string): Promise<UserProfile | null> {
  const snap = await getDoc(usernameRef(name));
  if (!snap.exists()) return null;
  return toProfile(await getDoc(userRef(snap.data().uid)));
}

export async function searchUsers(prefix: string): Promise<UserProfile[]> {
  const p = normalizeUsername(prefix).toLowerCase();
  if (!p) return [];
  const q = query(
    collection(db, 'users'),
    where('usernameLower', '>=', p),
    where('usernameLower', '<', p + ''),
    limit(20),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => toProfile(d)).filter((u): u is UserProfile => u !== null);
}

// ---------- чёрный список ----------
export async function setBlocked(me: string, other: string, blocked: boolean): Promise<void> {
  await setDoc(blocksRef(me), { list: blocked ? arrayUnion(other) : arrayRemove(other) }, { merge: true });
}

// ---------- сообщения ----------
export interface SendOptions {
  text: string;
  replyTo?: ReplyRef | null;
  forwardedFrom?: ForwardRef | null;
  system?: SystemEvent | null;
  call?: Message['call'];
}

/** Описание нового чата, если документа ещё нет (первое сообщение в личке или «Избранное»). */
export function draftChat(chatId: string, me: string, other?: string): Record<string, unknown> {
  const isSaved = chatId === savedChatId(me);
  return {
    type: (isSaved ? 'saved' : 'private') satisfies ChatType,
    members: isSaved ? [me] : privateMembers(me, other!),
    admins: [],
    ownerId: null,
    title: null,
    avatar: null,
    description: '',
    inviteCode: null,
    lastMessage: null,
    updatedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    pinnedMessageIds: [],
    readBy: {},
  };
}

export function snippetOf(text: string, max = 120): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? oneLine.slice(0, max - 1) + '…' : oneLine;
}

/**
 * Отправляет сообщение. Промис завершается, когда сервер подтвердит запись;
 * в офлайне сообщение сразу появляется в чате с «часиками».
 * @param newChat данные для создания чата, если его ещё нет.
 */
export function sendMessage(
  chatId: string,
  me: string,
  opts: SendOptions,
  newChat?: Record<string, unknown> | null,
): { id: string; done: Promise<void> } {
  const ref = doc(messagesCol(chatId));
  const batch = writeBatch(db);
  batch.set(ref, {
    senderId: me,
    text: opts.text,
    createdAt: serverTimestamp(),
    editedAt: null,
    deleted: false,
    deletedFor: [],
    replyTo: opts.replyTo ?? null,
    forwardedFrom: opts.forwardedFrom ?? null,
    reactions: {},
    system: opts.system ?? null,
    call: opts.call ?? null,
  });
  const last: Omit<LastMessage, 'createdAt'> & { createdAt: unknown } = {
    id: ref.id,
    text: snippetOf(opts.text),
    senderId: me,
    createdAt: serverTimestamp(),
    system: opts.system ? true : false,
    event: opts.system ?? null,
    call: opts.call ?? null,
  };
  if (newChat) {
    batch.set(chatRef(chatId), { ...newChat, lastMessage: last, readBy: { [me]: serverTimestamp() } });
  } else {
    batch.update(chatRef(chatId), {
      lastMessage: last,
      updatedAt: serverTimestamp(),
      [`readBy.${me}`]: serverTimestamp(),
    });
  }
  return { id: ref.id, done: batch.commit() };
}

export async function editMessage(chatId: string, id: string, text: string): Promise<void> {
  await updateDoc(messageRef(chatId, id), { text, editedAt: serverTimestamp() });
}

export async function deleteForEveryone(chat: Chat, id: string, me: string): Promise<void> {
  const batch = writeBatch(db);
  batch.update(messageRef(chat.id, id), {
    deleted: true,
    text: '',
    replyTo: null,
    forwardedFrom: null,
    reactions: {},
  });
  if (chat.lastMessage?.id === id && (chat.lastMessage.senderId === me || chat.admins.includes(me))) {
    batch.update(chatRef(chat.id), { lastMessage: { ...chat.lastMessage, text: '', deleted: true } });
  }
  await batch.commit();
}

export async function deleteForMe(chatId: string, id: string, me: string): Promise<void> {
  await updateDoc(messageRef(chatId, id), { deletedFor: arrayUnion(me) });
}

/** Одна реакция на человека, как в Telegram: новая заменяет старую, повторная снимает. */
export async function toggleReaction(chatId: string, msg: Message, emoji: string, me: string): Promise<void> {
  const had = msg.reactions[emoji]?.includes(me) ?? false;
  const args: unknown[] = [];
  for (const [e, uids] of Object.entries(msg.reactions)) {
    if (e !== emoji && uids.includes(me)) args.push(new FieldPath('reactions', e), arrayRemove(me));
  }
  args.push(new FieldPath('reactions', emoji), had ? arrayRemove(me) : arrayUnion(me));
  const [first, firstValue, ...rest] = args;
  await updateDoc(messageRef(chatId, msg.id), first as FieldPath, firstValue, ...rest);
}

export async function markRead(chatId: string, me: string): Promise<void> {
  await updateDoc(chatRef(chatId), { [`readBy.${me}`]: serverTimestamp() });
}

export async function setPinnedMessages(chatId: string, ids: string[]): Promise<void> {
  await updateDoc(chatRef(chatId), { pinnedMessageIds: ids });
}

export async function countUnread(chatId: string, since: Timestamp | null): Promise<number> {
  const base = messagesCol(chatId);
  const q = since ? query(base, where('createdAt', '>', since)) : query(base);
  const snap = await getCountFromServer(q);
  return snap.data().count;
}

export async function fetchOlderMessages(chatId: string, count: number): Promise<Message[]> {
  const snap = await getDocs(query(messagesCol(chatId), orderBy('createdAt', 'desc'), limit(count)));
  return snap.docs.map(toMessage);
}

// ---------- личные настройки чатов ----------
export async function setChatPinned(me: string, chatId: string, pinned: boolean): Promise<void> {
  await setDoc(userChatRef(me, chatId), { pinned }, { merge: true });
}

export async function setChatMuted(me: string, chatId: string, mutedUntil: number | null): Promise<void> {
  await setDoc(userChatRef(me, chatId), { mutedUntil: mutedUntil ?? deleteField() }, { merge: true });
}

export { randomCode };
