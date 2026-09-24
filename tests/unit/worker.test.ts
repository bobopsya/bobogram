// @vitest-environment node
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { b64url, decodeFields, getAccessToken, resetJwksCache, verifyIdToken } from '../../worker/src/google';
import worker, { type Env } from '../../worker/src/index';

const PROJECT = 'demo-bobogram';
let keys: CryptoKeyPair;
let jwk: JsonWebKey;
let pem: string;

beforeAll(async () => {
  keys = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  jwk = { ...(await crypto.subtle.exportKey('jwk', keys.publicKey)), kid: 'k1' } as JsonWebKey;
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', keys.privateKey));
  pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...pkcs8))}\n-----END PRIVATE KEY-----\n`;
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetJwksCache();
});

async function idToken(claims: Record<string, unknown>) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64url(JSON.stringify({ alg: 'RS256', kid: 'k1' }));
  const p = b64url(
    JSON.stringify({
      iss: `https://securetoken.google.com/${PROJECT}`,
      aud: PROJECT,
      sub: 'alice',
      iat: now,
      exp: now + 3600,
      email_verified: true,
      ...claims,
    }),
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64url(sig)}`;
}

const jwksFetch = (async () =>
  new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'cache-control': 'max-age=100' } })) as typeof fetch;

describe('проверка ID-токена', () => {
  it('принимает правильный токен', async () => {
    const claims = await verifyIdToken(await idToken({}), PROJECT, jwksFetch);
    expect(claims.sub).toBe('alice');
  });
  it('отклоняет чужой проект, просроченный и неподтверждённый', async () => {
    await expect(verifyIdToken(await idToken({ aud: 'other' }), PROJECT, jwksFetch)).rejects.toThrow();
    await expect(verifyIdToken(await idToken({ exp: 10 }), PROJECT, jwksFetch)).rejects.toThrow();
    await expect(verifyIdToken(await idToken({ email_verified: false }), PROJECT, jwksFetch)).rejects.toThrow();
  });
  it('отклоняет подделанную подпись', async () => {
    const t = await idToken({});
    const [h, , s] = t.split('.');
    const forged = `${h}.${b64url(JSON.stringify({ sub: 'mallory', aud: PROJECT }))}.${s}`;
    await expect(verifyIdToken(forged, PROJECT, jwksFetch)).rejects.toThrow('signature');
  });
});

describe('Firestore REST', () => {
  it('раскодирует значения', () => {
    expect(
      decodeFields({
        a: { stringValue: 'x' },
        b: { integerValue: '5' },
        c: { arrayValue: { values: [{ booleanValue: true }] } },
        d: { mapValue: { fields: { e: { nullValue: null } } } },
        t: { timestampValue: '2026-01-01T00:00:00Z' },
      }),
    ).toEqual({ a: 'x', b: 5, c: [true], d: { e: null }, t: Date.parse('2026-01-01T00:00:00Z') });
  });

  it('подписывает запрос токена сервисного аккаунта', async () => {
    let assertion = '';
    const fetcher = (async (_url: string, init: RequestInit) => {
      assertion = new URLSearchParams(String(init.body)).get('assertion')!;
      return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }));
    }) as unknown as typeof fetch;
    expect(await getAccessToken('sa@x.iam.gserviceaccount.com', pem.replace(/\n/g, '\\n'), fetcher)).toBe('tok');
    const [h, p, s] = assertion.split('.');
    const pad = (x: string) => x.replace(/-/g, '+').replace(/_/g, '/');
    const sig = Uint8Array.from(atob(pad(s) + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', keys.publicKey, sig, new TextEncoder().encode(`${h}.${p}`));
    expect(ok).toBe(true);
  });
});

describe('рассылка /notify', () => {
  const env: Env = {
    FIREBASE_PROJECT_ID: PROJECT,
    ALLOWED_ORIGIN: 'https://bobopsya.github.io',
    FIREBASE_CLIENT_EMAIL: 'sa@x',
    FIREBASE_PRIVATE_KEY: '',
  };

  const fsDoc = (name: string, fields: Record<string, unknown>) => ({
    found: { name: `projects/${PROJECT}/databases/(default)/documents/${name}`, fields },
  });

  it('шлёт пуши получателям, кроме заглушивших, и чистит протухшие токены', async () => {
    env.FIREBASE_PRIVATE_KEY = pem;
    const sent: string[] = [];
    const patched: string[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url.includes('jwk')) return jwksFetch(url);
      if (url.includes('oauth2')) return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }));
      if (url.endsWith(':batchGet')) {
        const docs = JSON.parse(String(init!.body)).documents as string[];
        if (docs.some((d) => d.endsWith('/users/alice'))) {
          return new Response(
            JSON.stringify([
              fsDoc('chats/g1', {
                type: { stringValue: 'group' },
                title: { stringValue: 'Друзья' },
                members: { arrayValue: { values: ['alice', 'bob', 'carol'].map((s) => ({ stringValue: s })) } },
              }),
              fsDoc('chats/g1/messages/m1', {
                senderId: { stringValue: 'alice' },
                text: { stringValue: 'Привет' },
                createdAt: { timestampValue: new Date().toISOString() },
              }),
              fsDoc('users/alice', { displayName: { stringValue: 'Алиса' }, username: { stringValue: 'alice' } }),
            ]),
          );
        }
        return new Response(
          JSON.stringify([
            fsDoc('pushTokens/bob', { tokens: { mapValue: { fields: { tb1: { integerValue: '1' }, dead: { integerValue: '1' } } } } }),
            fsDoc('userChats/bob/items/g1', {}),
            fsDoc('pushTokens/carol', { tokens: { mapValue: { fields: { tc1: { integerValue: '1' } } } } }),
            fsDoc('userChats/carol/items/g1', { mutedUntil: { integerValue: '-1' } }),
          ]),
        );
      }
      if (url.includes('fcm.googleapis.com')) {
        const msg = JSON.parse(String(init!.body)).message;
        if (msg.token === 'dead') {
          return new Response(JSON.stringify({ error: { details: [{ errorCode: 'UNREGISTERED' }] } }), { status: 404 });
        }
        sent.push(`${msg.token}:${msg.data.title}:${msg.data.body}`);
        return new Response('{}');
      }
      if (init?.method === 'PATCH') {
        patched.push(decodeURIComponent(url));
        return new Response('{}');
      }
      throw new Error('unexpected ' + url);
    });

    const res = await worker.fetch(
      new Request('https://w.dev/notify', {
        method: 'POST',
        headers: { Authorization: `Bearer ${await idToken({})}`, Origin: 'https://bobopsya.github.io' },
        body: JSON.stringify({ chatId: 'g1', messageId: 'm1', part: 0 }),
      }),
      env,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ parts: 1, sent: 2 });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://bobopsya.github.io');
    expect(sent).toEqual(['tb1:Друзья:Алиса: Привет']);
    expect(patched[0]).toContain('pushTokens/bob');
    expect(patched[0]).toContain('tokens.`dead`');
  });

  it('без токена — 401', async () => {
    const res = await worker.fetch(new Request('https://w.dev/notify', { method: 'POST', body: '{}' }), env);
    expect(res.status).toBe(401);
  });
});
