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

describe('v2: значки, накрутки, премиум, просмотры, TURN', () => {
  let boss: User;
  let fan: User;
  let reader: User;

  beforeAll(async () => {
    boss = await user('boss');
    fan = await user('fan');
    reader = await user('reader');
    await admin.from('profiles').update({ role: 'admin' }).eq('id', boss.id);
  });

  it('обычный пользователь не может выдать себе значки и премиум', async () => {
    for (const field of ['verified', 'scam', 'premium_until']) {
      const { error } = await fan.db
        .from('profiles')
        .update({ [field]: field === 'premium_until' ? '9999-12-31' : true })
        .eq('id', fan.id);
      expect(error, field).not.toBeNull();
    }
    await fails(rpc(fan, 'admin_set_user_badges', { p_user: fan.id, p_verified: true, p_scam: null }));
    await fails(rpc(fan, 'admin_set_premium', { p_user: fan.id, p_until: '9999-12-31' }));
  });

  it('админ выдаёт галочку, SCAM и премиум', async () => {
    await rpc(boss, 'admin_set_user_badges', { p_user: fan.id, p_verified: true, p_scam: null });
    await rpc(boss, 'admin_set_user_badges', { p_user: reader.id, p_verified: null, p_scam: true });
    await rpc(boss, 'admin_set_premium', { p_user: fan.id, p_until: '9999-12-31T00:00:00Z' });
    const { data } = await reader.db.from('profiles').select('id, verified, scam, premium_until').in('id', [fan.id, reader.id]);
    const byId = Object.fromEntries(data!.map((r) => [r.id, r]));
    expect(byId[fan.id]).toMatchObject({ verified: true, scam: false });
    expect(byId[fan.id].premium_until).toMatch(/^9999/);
    expect(byId[reader.id]).toMatchObject({ scam: true });
  });

  it('канал: накрутка подписчиков, реальные просмотры и накрутка поста', async () => {
    const ch = await rpc<string>(boss, 'create_chat', { p_type: 'channel', p_title: 'Новости', p_members: [reader.id] });
    await fails(rpc(fan, 'admin_boost_members', { p_chat: ch, p_boost: 1000 }));
    await rpc(boss, 'admin_boost_members', { p_chat: ch, p_boost: 1000 });
    await rpc(boss, 'admin_set_chat_badges', { p_chat: ch, p_verified: true, p_scam: null });
    const [info] = await rpc<Record<string, unknown>[]>(reader, 'get_chats', { p_chat: ch });
    expect(info).toMatchObject({ member_count: 1002, verified: true, scam: false });

    const post = await send(boss, ch, 'Пост');
    await rpc(reader, 'mark_read', { p_chat: ch });
    await rpc(reader, 'mark_read', { p_chat: ch }); // повторное открытие не накручивает
    await fails(rpc(fan, 'admin_boost_message', { p_msg: post, p_views: 5, p_reactions: {} }));
    await rpc(boss, 'admin_boost_message', { p_msg: post, p_views: 5000, p_reactions: { '🔥': 300, '👍': 0, x: 'bad' } });
    const { data } = await reader.db.from('messages').select('views, boost_views, boost_reactions').eq('id', post).single();
    expect(data).toEqual({ views: 1, boost_views: 5000, boost_reactions: { '🔥': 300 } });
  });

  it('лимиты: закреп 5 чатов без премиума, 10 с премиумом; «О себе» 70/200', async () => {
    const chats: string[] = [];
    for (let i = 0; i < 6; i++) {
      chats.push(await rpc<string>(reader, 'create_chat', { p_type: 'group', p_title: `G${i}` }));
    }
    for (const c of chats.slice(0, 5)) await rpc(reader, 'set_chat_prefs', { p_chat: c, p_pinned: true });
    await fails(rpc(reader, 'set_chat_prefs', { p_chat: chats[5], p_pinned: true }));
    await rpc(boss, 'admin_set_premium', { p_user: reader.id, p_until: new Date(Date.now() + 86_400_000).toISOString() });
    await rpc(reader, 'set_chat_prefs', { p_chat: chats[5], p_pinned: true });

    const long = 'б'.repeat(150);
    const { error: tooLong } = await carol.db.from('profiles').update({ bio: long }).eq('id', carol.id);
    expect(tooLong).not.toBeNull();
    const { error: ok } = await fan.db.from('profiles').update({ bio: long }).eq('id', fan.id);
    expect(ok).toBeNull();
  });

  it('заявка на премиум: пользователь просит, админ одобряет', async () => {
    await rpc(carol, 'request_premium', { p_note: 'хочу звёздочку' });
    await rpc(carol, 'request_premium', { p_note: 'очень хочу' }); // вторая заявка обновляет первую
    const { data: mine } = await carol.db.from('premium_requests').select('id, status, note');
    expect(mine).toHaveLength(1);
    const { data: others } = await fan.db.from('premium_requests').select('id');
    expect(others).toEqual([]);
    const { data: all } = await boss.db.from('premium_requests').select('id, user_id').eq('status', 'pending');
    const req = all!.find((r) => r.user_id === carol.id)!;
    await fails(rpc(fan, 'admin_resolve_premium_request', { p_id: req.id, p_approve: true, p_until: '9999-12-31' }));
    await rpc(boss, 'admin_resolve_premium_request', { p_id: req.id, p_approve: true, p_until: '9999-12-31T00:00:00Z' });
    const { data: p } = await carol.db.from('profiles').select('premium_until').eq('id', carol.id).single();
    expect(p!.premium_until).toMatch(/^9999/);
  });

  it('TURN: временный логин и пароль по схеме coturn, без входа — отказ', async () => {
    const secret = 'test-turn-secret-1234567890';
    await admin.rpc('set_config_if_absent', { p_key: 'turn_secret', p_value: secret });
    await admin.rpc('set_config_if_absent', { p_key: 'turn_host', p_value: '203.0.113.7' });
    const anon = createClient(URL, ANON, { auth: { persistSession: false } });
    const { error: denied } = await anon.functions.invoke('bobogram', { body: { action: 'turn' } });
    expect(denied).not.toBeNull();

    const { data, error } = await fan.db.functions.invoke('bobogram', { body: { action: 'turn' } });
    expect(error).toBeNull();
    const servers = (data as { iceServers: RTCIceServer[] }).iceServers;
    const turn = servers.find((s) => String(s.urls).includes('turn:'))!;
    expect(turn.urls).toContain('turn:203.0.113.7:3478?transport=udp');
    const [expires, uid] = String(turn.username).split(':');
    expect(uid).toBe(fan.id);
    expect(Number(expires)).toBeGreaterThan(Date.now() / 1000 + 3600);
    const { createHmac } = await import('node:crypto');
    expect(turn.credential).toBe(createHmac('sha1', secret).update(String(turn.username)).digest('base64'));
  });
});
