import { Firestore, getAccessToken, verifyIdToken, type Doc } from './google';

export interface Env {
  FIREBASE_PROJECT_ID: string;
  ALLOWED_ORIGIN: string;
  /** client_email из JSON-ключа сервисного аккаунта */
  FIREBASE_CLIENT_EMAIL: string;
  /** private_key из JSON-ключа сервисного аккаунта */
  FIREBASE_PRIVATE_KEY: string;
  /** Cloudflare Realtime → TURN: Key ID и API token (необязательно) */
  TURN_KEY_ID?: string;
  TURN_KEY_API_TOKEN?: string;
}

/**
 * Бесплатный тариф Cloudflare: не больше 50 внешних запросов на вызов.
 * Поэтому пуши рассылаются частями по PART_SIZE, а клиент вызывает /notify для каждой части.
 */
export const PART_SIZE = 40;
const MAX_MESSAGE_AGE_MS = 5 * 60_000;

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function cors(env: Env, origin: string | null): Record<string, string> {
  const allowed = env.ALLOWED_ORIGIN.split(',').map((s) => s.trim());
  const ok = origin && (allowed.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));
  return {
    'Access-Control-Allow-Origin': ok ? origin! : allowed[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(data: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(data), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const headers = cors(env, request.headers.get('Origin'));
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return json({ ok: true, service: 'bobogram-worker' }, 200, headers);
    try {
      const auth = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
      if (!auth) throw new HttpError(401, 'no token');
      const claims = await verifyIdToken(auth, env.FIREBASE_PROJECT_ID).catch(() => {
        throw new HttpError(401, 'bad token');
      });
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      const path = new URL(request.url).pathname;
      if (path === '/turn') return json(await turn(env), 200, headers);
      if (path === '/notify') return json(await notifyMessage(env, claims.sub, body), 200, headers);
      if (path === '/notify-call') return json(await notifyCall(env, claims.sub, body), 200, headers);
      throw new HttpError(404, 'not found');
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      return json({ error: (err as Error).message }, status, headers);
    }
  },
};

// ---------- TURN ----------
async function turn(env: Env) {
  const stun = { urls: ['stun:stun.cloudflare.com:3478'] };
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return { iceServers: [stun] };
  const res = await fetch(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: 4 * 3600 }),
    },
  );
  if (!res.ok) return { iceServers: [stun] };
  return res.json();
}

// ---------- пуши ----------
async function firestore(env: Env) {
  const token = await getAccessToken(env.FIREBASE_CLIENT_EMAIL, env.FIREBASE_PRIVATE_KEY);
  return { fs: new Firestore(env.FIREBASE_PROJECT_ID, token), token };
}

function isMuted(prefs: Doc | null | undefined): boolean {
  const until = prefs?.mutedUntil as number | undefined;
  return until != null && (until === -1 || until > Date.now());
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

interface Target {
  uid: string;
  token: string;
}

/** Собирает токены получателей, пропуская тех, кто заглушил чат. */
async function collectTargets(fs: Firestore, recipients: string[], chatId: string | null): Promise<Target[]> {
  const paths = recipients.flatMap((uid) => [
    `pushTokens/${uid}`,
    ...(chatId ? [`userChats/${uid}/items/${chatId}`] : []),
  ]);
  const docs = await fs.batchGet(paths);
  const targets: Target[] = [];
  for (const uid of [...recipients].sort()) {
    if (chatId && isMuted(docs.get(`userChats/${uid}/items/${chatId}`))) continue;
    const tokens = (docs.get(`pushTokens/${uid}`)?.tokens ?? {}) as Record<string, number>;
    for (const token of Object.keys(tokens).sort()) targets.push({ uid, token });
  }
  return targets;
}

async function sendAll(env: Env, fs: Firestore, accessToken: string, targets: Target[], data: Record<string, string>) {
  const stale = new Map<string, string[]>();
  await Promise.all(
    targets.map(async ({ uid, token }) => {
      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/messages:send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            token,
            data,
            webpush: { headers: { Urgency: 'high', TTL: data.kind === 'call' ? '60' : '86400' } },
          },
        }),
      });
      if (res.status === 404 || res.status === 400) {
        const err = (await res.json().catch(() => null)) as { error?: { details?: { errorCode?: string }[] } } | null;
        const code = err?.error?.details?.find((d) => d.errorCode)?.errorCode;
        if (code === 'UNREGISTERED' || code === 'INVALID_ARGUMENT' || res.status === 404) {
          stale.set(uid, [...(stale.get(uid) ?? []), token]);
        }
      }
    }),
  );
  // Удаляем протухшие токены (укладываемся в лимит запросов).
  let budget = 50 - 4 - targets.length;
  for (const [uid, tokens] of stale) {
    if (budget-- <= 0) break;
    await fs.deleteMapKeys(`pushTokens/${uid}`, 'tokens', tokens).catch(() => undefined);
  }
}

async function notifyMessage(env: Env, uid: string, body: Record<string, unknown>) {
  const chatId = String(body.chatId ?? '');
  const messageId = String(body.messageId ?? '');
  const part = Math.max(0, Number(body.part ?? 0) | 0);
  if (!/^[\w-]{1,128}$/.test(chatId) || !/^[\w-]{1,128}$/.test(messageId)) throw new HttpError(400, 'bad ids');

  const { fs, token } = await firestore(env);
  const docs = await fs.batchGet([`chats/${chatId}`, `chats/${chatId}/messages/${messageId}`, `users/${uid}`]);
  const chat = docs.get(`chats/${chatId}`);
  const msg = docs.get(`chats/${chatId}/messages/${messageId}`);
  const sender = docs.get(`users/${uid}`);
  const members = (chat?.members ?? []) as string[];
  if (!chat || !msg || !sender || !members.includes(uid) || msg.senderId !== uid) throw new HttpError(403, 'forbidden');
  if (sender.banned === true) throw new HttpError(403, 'banned');
  if (Date.now() - Number(msg.createdAt ?? 0) > MAX_MESSAGE_AGE_MS) throw new HttpError(409, 'too old');
  if (msg.system || chat.type === 'saved') return { parts: 0, sent: 0 };

  const targets = await collectTargets(fs, members.filter((m) => m !== uid), chatId);
  const parts = Math.ceil(targets.length / PART_SIZE);
  const slice = targets.slice(part * PART_SIZE, (part + 1) * PART_SIZE);

  const senderName = String(sender.displayName || '@' + sender.username);
  const text = msg.call ? '📞' : truncate(String(msg.text ?? ''), 300);
  let title = senderName;
  let bodyText = text;
  if (chat.type === 'group') {
    title = String(chat.title ?? '');
    bodyText = `${senderName}: ${text}`;
  } else if (chat.type === 'channel') {
    title = String(chat.title ?? '');
  }

  await sendAll(env, fs, token, slice, { kind: 'message', chatId, title, body: bodyText, tag: chatId });
  return { parts, sent: slice.length };
}

async function notifyCall(env: Env, uid: string, body: Record<string, unknown>) {
  const callId = String(body.callId ?? '');
  if (!/^[\w-]{1,128}$/.test(callId)) throw new HttpError(400, 'bad id');
  const { fs, token } = await firestore(env);
  const docs = await fs.batchGet([`calls/${callId}`, `users/${uid}`]);
  const call = docs.get(`calls/${callId}`);
  const caller = docs.get(`users/${uid}`);
  if (!call || !caller || call.callerId !== uid || call.status !== 'ringing') throw new HttpError(403, 'forbidden');
  const targets = (await collectTargets(fs, [String(call.calleeId)], null)).slice(0, PART_SIZE);
  await sendAll(env, fs, token, targets, {
    kind: 'call',
    chatId: String(call.chatId),
    title: String(caller.displayName || '@' + caller.username),
    body: call.video ? '📹 Видеозвонок · Video call' : '📞 Аудиозвонок · Voice call',
    tag: `call-${callId}`,
  });
  return { sent: targets.length };
}
