// Серверная функция Bobogram (Supabase Edge Function, Deno).
//  - action "vapid": публичный ключ для пуш-подписки (ключи создаются сами при первом вызове)
//  - action "push": рассылка уведомлений; вызывается базой данных после нового сообщения или звонка
//  - action "reset_password": админ сервиса задаёт пользователю новый пароль
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

const admin: SupabaseClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

async function config(key: string): Promise<string | null> {
  const { data } = await admin.rpc('get_config', { p_key: key });
  return (data as string | null) ?? null;
}

let vapid: { publicKey: string; privateKey: string } | null = null;

/** VAPID-ключи хранятся в базе; при первом запуске создаются. */
async function getVapid() {
  if (vapid) return vapid;
  let pub = await config('vapid_public');
  let priv = await config('vapid_private');
  if (!pub || !priv) {
    const keys = webpush.generateVAPIDKeys();
    // Если две функции создают ключи одновременно, в базе останутся первые.
    priv = (await admin.rpc('set_config_if_absent', { p_key: 'vapid_private', p_value: keys.privateKey })).data;
    pub = (await admin.rpc('set_config_if_absent', {
      p_key: 'vapid_public',
      p_value: priv === keys.privateKey ? keys.publicKey : ((await config('vapid_public')) ?? keys.publicKey),
    })).data;
  }
  vapid = { publicKey: pub!, privateKey: priv! };
  webpush.setVapidDetails('mailto:admin@bobogram.app', vapid.publicKey, vapid.privateKey);
  return vapid;
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

interface Payload {
  kind: 'message' | 'call';
  chatId: string;
  title: string;
  body: string;
  tag: string;
}

/** Результат рассылки; ошибки видны в net._http_response базы (для диагностики). */
interface SendResult {
  sent: number;
  errors: string[];
}

async function sendTo(userIds: string[], payload: Payload): Promise<SendResult> {
  const result: SendResult = { sent: 0, errors: [] };
  if (!userIds.length) return result;
  await getVapid();
  const { data: subs } = await admin.from('push_subscriptions').select('endpoint, p256dh, auth').in('user_id', userIds);
  await Promise.all(
    (subs ?? []).map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payload),
          { TTL: payload.kind === 'call' ? 60 : 86400, urgency: 'high' },
        );
        result.sent++;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        result.errors.push(`${status ?? ''} ${(err as Error).message}`.trim().slice(0, 200));
        // Подписка больше не действует (приложение удалили или отключили уведомления).
        if (status === 404 || status === 410) await admin.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
      }
    }),
  );
  return result;
}

async function pushMessage(id: string) {
  const { data: msg } = await admin
    .from('messages')
    .select('id, chat_id, sender_id, text, call, system, media')
    .eq('id', id)
    .single();
  const none: SendResult = { sent: 0, errors: [] };
  if (!msg || msg.system) return none;
  const [{ data: chat }, { data: sender }, { data: members }] = await Promise.all([
    admin.from('chats').select('type, title').eq('id', msg.chat_id).single(),
    admin.from('profiles').select('display_name, username').eq('id', msg.sender_id).single(),
    admin.from('chat_members').select('user_id, muted').eq('chat_id', msg.chat_id),
  ]);
  if (!chat || !sender || chat.type === 'saved') return none;
  const recipients = (members ?? []).filter((m) => m.user_id !== msg.sender_id && !m.muted).map((m) => m.user_id);
  const name = sender.display_name || '@' + sender.username;
  const media = msg.media?.kind === 'voice' ? '🎤 Голосовое · Voice' : msg.media?.kind === 'photo' ? '📷 Фото · Photo' : '';
  const caption = truncate(msg.text ?? '', 300);
  const text = msg.call ? '📞' : media ? (caption ? `${media}: ${caption}` : media) : caption;
  const group = chat.type === 'group';
  return sendTo(recipients, {
    kind: 'message',
    chatId: msg.chat_id,
    title: chat.type === 'private' ? name : (chat.title ?? ''),
    body: group ? `${name}: ${text}` : text,
    tag: msg.chat_id,
  });
}

async function pushCall(id: string) {
  const { data: call } = await admin
    .from('calls')
    .select('caller_id, callee_id, chat_id, video, status')
    .eq('id', id)
    .single();
  if (!call || call.status !== 'ringing') return { sent: 0, errors: [] };
  const { data: caller } = await admin.from('profiles').select('display_name, username').eq('id', call.caller_id).single();
  return sendTo([call.callee_id], {
    kind: 'call',
    chatId: call.chat_id,
    title: caller?.display_name || '@' + caller?.username,
    body: call.video ? '📹 Видеозвонок · Video call' : '📞 Аудиозвонок · Voice call',
    tag: `call-${id}`,
  });
}

/**
 * Временные логин и пароль для своего TURN-сервера (coturn, use-auth-secret):
 * логин «<истекает>:<uid>», пароль — base64(HMAC-SHA1(секрет, логин)).
 */
export async function turnCredentials(secret: string, uid: string, ttlSeconds = 12 * 3600, now = Date.now()) {
  const username = `${Math.floor(now / 1000) + ttlSeconds}:${uid}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(username)));
  return { username, credential: btoa(String.fromCharCode(...sig)) };
}

async function callerId(req: Request): Promise<string | null> {
  const jwt = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const { data } = await admin.auth.getUser(jwt);
  return data.user?.id ?? null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, string>;

    if (body.action === 'vapid') {
      return json({ publicKey: (await getVapid()).publicKey });
    }

    if (body.action === 'turn') {
      const uid = await callerId(req);
      if (!uid) return json({ error: 'unauthorized' }, 401);
      const [secret, host] = await Promise.all([config('turn_secret'), config('turn_host')]);
      const stun: { urls: string[] } = { urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] };
      if (!secret || !host) return json({ iceServers: [stun] });
      const cred = await turnCredentials(secret, uid);
      return json({
        iceServers: [
          { urls: [`stun:${host}:3478`, ...stun.urls] },
          {
            urls: [`turn:${host}:3478?transport=udp`, `turn:${host}:3478?transport=tcp`, `turn:${host}:443?transport=tcp`],
            ...cred,
          },
        ],
        ttl: 12 * 3600,
      });
    }

    if (body.action === 'push') {
      // Вызывать может только база данных: она знает секрет.
      const secret = await config('push_secret');
      if (!secret || req.headers.get('x-push-secret') !== secret) return json({ error: 'forbidden' }, 403);
      return json(body.table === 'calls' ? await pushCall(body.id) : await pushMessage(body.id));
    }

    if (body.action === 'reset_password') {
      const jwt = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
      const { data: userData } = await admin.auth.getUser(jwt);
      const caller = userData.user;
      if (!caller) return json({ error: 'unauthorized' }, 401);
      const { data: profile } = await admin.from('profiles').select('role, banned').eq('id', caller.id).single();
      if (profile?.role !== 'admin' || profile.banned) return json({ error: 'forbidden' }, 403);
      if (typeof body.password !== 'string' || body.password.length < 6) return json({ error: 'weak password' }, 400);
      // Пароль владельца и со-владельцев меняет только владелец; боту — никто.
      const { data: owner } = await admin.rpc('get_owner_id');
      const { data: target } = await admin
        .from('profiles')
        .select('username, is_bot, co_owner')
        .eq('id', body.userId)
        .single();
      if (!target || target.is_bot || ((body.userId === owner || target.co_owner) && caller.id !== owner)) {
        return json({ error: 'forbidden' }, 403);
      }
      const { error } = await admin.auth.admin.updateUserById(body.userId, { password: body.password });
      if (error) return json({ error: error.message }, 400);
      const { data: me } = await admin.from('profiles').select('username').eq('id', caller.id).single();
      await admin.rpc('service_log', {
        p_text: `🔑 Администратор @${me?.username ?? '?'} задал(а) новый пароль @${target.username}`,
      });
      return json({ ok: true });
    }

    return json({ error: 'unknown action' }, 400);
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
