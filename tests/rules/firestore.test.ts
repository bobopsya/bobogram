import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  arrayRemove,
  arrayUnion,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  collection,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-bobogram',
    firestore: { rules: readFileSync('firebase/firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});
afterAll(() => env.cleanup());
beforeEach(() => env.clearFirestore());

const verified = (uid: string) => env.authenticatedContext(uid, { email_verified: true }).firestore() as unknown as Firestore;
const unverified = (uid: string) =>
  env.authenticatedContext(uid, { email_verified: false }).firestore() as unknown as Firestore;

function profile(username: string, extra: Record<string, unknown> = {}) {
  return {
    username,
    usernameLower: username.toLowerCase(),
    displayName: username,
    bio: '',
    avatar: null,
    createdAt: serverTimestamp(),
    role: 'user',
    banned: false,
    hideLastSeen: false,
    ...extra,
  };
}

async function register(db: Firestore, uid: string, username: string) {
  const b = writeBatch(db);
  b.set(doc(db, 'users', uid), profile(username));
  b.set(doc(db, 'usernames', username.toLowerCase()), { uid });
  await b.commit();
}

/** Засеивает пользователей в обход правил. */
async function seedUsers(...list: [string, Record<string, unknown>?][]) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore() as unknown as Firestore;
    for (const [uid, extra] of list) {
      await setDoc(doc(db, 'users', uid), { ...profile(uid + 'name', extra), createdAt: new Date() });
      await setDoc(doc(db, 'usernames', uid + 'name'), { uid });
    }
  });
}

function message(sender: string, text = 'hi', extra: Record<string, unknown> = {}) {
  return {
    senderId: sender,
    text,
    createdAt: serverTimestamp(),
    editedAt: null,
    deleted: false,
    deletedFor: [],
    replyTo: null,
    forwardedFrom: null,
    reactions: {},
    system: null,
    call: null,
    ...extra,
  };
}

function chatDoc(type: string, members: string[], extra: Record<string, unknown> = {}) {
  return {
    type,
    members,
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
    ...extra,
  };
}

/** Первое сообщение в личке: чат + сообщение одной пачкой, как в приложении. */
async function firstMessage(db: Firestore, from: string, to: string, text = 'hi') {
  const [a, b] = from < to ? [from, to] : [to, from];
  const chatId = `${a}_${b}`;
  const batch = writeBatch(db);
  const msg = doc(collection(db, 'chats', chatId, 'messages'));
  batch.set(msg, message(from, text));
  batch.set(doc(db, 'chats', chatId), {
    ...chatDoc('private', [a, b]),
    lastMessage: { id: msg.id, text, senderId: from, createdAt: serverTimestamp() },
    readBy: { [from]: serverTimestamp() },
  });
  await batch.commit();
  return { chatId, msgId: msg.id };
}

async function seedGroup(id: string, type: 'group' | 'channel', owner: string, members: string[], extra = {}) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore() as unknown as Firestore;
    await setDoc(doc(db, 'chats', id), {
      ...chatDoc(type, [owner, ...members], { ownerId: owner, admins: [owner], title: 'G' }),
      createdAt: new Date(),
      updatedAt: new Date(),
      ...extra,
    });
  });
}

describe('регистрация и юзернеймы', () => {
  it('создаёт профиль вместе с юзернеймом', async () => {
    await assertSucceeds(register(unverified('alice'), 'alice', 'Alice_1'));
  });

  it('не даёт занять чужой юзернейм', async () => {
    await register(unverified('alice'), 'alice', 'alice1');
    await assertFails(register(unverified('bob'), 'bob', 'ALICE1'));
  });

  it('не создаёт профиль без документа юзернейма', async () => {
    const db = unverified('alice');
    await assertFails(setDoc(doc(db, 'users', 'alice'), profile('alice1')));
  });

  it('проверяет формат юзернейма', async () => {
    await assertFails(register(unverified('alice'), 'alice', '1abc'));
    await assertFails(register(unverified('alice'), 'alice', 'ab'));
    await assertFails(register(unverified('alice'), 'alice', 'привет'));
  });

  it('нельзя выдать себе админа или снять бан', async () => {
    await seedUsers(['alice']);
    const db = verified('alice');
    await assertFails(updateDoc(doc(db, 'users', 'alice'), { role: 'admin' }));
    await assertFails(updateDoc(doc(db, 'users', 'alice'), { banned: true }));
    await assertSucceeds(updateDoc(doc(db, 'users', 'alice'), { bio: 'hello' }));
  });

  it('смена юзернейма освобождает старый', async () => {
    await seedUsers(['alice']);
    const db = verified('alice');
    const b = writeBatch(db);
    b.update(doc(db, 'users', 'alice'), { username: 'newname', usernameLower: 'newname' });
    b.set(doc(db, 'usernames', 'newname'), { uid: 'alice' });
    b.delete(doc(db, 'usernames', 'alicename'));
    await assertSucceeds(b.commit());
  });

  it('проверка занятости юзернейма доступна без входа', async () => {
    await seedUsers(['alice']);
    const anon = env.unauthenticatedContext().firestore() as unknown as Firestore;
    await assertSucceeds(getDoc(doc(anon, 'usernames', 'alicename')));
  });
});

describe('личные чаты', () => {
  beforeEach(() => seedUsers(['alice'], ['bob'], ['carol']));

  it('без подтверждённой почты писать нельзя', async () => {
    await assertFails(firstMessage(unverified('alice'), 'alice', 'bob'));
  });

  it('первое сообщение создаёт чат', async () => {
    await assertSucceeds(firstMessage(verified('alice'), 'alice', 'bob'));
  });

  it('чужие не читают переписку', async () => {
    const { chatId } = await firstMessage(verified('alice'), 'alice', 'bob');
    await assertSucceeds(getDoc(doc(verified('bob'), 'chats', chatId)));
    await assertFails(getDoc(doc(verified('carol'), 'chats', chatId)));
    await assertFails(getDocs(collection(verified('carol'), 'chats', chatId, 'messages')));
  });

  it('нельзя создать личку с чужим ID', async () => {
    const db = verified('carol');
    const batch = writeBatch(db);
    batch.set(doc(db, 'chats', 'alice_bob'), chatDoc('private', ['alice', 'bob']));
    await assertFails(batch.commit());
  });

  it('список чатов — только свои', async () => {
    await firstMessage(verified('alice'), 'alice', 'bob');
    const db = verified('carol');
    await assertSucceeds(getDocs(query(collection(db, 'chats'), where('members', 'array-contains', 'carol'))));
    await assertFails(getDocs(collection(db, 'chats')));
  });

  it('заблокированный не может писать', async () => {
    const { chatId } = await firstMessage(verified('alice'), 'alice', 'bob');
    await assertSucceeds(setDoc(doc(verified('bob'), 'blocks', 'bob'), { list: ['alice'] }));
    const db = verified('alice');
    await assertFails(setDoc(doc(collection(db, 'chats', chatId, 'messages')), message('alice')));
  });

  it('нельзя отправить сообщение от чужого имени', async () => {
    const { chatId } = await firstMessage(verified('alice'), 'alice', 'bob');
    const db = verified('alice');
    await assertFails(setDoc(doc(collection(db, 'chats', chatId, 'messages')), message('bob')));
  });

  it('правка — только своих, реакции и «удалить у себя» — любые', async () => {
    const { chatId, msgId } = await firstMessage(verified('alice'), 'alice', 'bob');
    const ref = (db: Firestore) => doc(db, 'chats', chatId, 'messages', msgId);
    await assertFails(updateDoc(ref(verified('bob')), { text: 'hacked', editedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(ref(verified('alice')), { text: 'fixed', editedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(ref(verified('bob')), { 'reactions.👍': arrayUnion('bob') }));
    await assertSucceeds(updateDoc(ref(verified('bob')), { deletedFor: arrayUnion('bob') }));
    await assertFails(updateDoc(ref(verified('bob')), { deleted: true, text: '' }));
    await assertSucceeds(updateDoc(ref(verified('alice')), { deleted: true, text: '' }));
  });

  it('отметка «прочитано» — только своя', async () => {
    const { chatId } = await firstMessage(verified('alice'), 'alice', 'bob');
    const db = verified('bob');
    await assertSucceeds(updateDoc(doc(db, 'chats', chatId), { 'readBy.bob': serverTimestamp() }));
    await assertFails(updateDoc(doc(db, 'chats', chatId), { 'readBy.alice': serverTimestamp() }));
    await assertFails(updateDoc(doc(db, 'chats', chatId), { members: ['bob', 'carol'] }));
  });

  it('«Избранное» только своё', async () => {
    const db = verified('alice');
    const batch = writeBatch(db);
    batch.set(doc(db, 'chats', 'saved_alice'), chatDoc('saved', ['alice']));
    await assertSucceeds(batch.commit());
    const bob = verified('bob');
    const b2 = writeBatch(bob);
    b2.set(doc(bob, 'chats', 'saved_alice'), chatDoc('saved', ['bob']));
    await assertFails(b2.commit());
  });
});

describe('группы и каналы', () => {
  beforeEach(() => seedUsers(['alice'], ['bob'], ['carol'], ['admin', { role: 'admin' }]));

  it('создание группы с системным сообщением', async () => {
    const db = verified('alice');
    const batch = writeBatch(db);
    const chat = doc(collection(db, 'chats'));
    batch.set(chat, chatDoc('group', ['alice', 'bob'], { ownerId: 'alice', admins: ['alice'], title: 'Друзья' }));
    batch.set(doc(collection(db, 'chats', chat.id, 'messages')), message('alice', '', { system: { kind: 'created', title: 'Друзья' } }));
    await assertSucceeds(batch.commit());
  });

  it('не больше 50 участников в группе', async () => {
    const db = verified('alice');
    const members = ['alice', ...Array.from({ length: 50 }, (_, i) => `u${i}`)];
    await assertFails(
      setDoc(doc(collection(db, 'chats')), chatDoc('group', members, { ownerId: 'alice', admins: ['alice'], title: 'X' })),
    );
    await assertSucceeds(
      setDoc(doc(collection(db, 'chats')), chatDoc('group', members.slice(0, 50), { ownerId: 'alice', admins: ['alice'], title: 'X' })),
    );
  });

  it('в канале пишут только админы', async () => {
    await seedGroup('ch1', 'channel', 'alice', ['bob']);
    await assertFails(setDoc(doc(collection(verified('bob'), 'chats', 'ch1', 'messages')), message('bob')));
    await assertSucceeds(setDoc(doc(collection(verified('alice'), 'chats', 'ch1', 'messages')), message('alice')));
    // подписчик может отмечать прочитанное
    await assertSucceeds(updateDoc(doc(verified('bob'), 'chats', 'ch1'), { 'readBy.bob': serverTimestamp() }));
  });

  it('участник не может добавлять людей, админ может', async () => {
    await seedGroup('g1', 'group', 'alice', ['bob']);
    await assertFails(updateDoc(doc(verified('bob'), 'chats', 'g1'), { members: arrayUnion('carol') }));
    await assertSucceeds(updateDoc(doc(verified('alice'), 'chats', 'g1'), { members: arrayUnion('carol') }));
  });

  it('админов назначает только владелец', async () => {
    await seedGroup('g1', 'group', 'alice', ['bob', 'carol'], { admins: ['alice', 'bob'] });
    await assertFails(updateDoc(doc(verified('bob'), 'chats', 'g1'), { admins: arrayUnion('carol') }));
    await assertSucceeds(updateDoc(doc(verified('alice'), 'chats', 'g1'), { admins: arrayUnion('carol') }));
  });

  it('выход из группы; владелец выйти не может', async () => {
    await seedGroup('g1', 'group', 'alice', ['bob']);
    await assertSucceeds(
      updateDoc(doc(verified('bob'), 'chats', 'g1'), { members: arrayRemove('bob'), admins: arrayRemove('bob') }),
    );
    await assertFails(
      updateDoc(doc(verified('alice'), 'chats', 'g1'), { members: arrayRemove('alice'), admins: arrayRemove('alice') }),
    );
  });

  it('вступление по приглашению требует верный код', async () => {
    await seedGroup('g1', 'group', 'alice', [], { inviteCode: 'secret123' });
    await assertFails(updateDoc(doc(verified('carol'), 'chats', 'g1'), { members: arrayUnion('carol'), lastJoinCode: 'wrong' }));
    await assertFails(updateDoc(doc(verified('carol'), 'chats', 'g1'), { members: arrayUnion('carol', 'bob'), lastJoinCode: 'secret123' }));
    await assertSucceeds(updateDoc(doc(verified('carol'), 'chats', 'g1'), { members: arrayUnion('carol'), lastJoinCode: 'secret123' }));
  });

  it('админ создаёт ссылку-приглашение', async () => {
    await seedGroup('g1', 'group', 'alice', ['bob']);
    const mk = (db: Firestore) => {
      const b = writeBatch(db);
      b.update(doc(db, 'chats', 'g1'), { inviteCode: 'code1' });
      b.set(doc(db, 'invites', 'code1'), { chatId: 'g1', title: 'G', type: 'group', avatar: null });
      return b.commit();
    };
    await assertFails(mk(verified('bob')));
    await assertSucceeds(mk(verified('alice')));
    await assertSucceeds(getDoc(doc(verified('carol'), 'invites', 'code1')));
  });

  it('глобальный админ модерирует группы, но не видит личку', async () => {
    await seedGroup('g1', 'group', 'alice', ['bob']);
    const { chatId } = await firstMessage(verified('alice'), 'alice', 'bob');
    const db = verified('admin');
    await assertSucceeds(getDocs(collection(db, 'chats', 'g1', 'messages')));
    await assertFails(getDocs(collection(db, 'chats', chatId, 'messages')));
    await assertSucceeds(updateDoc(doc(db, 'users', 'bob'), { banned: true }));
    await assertSucceeds(deleteDoc(doc(db, 'chats', 'g1')));
  });

  it('забаненный ничего не может', async () => {
    await seedGroup('g1', 'group', 'alice', ['bob']);
    await env.withSecurityRulesDisabled((ctx) =>
      updateDoc(doc(ctx.firestore() as unknown as Firestore, 'users', 'bob'), { banned: true }),
    );
    await assertFails(setDoc(doc(collection(verified('bob'), 'chats', 'g1', 'messages')), message('bob')));
    await assertFails(getDoc(doc(verified('bob'), 'chats', 'g1')));
  });
});

describe('звонки', () => {
  beforeEach(() => seedUsers(['alice'], ['bob'], ['carol']));

  const callData = (caller: string, callee: string) => ({
    callerId: caller,
    calleeId: callee,
    chatId: 'x',
    video: false,
    status: 'ringing',
    offer: { type: 'offer', sdp: 'v=0' },
    answer: null,
    createdAt: serverTimestamp(),
    answeredAt: null,
    endedAt: null,
  });

  it('звонок видят только участники', async () => {
    await assertSucceeds(setDoc(doc(verified('alice'), 'calls', 'c1'), callData('alice', 'bob')));
    await assertSucceeds(
      getDocs(query(collection(verified('bob'), 'calls'), where('calleeId', '==', 'bob'), where('status', '==', 'ringing'))),
    );
    await assertSucceeds(updateDoc(doc(verified('bob'), 'calls', 'c1'), { status: 'accepted' }));
    await assertFails(getDoc(doc(verified('carol'), 'calls', 'c1')));
    await assertSucceeds(setDoc(doc(collection(verified('bob'), 'calls', 'c1', 'calleeCandidates')), { candidate: 'x' }));
    await assertFails(setDoc(doc(collection(verified('carol'), 'calls', 'c1', 'calleeCandidates')), { candidate: 'x' }));
  });

  it('заблокированный не может позвонить', async () => {
    await setDoc(doc(verified('bob'), 'blocks', 'bob'), { list: ['alice'] });
    await assertFails(setDoc(doc(verified('alice'), 'calls', 'c1'), callData('alice', 'bob')));
  });
});
