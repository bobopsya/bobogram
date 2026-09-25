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
    const { data } = await alice.db
      .from('messages')
      .select('text, edited_at, reactions')
      .eq('id', id)
      .single();
    expect(data!.text).toBe('исправлено');
    expect(data!.edited_at).not.toBeNull();
    expect(data!.reactions).toEqual({ '🔥': [bob.id] });
    await fails(rpc(bob, 'delete_message', { p_id: id, p_for_all: true }));
    await rpc(bob, 'delete_message', { p_id: id, p_for_all: false });
    await rpc(alice, 'delete_message', { p_id: id, p_for_all: true });
    const { data: d2 } = await alice.db
      .from('messages')
      .select('text, deleted, deleted_for')
      .eq('id', id)
      .single();
    expect(d2).toMatchObject({ text: '', deleted: true, deleted_for: [bob.id] });
  });

  it('повторная отправка из офлайн-очереди не дублирует', async () => {
    const id = crypto.randomUUID();
    await rpc(alice, 'send_message', { p_id: id, p_chat: chat, p_text: 'один раз' });
    await rpc(alice, 'send_message', { p_id: id, p_chat: chat, p_text: 'один раз' });
    const { count } = await alice.db
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('id', id);
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
    const g = await rpc<string>(alice, 'create_chat', {
      p_type: 'group',
      p_title: 'Друзья',
      p_members: [bob.id],
    });
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
    const ch = await rpc<string>(alice, 'create_chat', {
      p_type: 'channel',
      p_title: 'Новости',
      p_members: [bob.id],
    });
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
    const g = await rpc<string>(bob, 'create_chat', {
      p_type: 'group',
      p_title: 'Боба',
      p_members: [carol.id],
    });
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
    const { error } = await bob.db.functions.invoke('bobogram', {
      body: { action: 'push', id: crypto.randomUUID() },
    });
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
    const { data } = await reader.db
      .from('profiles')
      .select('id, verified, scam, premium_until')
      .in('id', [fan.id, reader.id]);
    const byId = Object.fromEntries(data!.map((r) => [r.id, r]));
    expect(byId[fan.id]).toMatchObject({ verified: true, scam: false });
    expect(byId[fan.id].premium_until).toMatch(/^9999/);
    expect(byId[reader.id]).toMatchObject({ scam: true });
  });

  it('канал: накрутка подписчиков, реальные просмотры и накрутка поста', async () => {
    const ch = await rpc<string>(boss, 'create_chat', {
      p_type: 'channel',
      p_title: 'Новости',
      p_members: [reader.id],
    });
    await fails(rpc(fan, 'admin_boost_members', { p_chat: ch, p_boost: 1000 }));
    await rpc(boss, 'admin_boost_members', { p_chat: ch, p_boost: 1000 });
    await rpc(boss, 'admin_set_chat_badges', { p_chat: ch, p_verified: true, p_scam: null });
    const [info] = await rpc<Record<string, unknown>[]>(reader, 'get_chats', { p_chat: ch });
    expect(info).toMatchObject({ member_count: 1002, verified: true, scam: false });

    const post = await send(boss, ch, 'Пост');
    await rpc(reader, 'mark_read', { p_chat: ch });
    await rpc(reader, 'mark_read', { p_chat: ch }); // повторное открытие не накручивает
    await fails(rpc(fan, 'admin_boost_message', { p_msg: post, p_views: 5, p_reactions: {} }));
    await rpc(boss, 'admin_boost_message', {
      p_msg: post,
      p_views: 5000,
      p_reactions: { '🔥': 300, '👍': 0, x: 'bad' },
    });
    const { data } = await reader.db
      .from('messages')
      .select('views, boost_views, boost_reactions')
      .eq('id', post)
      .single();
    expect(data).toEqual({ views: 1, boost_views: 5000, boost_reactions: { '🔥': 300 } });
  });

  it('лимиты: закреп 5 чатов без премиума, 10 с премиумом; «О себе» 70/200', async () => {
    const chats: string[] = [];
    for (let i = 0; i < 6; i++) {
      chats.push(await rpc<string>(reader, 'create_chat', { p_type: 'group', p_title: `G${i}` }));
    }
    for (const c of chats.slice(0, 5)) await rpc(reader, 'set_chat_prefs', { p_chat: c, p_pinned: true });
    await fails(rpc(reader, 'set_chat_prefs', { p_chat: chats[5], p_pinned: true }));
    await rpc(boss, 'admin_set_premium', {
      p_user: reader.id,
      p_until: new Date(Date.now() + 86_400_000).toISOString(),
    });
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
    const { data: all } = await boss.db
      .from('premium_requests')
      .select('id, user_id')
      .eq('status', 'pending');
    const req = all!.find((r) => r.user_id === carol.id)!;
    await fails(
      rpc(fan, 'admin_resolve_premium_request', { p_id: req.id, p_approve: true, p_until: '9999-12-31' }),
    );
    await rpc(boss, 'admin_resolve_premium_request', {
      p_id: req.id,
      p_approve: true,
      p_until: '9999-12-31T00:00:00Z',
    });
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

describe('фото и голосовые', () => {
  const jpeg = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])], { type: 'image/jpeg' });

  async function upload(u: User, folder = u.id) {
    const path = `${folder}/${crypto.randomUUID()}.jpg`;
    const { error } = await u.db.storage.from('media').upload(path, jpeg, { contentType: 'image/jpeg' });
    return { path, error };
  }
  const canDownload = async (u: User, path: string) =>
    !(await u.db.storage.from('media').download(path)).error;

  it('загрузка только в свою папку; файл видят только участники чата', async () => {
    const chat = await rpc<string>(alice, 'get_or_create_private_chat', { p_other: bob.id });
    expect((await upload(alice, bob.id)).error).not.toBeNull();

    const { path, error } = await upload(alice);
    expect(error).toBeNull();
    // Пока файл ни в каком сообщении — видит только автор.
    expect(await canDownload(alice, path)).toBe(true);
    expect(await canDownload(bob, path)).toBe(false);

    const id = await send(alice, chat, '', {
      p_media: { kind: 'photo', path, width: 10, height: 20, evil: 'x' },
    });
    const { data: msg } = await bob.db.from('messages').select('media, text').eq('id', id).single();
    expect(msg!.media).toMatchObject({ kind: 'photo', path, width: 10, height: 20 });
    expect(msg!.media).not.toHaveProperty('evil');
    expect(await canDownload(bob, path)).toBe(true);
    expect(await canDownload(carol, path)).toBe(false);
    const { data: chats } = await bob.db.rpc('get_chats', { p_chat: chat });
    expect((chats as { last_message: { media: unknown } }[])[0].last_message.media).toMatchObject({
      kind: 'photo',
    });

    // Чужой файл, которого не видишь, в своё сообщение не вставить.
    const carolChat = await rpc<string>(carol, 'get_saved_chat');
    await fails(send(carol, carolChat, '', { p_media: { kind: 'photo', path } }));
    // А пересланное вместе с сообщением видно в новом чате.
    const bobCarol = await rpc<string>(bob, 'get_or_create_private_chat', { p_other: carol.id });
    await send(bob, bobCarol, '', { p_media: { kind: 'photo', path } });
    expect(await canDownload(carol, path)).toBe(true);

    // Удалили у всех — вложение исчезло из сообщения.
    await rpc(alice, 'delete_message', { p_id: id, p_for_all: true });
    const { data: gone } = await bob.db.from('messages').select('media').eq('id', id).single();
    expect(gone!.media).toBeNull();
  });

  it('без файла и текста не отправить; несуществующий путь — отказ', async () => {
    const chat = await rpc<string>(alice, 'get_saved_chat');
    await fails(send(alice, chat, ''));
    await fails(
      send(alice, chat, '', { p_media: { kind: 'photo', path: `${alice.id}/${crypto.randomUUID()}.jpg` } }),
    );
    await fails(send(alice, chat, '', { p_media: { kind: 'video', path: 'x' } }));
  });
});

describe('НФТ-юзернеймы', () => {
  let nftAdmin: User, owner: User, other: User;
  const nft = `nft${run}`;

  beforeAll(async () => {
    nftAdmin = await user('nftadmin');
    owner = await user('nftowner');
    other = await user('nftother');
    await admin.from('profiles').update({ role: 'admin' }).eq('id', nftAdmin.id);
  });

  it('выдаёт только админ; напрямую в таблицу не записать', async () => {
    await fails(rpc(owner, 'admin_grant_nft_username', { p_user: owner.id, p_username: nft }));
    const { error } = await owner.db.from('nft_usernames').insert({ username: nft, owner_id: owner.id });
    expect(error).not.toBeNull();
    // Чужое основное имя выдать нельзя.
    await fails(rpc(nftAdmin, 'admin_grant_nft_username', { p_user: owner.id, p_username: other.name }));
  });

  it('выданное имя находит профиль, и его нельзя занять обычным юзернеймом', async () => {
    await rpc(nftAdmin, 'admin_grant_nft_username', { p_user: owner.id, p_username: '@' + nft });
    const found = await rpc<{ id: string }[]>(other, 'find_profile_by_username', {
      p_username: nft.toUpperCase(),
    });
    expect(found[0].id).toBe(owner.id);
    const { data: p } = await other.db
      .from('profiles')
      .select('nft_usernames(username)')
      .eq('id', owner.id)
      .single();
    expect(p!.nft_usernames).toEqual([{ username: nft }]);

    expect(await rpc(other, 'username_available', { p_username: nft })).toBe(false);
    const { error } = await other.db.from('profiles').update({ username: nft }).eq('id', other.id);
    expect(error).not.toBeNull();
    // Дважды одно имя не выдать.
    await fails(rpc(nftAdmin, 'admin_grant_nft_username', { p_user: other.id, p_username: nft }));
  });

  it('отзыв освобождает имя', async () => {
    await fails(rpc(owner, 'admin_revoke_nft_username', { p_username: nft }));
    await rpc(nftAdmin, 'admin_revoke_nft_username', { p_username: nft });
    expect(await rpc(other, 'username_available', { p_username: nft })).toBe(true);
    expect(await rpc<unknown[]>(other, 'find_profile_by_username', { p_username: nft })).toEqual([]);
  });
});

describe('очистка истории у себя', () => {
  it('сообщения пропадают только у меня, у собеседника остаются', async () => {
    const me = await user('clearme');
    const peer = await user('clearpeer');
    const chat = await rpc<string>(me, 'get_or_create_private_chat', { p_other: peer.id });
    await send(peer, chat, 'старое');
    await rpc(me, 'clear_chat_for_me', { p_chat: chat });
    expect(await rpc<unknown[]>(me, 'get_messages', { p_chat: chat })).toEqual([]);
    const [c] = await rpc<{ unread: number; last_message: unknown }[]>(me, 'get_chats', { p_chat: chat });
    expect(c.unread).toBe(0);
    expect(c.last_message).toBeNull();
    expect((await rpc<unknown[]>(peer, 'get_messages', { p_chat: chat })).length).toBe(1);
    await send(peer, chat, 'новое');
    const mine = await rpc<{ text: string }[]>(me, 'get_messages', { p_chat: chat });
    expect(mine.map((m) => m.text)).toEqual(['новое']);
    // Чужой чат очистить нельзя.
    await fails(rpc(carol, 'clear_chat_for_me', { p_chat: chat }));
  });
});

describe('v4: админка, спамблок, стиль профиля', () => {
  let boss: User, user1: User, user2: User, prem: User;
  const until = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

  beforeAll(async () => {
    boss = await user('v4boss');
    user1 = await user('v4user');
    user2 = await user('v4other');
    prem = await user('v4prem');
    await admin.from('profiles').update({ role: 'admin' }).eq('id', boss.id);
    await admin
      .from('profiles')
      .update({ premium_until: until(30) })
      .eq('id', prem.id);
  });

  it('админ меняет имя, @имя, «О себе» и аватар; обычный пользователь — нет', async () => {
    const args = {
      p_user: user2.id,
      p_display_name: 'Новое имя',
      p_username: `renamed${run}`,
      p_bio: 'привет',
    };
    await fails(rpc(user1, 'admin_update_profile', args));
    await rpc(boss, 'admin_update_profile', { ...args, p_avatar: 'data:image/png;base64,AAAA' });
    const { data: p } = await user1.db.from('profiles').select('*').eq('id', user2.id).single();
    expect(p).toMatchObject({ display_name: 'Новое имя', username: `renamed${run}`, bio: 'привет' });
    expect(p!.avatar).toMatch(/^data:image\/png/);
    await fails(rpc(boss, 'admin_update_profile', { p_user: user2.id, p_username: user1.name }));
    await fails(rpc(boss, 'admin_update_profile', { p_user: user2.id, p_avatar: 'javascript:alert(1)' }));
  });

  it('любой админ выдаёт и снимает админку, но не владельцу и не себе', async () => {
    await fails(rpc(user1, 'admin_set_role', { p_user: user1.id, p_admin: true }));
    await rpc(boss, 'admin_set_role', { p_user: user1.id, p_admin: true });
    // Новый админ тоже может назначать.
    await rpc(user1, 'admin_set_role', { p_user: prem.id, p_admin: true });
    await rpc(user1, 'admin_set_role', { p_user: prem.id, p_admin: false });
    await fails(rpc(user1, 'admin_set_role', { p_user: user1.id, p_admin: false }));
    const owner = await rpc<string>(user1, 'get_owner_id');
    await fails(rpc(user1, 'admin_set_role', { p_user: owner, p_admin: false }));
    await fails(rpc(user1, 'set_banned', { p_user: owner, p_banned: true }));
    await fails(rpc(user1, 'admin_set_spamblock', { p_user: owner, p_until: until(1) }));
    await rpc(boss, 'admin_set_role', { p_user: user1.id, p_admin: false });
  });

  it('спамблок: первым писать и добавлять в группы нельзя, отвечать можно', async () => {
    await fails(rpc(user1, 'admin_set_spamblock', { p_user: user2.id, p_until: until(1) }));
    await rpc(boss, 'admin_set_spamblock', { p_user: user1.id, p_until: until(1) });
    const chat = await rpc<string>(user1, 'get_or_create_private_chat', { p_other: user2.id });
    await expect(send(user1, chat, 'спам')).rejects.toThrow(/spamblock/);
    await send(user2, chat, 'привет');
    await send(user1, chat, 'ответ');
    await expect(
      rpc(user1, 'create_chat', { p_type: 'group', p_title: 'Спам', p_members: [user2.id] }),
    ).rejects.toThrow(/spamblock/);
    const g = await rpc<string>(user1, 'create_chat', { p_type: 'group', p_title: 'Моя' });
    await expect(rpc(user1, 'add_members', { p_chat: g, p_users: [user2.id] })).rejects.toThrow(/spamblock/);
    await rpc(boss, 'admin_set_spamblock', { p_user: user1.id, p_until: null });
    await rpc(user1, 'add_members', { p_chat: g, p_users: [user2.id] });
  });

  it('стиль профиля: премиум — себе, админ — любому, обычный — нет', async () => {
    const style = { p_color: 'fire', p_emoji: '🔥', p_bg: 'space' };
    await fails(rpc(user1, 'set_profile_style', { p_user: user1.id, ...style }));
    await rpc(prem, 'set_profile_style', { p_user: prem.id, ...style });
    await fails(rpc(prem, 'set_profile_style', { p_user: user1.id, ...style }));
    await rpc(boss, 'set_profile_style', { p_user: user1.id, ...style });
    await fails(
      rpc(boss, 'set_profile_style', { p_user: user1.id, p_color: 'bad', p_emoji: null, p_bg: null }),
    );
    const { data } = await user2.db
      .from('profiles')
      .select('name_color, emoji_status, profile_bg')
      .eq('id', user1.id)
      .single();
    expect(data).toEqual({ name_color: 'fire', emoji_status: '🔥', profile_bg: 'space' });
    // Напрямую колонку не поменять.
    const { error } = await user1.db.from('profiles').update({ name_color: 'red' }).eq('id', user1.id);
    expect(error).not.toBeNull();
  });
});

describe('запрет на смену профиля', () => {
  it('заблокированный не меняет имя, @имя, «О себе» и аватар; админ — может', async () => {
    const boss = await user('lockboss');
    const u = await user('lockuser');
    await admin.from('profiles').update({ role: 'admin' }).eq('id', boss.id);
    await fails(rpc(u, 'admin_set_profile_lock', { p_user: u.id, p_locked: true }));
    await rpc(boss, 'admin_set_profile_lock', { p_user: u.id, p_locked: true });
    for (const patch of [
      { display_name: 'X' },
      { bio: 'x' },
      { avatar: 'data:image/png;base64,AA' },
      { username: `lk${run}` },
    ]) {
      const { error } = await u.db.from('profiles').update(patch).eq('id', u.id);
      expect(error?.message).toMatch(/profile locked/);
    }
    // Время «был в сети» обновляется как обычно.
    const { error } = await u.db
      .from('profiles')
      .update({ last_seen: new Date().toISOString() })
      .eq('id', u.id);
    expect(error).toBeNull();
    await rpc(boss, 'admin_update_profile', { p_user: u.id, p_display_name: 'Админ поменял' });
    await rpc(boss, 'admin_set_profile_lock', { p_user: u.id, p_locked: false });
    const { error: ok } = await u.db.from('profiles').update({ display_name: 'Сам' }).eq('id', u.id);
    expect(ok).toBeNull();
  });
});

describe('@bobotools: логи, команды, жалобы, статистика', () => {
  let boss: User, member: User, newbie: User, logChat: string, group: string;

  async function botTexts(u: User, chat: string): Promise<string[]> {
    const { data: bot } = await u.db.from('profiles').select('id').eq('username', 'bobotools').single();
    const { data } = await u.db
      .from('messages')
      .select('text')
      .eq('chat_id', chat)
      .eq('sender_id', bot!.id)
      .order('created_at', { ascending: true });
    return (data ?? []).map((m) => m.text as string);
  }
  const last = async (u: User, chat: string) => (await botTexts(u, chat)).at(-1) ?? '';

  beforeAll(async () => {
    boss = await user('tboss');
    member = await user('tmember');
    newbie = await user('tnewbie');
    await admin.from('profiles').update({ role: 'admin' }).eq('id', boss.id);
    logChat = await rpc<string>(boss, 'create_chat', { p_type: 'group', p_title: 'Логи' });
    group = await rpc<string>(boss, 'create_chat', {
      p_type: 'group',
      p_title: 'Команда',
      p_members: [member.id],
    });
  });

  it('/setlogs делает группу лог-группой; обычному пользователю — отказ', async () => {
    await send(member, group, '/setlogs');
    expect(await last(member, group)).toMatch(/только администраторам сервиса/);
    await send(boss, logChat, '/setlogs');
    expect(await last(boss, logChat)).toMatch(/логи администрации приходят сюда/);
  });

  it('действия админов и пользователей попадают в лог', async () => {
    await rpc(boss, 'admin_set_role', { p_user: member.id, p_admin: true });
    expect(await last(boss, logChat)).toBe(
      `🛡️ Администратор @${boss.name} выдал(а) права администрации @${member.name}`,
    );
    await rpc(boss, 'admin_set_role', { p_user: member.id, p_admin: false });
    await rpc(boss, 'admin_set_spamblock', { p_user: member.id, p_until: '9999-12-31T00:00:00Z' });
    expect(await last(boss, logChat)).toMatch(/выдал\(а\) спамблок .* навсегда/);
    await rpc(boss, 'admin_set_spamblock', { p_user: member.id, p_until: null });
    await rpc(boss, 'admin_grant_nft_username', { p_user: member.id, p_username: `lognft${run}` });
    expect(await last(boss, logChat)).toMatch(/💎 .*выдал\(а\) НФТ-юзернейм @lognft/);
    const newName = `renamed2${run}`;
    await newbie.db.from('profiles').update({ username: newName }).eq('id', newbie.id);
    expect(await last(boss, logChat)).toBe(`✏️ @${newbie.name} теперь @${newName}`);
    newbie.name = newName;
    await rpc(newbie, 'request_premium', { p_note: 'пожалуйста' });
    expect(await last(boss, logChat)).toMatch(/просит премиум: «пожалуйста»/);
    // Новая регистрация.
    const fresh = await user('tfresh');
    expect(await last(boss, logChat)).toMatch(new RegExp(`Новый пользователь @${fresh.name}`));
  });

  it('/invite и /kick: админ группы и сервиса могут, участник — нет', async () => {
    await send(member, group, `/invite @${newbie.name}`);
    expect(await last(member, group)).toMatch(/администраторам группы и сервиса/);
    await send(boss, group, `/invite @${newbie.name}`);
    const { data: m } = await boss.db
      .from('chat_members')
      .select('user_id')
      .eq('chat_id', group)
      .eq('user_id', newbie.id);
    expect(m).toHaveLength(1);
    await send(boss, group, `/invite @${newbie.name}`);
    expect(await last(boss, group)).toMatch(/уже в группе/);
    await send(boss, group, `/kick @${newbie.name}`);
    const { data: m2 } = await boss.db
      .from('chat_members')
      .select('user_id')
      .eq('chat_id', group)
      .eq('user_id', newbie.id);
    expect(m2).toHaveLength(0);
    await send(boss, group, '/invite @nobody_такого_нет');
    expect(await last(boss, group)).toMatch(/не найден/);
  });

  it('/ban, /admin, /info, /stats — только админы сервиса; владельца не тронуть', async () => {
    await send(boss, group, `/ban @${member.name}`);
    const { data: p } = await boss.db.from('profiles').select('banned').eq('id', member.id).single();
    expect(p!.banned).toBe(true);
    expect(await last(boss, logChat)).toMatch(/забанил\(а\)/);
    await send(boss, group, `/unban @${member.name}`);
    await send(boss, group, `/admin @${member.name}`);
    expect(await last(boss, group)).toMatch(/теперь администратор/);
    await send(boss, group, `/unadmin @${member.name}`);
    const owner = await rpc<string>(boss, 'get_owner_id');
    if (owner && owner !== boss.id) {
      const { data: o } = await boss.db.from('profiles').select('username').eq('id', owner).single();
      await send(boss, group, `/ban @${o!.username}`);
      expect(await last(boss, group)).toMatch(/нельзя/);
    }
    await send(boss, group, `/info @${member.name}`);
    expect(await last(boss, group)).toMatch(/Регистрация: .*\nРоль: пользователь/s);
    await send(boss, group, '/stats');
    expect(await last(boss, group)).toMatch(/Пользователей: \d+/);
    expect(await rpc<Record<string, number>>(boss, 'admin_stats')).toHaveProperty('users');
    await fails(rpc(member, 'admin_stats'));
  });

  it('/broadcast из лог-группы — всем в личку от бота', async () => {
    await send(boss, group, '/broadcast тест');
    expect(await last(boss, group)).toMatch(/только из лог-группы/);
    await send(boss, logChat, '/broadcast Завтра обновление');
    expect(await last(boss, logChat)).toMatch(/Рассылка отправлена: \d+/);
    const chats = await rpc<{ id: string; type: string; last_message: { text: string } | null }[]>(
      newbie,
      'get_chats',
    );
    expect(chats.some((c) => c.type === 'private' && c.last_message?.text === '📣 Завтра обновление')).toBe(
      true,
    );
  });

  it('жалоба на сообщение уходит в лог и видна только админам', async () => {
    const chat = await rpc<string>(newbie, 'get_or_create_private_chat', { p_other: member.id });
    const msg = await send(member, chat, 'плохое сообщение');
    await fails(rpc(carol, 'report', { p_user: null, p_message: msg, p_reason: 'spam', p_comment: '' }));
    await rpc(newbie, 'report', { p_user: null, p_message: msg, p_reason: 'abuse', p_comment: 'грубит' });
    expect(await last(boss, logChat)).toMatch(
      /🚩 Жалоба от @.* на @.* \(оскорбления\)\nСообщение: «плохое сообщение»\nКомментарий: грубит/,
    );
    const { data: mine } = await newbie.db.from('reports').select('id');
    expect(mine).toEqual([]);
    const { data: all } = await boss.db.from('reports').select('id').eq('message_id', msg);
    expect(all).toHaveLength(1);
    await rpc(boss, 'admin_resolve_report', { p_id: all![0].id });
  });
});

describe('владелец, со-владелец, значок разработчика', () => {
  let owner: User, co: User, adm: User;

  beforeAll(async () => {
    co = await user('coown');
    adm = await user('coadm');
    await admin.from('profiles').update({ role: 'admin' }).eq('id', adm.id);
    // Владелец — alice (первый админ этой базы).
    await admin.from('profiles').update({ role: 'admin' }).eq('id', alice.id);
    await admin.rpc('set_config_if_absent', { p_key: 'owner_id', p_value: alice.id });
    owner = alice;
  });

  it('со-владельца и разработчика назначает только владелец', async () => {
    // Тест рассчитан на чистую базу (как в CI): владелец — alice.
    expect(await rpc<string>(adm, 'get_owner_id')).toBe(owner.id);
    await fails(rpc(adm, 'owner_set_co_owner', { p_user: co.id, p_on: true }));
    await rpc(owner, 'owner_set_co_owner', { p_user: co.id, p_on: true });
    await fails(rpc(co, 'owner_set_developer', { p_user: co.id, p_on: true }));
    await rpc(owner, 'owner_set_developer', { p_user: co.id, p_on: true });
    const { data } = await adm.db
      .from('profiles')
      .select('co_owner, developer, role')
      .eq('id', co.id)
      .single();
    expect(data).toEqual({ co_owner: true, developer: true, role: 'admin' });
  });

  it('другие админы не могут трогать владельца и со-владельца', async () => {
    for (const target of [owner, co]) {
      await expect(
        rpc(adm, 'admin_update_profile', { p_user: target.id, p_display_name: 'Взлом' }),
      ).rejects.toThrow(/protected user|not allowed/);
      await fails(rpc(adm, 'admin_set_user_badges', { p_user: target.id, p_verified: false, p_scam: true }));
      await fails(rpc(adm, 'admin_set_premium', { p_user: target.id, p_until: null }));
      await fails(rpc(adm, 'set_banned', { p_user: target.id, p_banned: true }));
      await fails(
        rpc(adm, 'admin_grant_nft_username', {
          p_user: target.id,
          p_username: `prot${target.name.slice(-6)}x`,
        }),
      );
    }
    await fails(rpc(adm, 'admin_set_role', { p_user: co.id, p_admin: false }));
    // Со-владелец тоже не может трогать владельца.
    await fails(rpc(co, 'admin_set_user_badges', { p_user: owner.id, p_verified: false, p_scam: true }));
    // А владелец может всё.
    await rpc(owner, 'admin_update_profile', { p_user: co.id, p_display_name: 'Со-владелец' });
    await rpc(owner, 'admin_set_user_badges', { p_user: co.id, p_verified: true, p_scam: false });
    // Свой профиль со-владелец меняет сам.
    const { error } = await co.db.from('profiles').update({ bio: 'я со-владелец' }).eq('id', co.id);
    expect(error).toBeNull();
  });
});

describe('накрутка каналов', () => {
  let boss: User, fan: User, channel: string, logs: string;

  beforeAll(async () => {
    boss = await user('chboss');
    fan = await user('chfan');
    await admin.from('profiles').update({ role: 'admin' }).eq('id', boss.id);
    channel = await rpc<string>(boss, 'create_chat', {
      p_type: 'channel',
      p_title: `Канал${run}`,
      p_members: [fan.id],
    });
    logs = await rpc<string>(boss, 'create_chat', { p_type: 'group', p_title: `Логи2${run}` });
    await send(boss, logs, '/setlogs');
  });

  const views = async (id: string) => {
    const { data } = await boss.db
      .from('messages')
      .select('boost_views, boost_reactions')
      .eq('id', id)
      .single();
    return data as { boost_views: number; boost_reactions: Record<string, number> };
  };

  it('просмотры всем постам сразу, с разбросом ±20%; обычному — нельзя', async () => {
    const a = await send(boss, channel, 'пост 1');
    const b = await send(boss, channel, 'пост 2');
    await fails(rpc(fan, 'admin_boost_channel_views', { p_chat: channel, p_views: 100 }));
    expect(await rpc<number>(boss, 'admin_boost_channel_views', { p_chat: channel, p_views: 1000 })).toBe(2);
    for (const id of [a, b]) {
      const v = (await views(id)).boost_views;
      expect(v).toBeGreaterThanOrEqual(800);
      expect(v).toBeLessThanOrEqual(1200);
    }
    // Одна строка в логе, а не по строке на пост.
    const { data } = await boss.db.from('messages').select('text').eq('chat_id', logs).like('text', '📈%');
    expect(data!.filter((m) => (m.text as string).includes('каждому из 2 постов'))).toHaveLength(1);
    expect(data!.filter((m) => (m.text as string).includes('накрутил(а) пост'))).toHaveLength(0);
  });

  it('авто-накрутка новых постов', async () => {
    await fails(rpc(fan, 'admin_set_auto_boost', { p_chat: channel, p_views: 500, p_reactions: {} }));
    await rpc(boss, 'admin_set_auto_boost', { p_chat: channel, p_views: 500, p_reactions: { '🔥': 50 } });
    const id = await send(boss, channel, 'новый пост');
    const v = await views(id);
    expect(v.boost_views).toBeGreaterThanOrEqual(400);
    expect(v.boost_reactions['🔥']).toBeGreaterThanOrEqual(40);
    await rpc(boss, 'admin_set_auto_boost', { p_chat: channel, p_views: 0, p_reactions: {} });
    expect((await views(await send(boss, channel, 'без накрутки'))).boost_views).toBe(0);
  });

  it('команды /boost, /boostviews, /autoboost', async () => {
    await send(boss, logs, `/boost Канал${run} 777`);
    const { data: c } = await boss.db.from('chats').select('boost_members').eq('id', channel).single();
    expect(c!.boost_members).toBe(777);
    await send(boss, logs, `/boostviews Канал${run} 100`);
    await send(boss, logs, `/autoboost Канал${run} 200`);
    const { data: c2 } = await boss.db.from('chats').select('auto_boost_views').eq('id', channel).single();
    expect(c2!.auto_boost_views).toBe(200);
    await send(boss, logs, '/boost Нет такого канала 5');
    const { data: last } = await boss.db
      .from('messages')
      .select('text')
      .eq('chat_id', logs)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    expect(last!.text).toMatch(/Пример: \/boost/);
  });
});
