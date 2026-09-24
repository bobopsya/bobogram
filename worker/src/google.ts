// Работа с Google API без SDK: проверка Firebase ID-токена, токен сервисного аккаунта, Firestore REST.

const enc = new TextEncoder();

export function b64url(data: ArrayBuffer | Uint8Array | string): string {
  const bytes = typeof data === 'string' ? enc.encode(data) : new Uint8Array(data);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function decodeJson<T>(part: string): T {
  return JSON.parse(new TextDecoder().decode(b64urlDecode(part))) as T;
}

// ---------- проверка ID-токена Firebase ----------
const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
let jwksCache: { keys: Map<string, CryptoKey>; expires: number } | null = null;

async function getJwks(fetcher: typeof fetch): Promise<Map<string, CryptoKey>> {
  if (jwksCache && jwksCache.expires > Date.now()) return jwksCache.keys;
  const res = await fetcher(JWKS_URL);
  if (!res.ok) throw new Error('jwks');
  const { keys } = (await res.json()) as { keys: (JsonWebKey & { kid: string })[] };
  const map = new Map<string, CryptoKey>();
  for (const jwk of keys) {
    map.set(
      jwk.kid,
      await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']),
    );
  }
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '')?.[1] ?? 3600);
  jwksCache = { keys: map, expires: Date.now() + maxAge * 1000 };
  return map;
}

export interface IdTokenClaims {
  sub: string;
  email_verified?: boolean;
  iss: string;
  aud: string;
  exp: number;
  iat: number;
}

/** Проверяет подпись и поля Firebase ID-токена. Возвращает uid или бросает ошибку. */
export async function verifyIdToken(
  token: string,
  projectId: string,
  fetcher: typeof fetch = fetch,
  now = Date.now() / 1000,
): Promise<IdTokenClaims> {
  const [h, p, s] = token.split('.');
  if (!h || !p || !s) throw new Error('malformed');
  const header = decodeJson<{ alg: string; kid: string }>(h);
  const claims = decodeJson<IdTokenClaims>(p);
  if (header.alg !== 'RS256') throw new Error('alg');
  const key = (await getJwks(fetcher)).get(header.kid);
  if (!key) throw new Error('kid');
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlDecode(s), enc.encode(`${h}.${p}`));
  if (!ok) throw new Error('signature');
  if (claims.aud !== projectId || claims.iss !== `https://securetoken.google.com/${projectId}`) throw new Error('aud');
  if (claims.exp < now || claims.iat > now + 300 || !claims.sub) throw new Error('expired');
  if (claims.email_verified !== true) throw new Error('unverified');
  return claims;
}

/** Для тестов. */
export function resetJwksCache() {
  jwksCache = null;
}

// ---------- токен сервисного аккаунта ----------
let accessCache: { token: string; expires: number } | null = null;

function pemToPkcs8(pem: string): ArrayBuffer {
  const body = pem.replace(/\\n/g, '\n').replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  return Uint8Array.from(atob(body), (c) => c.charCodeAt(0)).buffer;
}

export async function getAccessToken(clientEmail: string, privateKey: string, fetcher: typeof fetch = fetch) {
  if (accessCache && accessCache.expires > Date.now() + 60_000) return accessCache.token;
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(
    JSON.stringify({
      iss: clientEmail,
      scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }),
  );
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8(privateKey),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(`${header}.${claims}`));
  const res = await fetcher('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${header}.${claims}.${b64url(sig)}`,
  });
  if (!res.ok) throw new Error('oauth ' + res.status);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  accessCache = { token: data.access_token, expires: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

// ---------- Firestore REST ----------
type FsValue = {
  nullValue?: null;
  booleanValue?: boolean;
  integerValue?: string;
  doubleValue?: number;
  timestampValue?: string;
  stringValue?: string;
  mapValue?: { fields?: Record<string, FsValue> };
  arrayValue?: { values?: FsValue[] };
};

export function decodeValue(v: FsValue): unknown {
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('timestampValue' in v) return Date.parse(v.timestampValue!);
  if ('mapValue' in v) return decodeFields(v.mapValue?.fields ?? {});
  if ('arrayValue' in v) return (v.arrayValue?.values ?? []).map(decodeValue);
  return null;
}

export function decodeFields(fields: Record<string, FsValue>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) out[k] = decodeValue(v);
  return out;
}

export type Doc = Record<string, unknown>;

export class Firestore {
  constructor(
    private projectId: string,
    private token: string,
    private fetcher: typeof fetch = fetch,
  ) {}

  private get root() {
    return `projects/${this.projectId}/databases/(default)/documents`;
  }

  /** Читает несколько документов одним запросом. Отсутствующие — null. */
  async batchGet(paths: string[]): Promise<Map<string, Doc | null>> {
    const result = new Map<string, Doc | null>();
    if (!paths.length) return result;
    const res = await this.fetcher(`https://firestore.googleapis.com/v1/${this.root}:batchGet`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ documents: paths.map((p) => `${this.root}/${p}`) }),
    });
    if (!res.ok) throw new Error('firestore ' + res.status);
    const items = (await res.json()) as { found?: { name: string; fields?: Record<string, FsValue> }; missing?: string }[];
    const prefix = this.root + '/';
    for (const item of items) {
      if (item.found) result.set(item.found.name.slice(prefix.length), decodeFields(item.found.fields ?? {}));
      else if (item.missing) result.set(item.missing.slice(prefix.length), null);
    }
    return result;
  }

  /** Удаляет ключи из map-поля документа (например, протухшие токены). */
  async deleteMapKeys(path: string, field: string, keys: string[]): Promise<void> {
    const mask = keys.map((k) => `updateMask.fieldPaths=${encodeURIComponent(`${field}.\`${k.replace(/`/g, '\\`')}\``)}`);
    await this.fetcher(`https://firestore.googleapis.com/v1/${this.root}/${path}?${mask.join('&')}&currentDocument.exists=true`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: {} }),
    });
  }
}
