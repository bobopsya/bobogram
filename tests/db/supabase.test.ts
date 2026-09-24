// Интеграционные тесты базы: правила доступа и серверные функции на локальном Supabase.
// Запуск: npx supabase start && npm run test:db
import { beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
// Стандартные демо-ключи локального Supabase (не секретные).
const ANON =
  process.env.SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const run = Date.now().toString(36).slice(-6);
const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

interface User {
  id: string;
  name: string;
  db: SupabaseClient;
}

async function user(name: string): Promise<User> {
  const db = createClient(URL, ANON, { auth: { persistSession: false } });
  const username = `${name}${run}`;
  const { data, error } = await db.auth.signUp({
    email: `${crypto.randomUUID()}@users.bobogram.app`,
    password: 'secret123',
    options: { data: { username, display_name: name } },
  });
  if (error) throw error;
  return { id: data.user!.id, name: username, db };
}

async function rpc<T = unknown>(u: User, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await u.db.rpc(fn, args);
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  return data as T;
}

async function fails(p: Promise<unknown>) {
  await expect(p).rejects.toBeTruthy();
}

async function send(u: User, chat: string, text = 'hi', extra: Record<string, unknown> = {}) {
  const id = crypto.randomUUID();
  await rpc(u, 'send_message', { p_id: id, p_chat: chat, p_text: text, ...extra });
  return id;
}

let alice: User, bob: User, carol: User;

beforeAll(async () => {
  alice = await user('alice');
  bob = await user('bob');
  carol = await user('carol');
});

describe('аккаунты', () => {
  it('вход по юзернейму без учёта регистра', async () => {
    const anon = createClient(URL, ANON, { auth: { persistSession: false } });
    const { data: email } = await anon.rpc('login_email', { p_username: '@' + alice.name.toUpperCase() });
    expect(email).toMatch(/@users\.bobogram\.app$/);
    const { error } = await anon.auth.signInWithPassword({ email, password: 'secret123' });
    expect(error).toBeNull();
  });

  it('занятый юзернейм не зарегистрировать', async () => {
    const db = createClient(URL, ANON, { auth: { persistSession: false } });
    const { error } = await db.auth.signUp({
      email: `${crypto.randomUUID()}@users.bobogram.app`,
      password: 'secret123',
      options: { data: { username: alice.name.toUpperCase(), display_name: 'x' } },
    });
    expect(error).not.toBeNull();
    expect(await rpc(bob, 'username_available', { p_username: alice.name })).toBe(false);
  });

  it('нельзя выдать себе админа или снять бан', async () => {
    const { error } = await bob.db.from('profiles').update({ role: 'admin' }).eq('id', bob.id);
    expect(error).not.toBeNull();
    const { error: e2 } = await bob.db.from('profiles').update({ banned: false }).eq('id', bob.id);
    expect(e2).not.toBeNull();
    const { error: e3 } = await bob.db.from('profiles').update({ bio: 'привет' }).eq('id', bob.id);
    expect(e3).toBeNull();
  });

  it('чужой профиль не изменить', async () => {
    await bob.db.from('profiles').update({ bio: 'hacked' }).eq('id', alice.id);
    const { data } = await admin.from('profiles').select('bio').eq('id', alice.id).single();
    expect(data!.bio).not.toBe('hacked');
  });
});

describe('личные чаты', () => {
  let chat: string;

  it('один чат на пару и сообщения видят только участники', async () => {
    chat = await rpc<string>(alice, 'get_or_create_private_chat', { p_other: bob.id });
    expect(await rpc<string>(bob, 'get_or_create_private_chat', { p_other: alice.id })).toBe(chat);
    await send(alice, chat, 'Привет, Боб!');
    const { data: bobSees } = await bob.db.from('messages').select('text').eq('chat_id', chat);
    expect(bobSees!.map((m) => m.text)).toContain('Привет, Боб!');
    const { data: carolSees } = await carol.db.from('messages').select('text').eq('chat_id', chat);
    expect(carolSees).toEqual([]);
    await fails(send(carol, chat, 'влезла'));
  });

  it('список чатов: непрочитанные и отметка «прочитано»', async () => {
    const [c] = (await rpc<Record<string, unknown>[]>(bob, 'get_chats')).filter((x) => x.id === chat);
    expect(c.unread).toBe(1);
    expect(c.other_id).toBe(alice.id);
    await rpc(bob, 'mark_read', { p_chat: chat });
    const [c2] = (await rpc<Record<string, unknown>[]>(bob, 'get_chats')).filter((x) => x.id === chat);
    expect(c2.unread).toBe(0);
    const [a] = (await rpc<Record<string, unknown>[]>(alice, 'get_chats')).filter((x) => x.id === chat);
    expect(Date.parse(a.others_read_at as string)).toBeGreaterThanOrEqual(
      Date.parse((a.last_message as { created_at: string }).created_at),
    );
  });

  it('правка только своих, реакции, удаление', async () => {
    const id = await send(alice, chat, 'исходный');
    await fails(rpc(bob, 'edit_message', { p_id: id, p_text: 'взлом' }));
    await rpc(alice, 'edit_message', { p_id: id, p_text: 'исправлено' });
    await rpc(bob, 'toggle_reaction', { p_id: id, p_emoji: '👍' });
    await rpc(bob, 'toggle_reaction', { p_id: id, p_emoji: '🔥' }); // заменяет 👍
    const { data } = await alice.db.from('messages').select('text, edited_at, reactions').eq('id', id).single();
    expect(data!.text).toBe('исправлено');
    expect(data!.edited_at).not.toBeNull();
    expect(data!.reactions).toEqual({ '🔥': [bob.id] });
    await fails(rpc(bob, 'delete_message', { p_id: id, p_for_all: true }));
    await rpc(bob, 'delete_message', { p_id: id, p_for_all: false });
    await rpc(alice, 'delete_message', { p_id: id, p_for_all: true });
    const { data: d2 } = await alice.db.from('messages').select('text, deleted, deleted_for').eq('id', id).single();
    expect(d2).toMatchObject({ text: '', deleted: true, deleted_for: [bob.id] });
  });

  it('повторная отправка из офлайн-очереди не дублирует', async () => {
    const id = crypto.randomUUID();
    await rpc(alice, 'send_message', { p_id: id, p_chat: chat, p_text: 'один раз' });
    await rpc(alice, 'send_message', { p_id: id, p_chat: chat, p_text: 'один раз' });
    const { count } = await alice.db.from('messages').select('*', { count: 'exact', head: true }).eq('id', id);
    expect(count).toBe(1);
  });

  it('заблокированный не может писать и звонить', async () => {
    await bob.db.from('blocks').insert({ blocked_id: alice.id });
    await fails(send(alice, chat, 'ты меня слышишь?'));
    const { error } = await alice.db.from('calls').insert({ chat_id: chat, callee_id: bob.id, video: false });
    expect(error).not.toBeNull();
    await bob.db.from('blocks').delete().eq('blocked_id', alice.id);
    await send(alice, chat, 'снова можно');
  });

  it('«Избранное» только своё', async () => {
    const saved = await rpc<string>(alice, 'get_saved_chat');
    await send(alice, saved, 'заметка');
    const { data } = await bob.db.from('messages').select('id').eq('chat_id', saved);
    expect(data).toEqual([]);
  });
});

describe('группы и каналы', () => {
  it('группа: создание, лимит, роли, выход', async () => {
    const g = await rpc<string>(alice, 'create_chat', { p_type: 'group', p_title: 'Друзья', p_members: [bob.id] });
    const { data: msgs } = await bob.db.from('messages').select('system').eq('chat_id', g);
    expect(msgs![0].system).toMatchObject({ kind: 'created', title: 'Друзья' });

    await fails(rpc(bob, 'add_members', { p_chat: g, p_users: [carol.id] }));
    await rpc(alice, 'add_members', { p_chat: g, p_users: [carol.id] });
    await fails(rpc(bob, 'set_admin', { p_chat: g, p_user: carol.id, p_admin: true }));
    await rpc(alice, 'set_admin', { p_chat: g, p_user: bob.id, p_admin: true });
    await fails(rpc(bob, 'remove_member', { p_chat: g, p_user: alice.id }));
    await rpc(bob, 'remove_member', { p_chat: g, p_user: carol.id });
    await fails(rpc(alice, 'leave_chat', { p_chat: g }));
    await rpc(bob, 'leave_chat', { p_chat: g });
    const { data: members } = await alice.db.from('chat_members').select('user_id').eq('chat_id', g);
    expect(members!.map((m) => m.user_id)).toEqual([alice.id]);
  });

  it('в канале пишут только админы, подписчики читают', async () => {
    const ch = await rpc<string>(alice, 'create_chat', { p_type: 'channel', p_title: 'Новости', p_members: [bob.id] });
    await send(alice, ch, 'Выпуск №1');
    await fails(send(bob, ch, 'можно мне?'));
    await rpc(bob, 'mark_read', { p_chat: ch });
  });

  it('вступление по ссылке-приглашению', async () => {
    const g = await rpc<string>(alice, 'create_chat', { p_type: 'group', p_title: 'Клуб' });
    await fails(rpc(bob, 'reset_invite', { p_chat: g }));
    const code = await rpc<string>(alice, 'reset_invite', { p_chat: g });
    const [preview] = await rpc<Record<string, unknown>[]>(carol, 'invite_preview', { p_code: code });
    expect(preview).toMatchObject({ title: 'Клуб', member_count: 1, is_member: false });
    await fails(rpc(carol, 'join_by_invite', { p_code: 'wrong' }));
    expect(await rpc(carol, 'join_by_invite', { p_code: code })).toBe(g);
    await send(carol, g, 'я тут');
    // Старая ссылка перестаёт работать после сброса.
    await rpc(alice, 'reset_invite', { p_chat: g });
    await fails(rpc(bob, 'join_by_invite', { p_code: code }));
  });

  it('первый пользователь — админ сервиса; он модерирует группы, но не видит личку', async () => {
    const { data: first } = await admin.from('profiles').select('id').eq('role', 'admin').limit(1).single();
    // Делаем alice админом сервиса, если она не первая в этой базе.
    await admin.from('profiles').update({ role: 'admin' }).eq('id', alice.id);
    const g = await rpc<string>(bob, 'create_chat', { p_type: 'group', p_title: 'Боба', p_members: [carol.id] });
    const priv = await rpc<string>(bob, 'get_or_create_private_chat', { p_other: carol.id });
    await send(bob, priv, 'секрет');
    const { data: groupMsgs } = await alice.db.from('messages').select('id').eq('chat_id', g);
    expect(groupMsgs!.length).toBeGreaterThan(0);
    const { data: privMsgs } = await alice.db.from('messages').select('id').eq('chat_id', priv);
    expect(privMsgs).toEqual([]);
    await rpc(alice, 'set_banned', { p_user: carol.id, p_banned: true });
    await fails(send(carol, g, 'я забанена'));
    await rpc(alice, 'set_banned', { p_user: carol.id, p_banned: false });
    await rpc(alice, 'delete_chat', { p_chat: g });
    expect(first).toBeTruthy();
  });
});

describe('серверная функция', () => {
  it('выдаёт публичный VAPID-ключ', async () => {
    const { data, error } = await bob.db.functions.invoke('bobogram', { body: { action: 'vapid' } });
    expect(error).toBeNull();
    expect((data as { publicKey: string }).publicKey).toMatch(/^[A-Za-z0-9_-]{80,}$/);
  });

  it('без секрета рассылку не запустить', async () => {
    const { error } = await bob.db.functions.invoke('bobogram', { body: { action: 'push', id: crypto.randomUUID() } });
    expect(error).not.toBeNull();
  });

  it('админ сервиса сбрасывает пароль, обычный пользователь — нет', async () => {
    const { error: denied } = await bob.db.functions.invoke('bobogram', {
      body: { action: 'reset_password', userId: carol.id, password: 'hacked1' },
    });
    expect(denied).not.toBeNull();
    const { error } = await alice.db.functions.invoke('bobogram', {
      body: { action: 'reset_password', userId: carol.id, password: 'newpass1' },
    });
    expect(error).toBeNull();
    const anon = createClient(URL, ANON, { auth: { persistSession: false } });
    const { data: email } = await anon.rpc('login_email', { p_username: carol.name });
    const { error: loginErr } = await anon.auth.signInWithPassword({ email, password: 'newpass1' });
    expect(loginErr).toBeNull();
  });
});
