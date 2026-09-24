import {
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  getDoc,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { db } from './init';
import { chatRef, inviteRef, sendMessage } from './db';
import type { Chat } from './types';
import { randomCode } from '../lib/ids';

export interface NewGroupInput {
  kind: 'group' | 'channel';
  title: string;
  description: string;
  avatar: string | null;
  members: string[];
}

export async function createGroup(me: string, input: NewGroupInput): Promise<string> {
  const ref = doc(collection(db, 'chats'));
  const members = [me, ...input.members.filter((m) => m !== me)];
  const { done } = sendMessage(
    ref.id,
    me,
    { text: '', system: { kind: 'created', title: input.title.trim() } },
    {
      type: input.kind,
      members,
      admins: [me],
      ownerId: me,
      title: input.title.trim(),
      avatar: input.avatar,
      description: input.description.trim(),
      inviteCode: null,
      lastMessage: null,
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      pinnedMessageIds: [],
      readBy: {},
    },
  );
  await done;
  return ref.id;
}

export async function updateGroupInfo(
  chat: Chat,
  me: string,
  patch: { title: string; description: string; avatar: string | null },
): Promise<void> {
  const title = patch.title.trim();
  await updateDoc(chatRef(chat.id), { title, description: patch.description.trim(), avatar: patch.avatar });
  if (chat.inviteCode) {
    await updateDoc(inviteRef(chat.inviteCode), { title, avatar: patch.avatar }).catch(() => undefined);
  }
  if (title !== chat.title && chat.type === 'group') {
    await sendMessage(chat.id, me, { text: '', system: { kind: 'renamed', title } }).done;
  }
}

export async function addMembers(chat: Chat, me: string, uids: string[]): Promise<void> {
  const fresh = uids.filter((u) => !chat.members.includes(u));
  if (!fresh.length) return;
  await updateDoc(chatRef(chat.id), { members: arrayUnion(...fresh) });
  if (chat.type === 'group') await sendMessage(chat.id, me, { text: '', system: { kind: 'added', uids: fresh } }).done;
}

export async function removeMember(chat: Chat, me: string, uid: string): Promise<void> {
  await updateDoc(chatRef(chat.id), { members: arrayRemove(uid), admins: arrayRemove(uid) });
  if (chat.type === 'group') await sendMessage(chat.id, me, { text: '', system: { kind: 'removed', uid } }).done;
}

export async function setAdmin(chat: Chat, uid: string, admin: boolean): Promise<void> {
  await updateDoc(chatRef(chat.id), { admins: admin ? arrayUnion(uid) : arrayRemove(uid) });
}

export async function leaveGroup(chat: Chat, me: string): Promise<void> {
  // Сначала системное сообщение (пока мы ещё участник), потом выход.
  if (chat.type === 'group') await sendMessage(chat.id, me, { text: '', system: { kind: 'left' } }).done;
  await updateDoc(chatRef(chat.id), { members: arrayRemove(me), admins: arrayRemove(me) });
}

export async function deleteGroup(chat: Chat): Promise<void> {
  const batch = writeBatch(db);
  if (chat.inviteCode) batch.delete(inviteRef(chat.inviteCode));
  batch.delete(chatRef(chat.id));
  await batch.commit();
}

/** Создаёт новую ссылку-приглашение (старая перестаёт работать). */
export async function resetInvite(chat: Chat): Promise<string> {
  const code = randomCode(12);
  const batch = writeBatch(db);
  batch.update(chatRef(chat.id), { inviteCode: code });
  batch.set(inviteRef(code), { chatId: chat.id, title: chat.title, type: chat.type, avatar: chat.avatar });
  if (chat.inviteCode) batch.delete(inviteRef(chat.inviteCode));
  await batch.commit();
  return code;
}

export interface InvitePreview {
  chatId: string;
  title: string;
  type: 'group' | 'channel';
  avatar: string | null;
}

export async function getInvite(code: string): Promise<InvitePreview | null> {
  const snap = await getDoc(inviteRef(code));
  return snap.exists() ? (snap.data() as InvitePreview) : null;
}

export async function joinByInvite(code: string, invite: InvitePreview, me: string): Promise<void> {
  await updateDoc(chatRef(invite.chatId), { members: arrayUnion(me), lastJoinCode: code });
  if (invite.type === 'group') await sendMessage(invite.chatId, me, { text: '', system: { kind: 'joined' } }).done;
}

export function inviteLink(code: string): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}#/join/${code}`;
}
