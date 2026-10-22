export type TrackerApiConfig = {
  supabaseUrl: string;
  serviceRoleKey: string;
  ownerId: string;
  accessPassword: string;
  sessionSecret: string;
};

type TrackerState = {
  training: Record<string, unknown>;
  weeks: Record<string, unknown>;
  wealth: unknown[];
  linkedin: unknown[];
  sleep: unknown[];
  reviews: Record<string, unknown>;
  goals: Record<string, unknown>;
};

const COOKIE_NAME = 'tracker_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
function json(data: unknown, status = 200, headers: HeadersInit = {}) {
  return Response.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store', ...headers },
  });
}

function isConfigured(config: TrackerApiConfig | null): config is TrackerApiConfig {
  return Boolean(
    config?.supabaseUrl &&
      config.serviceRoleKey &&
      config.ownerId &&
      config.accessPassword.length >= 32 &&
      config.sessionSecret.length >= 32,
  );
}

function safeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) difference |= (a[i] || 0) ^ (b[i] || 0);
  return difference === 0;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function sign(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return toBase64Url(new Uint8Array(signature));
}

function getCookie(request: Request): string | null {
  const cookieHeader = request.headers.get('cookie') || '';
  for (const cookie of cookieHeader.split(';')) {
    const separator = cookie.indexOf('=');
    if (separator < 0) continue;
    if (cookie.slice(0, separator).trim() === COOKIE_NAME) {
      return cookie.slice(separator + 1).trim();
    }
  }
  return null;
}

function cookieHeader(request: Request, value: string, maxAge: number): string {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

function hasTrustedOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

async function createSession(config: TrackerApiConfig, nowSeconds = Math.floor(Date.now() / 1000)): Promise<string> {
  const expiresAt = nowSeconds + SESSION_TTL_SECONDS;
  const payload = `v1.${expiresAt}.${config.ownerId}`;
  return `v1.${expiresAt}.${await sign(payload, config.sessionSecret)}`;
}

async function isAuthenticated(
  request: Request,
  config: TrackerApiConfig,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  const token = getCookie(request);
  if (!token) return false;
  const match = token.match(/^v1\.(\d{10})\.([A-Za-z0-9_-]+)$/);
  if (!match) return false;
  const expiresAt = Number(match[1]);
  if (expiresAt <= nowSeconds || expiresAt > nowSeconds + SESSION_TTL_SECONDS + 60) return false;
  const expected = await sign(`v1.${expiresAt}.${config.ownerId}`, config.sessionSecret);
  return safeEqual(match[2], expected);
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function normalizeState(value: unknown): TrackerState {
  const state = normalizeRecord(value);
  return {
    training: normalizeRecord(state.training),
    weeks: normalizeRecord(state.weeks),
    wealth: Array.isArray(state.wealth) ? state.wealth : [],
    linkedin: Array.isArray(state.linkedin) ? state.linkedin : [],
    sleep: Array.isArray(state.sleep) ? state.sleep : [],
    reviews: normalizeRecord(state.reviews),
    goals: normalizeRecord(state.goals),
  };
}

function supabaseHeaders(config: TrackerApiConfig, extra?: HeadersInit): HeadersInit {
  return {
    apikey: config.serviceRoleKey,
    Authorization: 'Bearer ' + config.serviceRoleKey,
    'Content-Type': 'application/json',
    ...extra,
  };
}

export async function handleTrackerAuth(
  request: Request,
  config: TrackerApiConfig | null,
  nowSeconds?: number,
): Promise<Response> {
  if (!isConfigured(config)) return json({ error: 'Authentifizierung ist nicht konfiguriert.' }, 503);

  if (request.method === 'GET') {
    return json({ authenticated: await isAuthenticated(request, config, nowSeconds) });
  }
  if (request.method !== 'POST') return json({ error: 'Methode nicht erlaubt.' }, 405, { Allow: 'GET, POST' });
  if (!hasTrustedOrigin(request)) return json({ error: 'Ungueltige Anfrage.' }, 403);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Ungueltige Anfrage.' }, 400);
  }
  const action = normalizeRecord(body).action;
  if (action === 'logout') {
    return json({ authenticated: false }, 200, { 'Set-Cookie': cookieHeader(request, '', 0) });
  }
  const password = normalizeRecord(body).password;
  if (typeof password !== 'string' || !safeEqual(password, config.accessPassword)) {
    return json({ error: 'Anmeldung fehlgeschlagen.' }, 401);
  }

  const session = await createSession(config, nowSeconds);
  return json({ authenticated: true }, 200, {
    'Set-Cookie': cookieHeader(request, session, SESSION_TTL_SECONDS),
  });
}

export async function handleTrackerState(
  request: Request,
  config: TrackerApiConfig | null,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  if (!isConfigured(config)) return json({ error: 'Speicher ist nicht konfiguriert.' }, 503);
  if (!['GET', 'PUT'].includes(request.method)) return json({ error: 'Methode nicht erlaubt.' }, 405, { Allow: 'GET, PUT' });
  if (request.method === 'PUT' && !hasTrustedOrigin(request)) return json({ error: 'Ungueltige Anfrage.' }, 403);
  if (!(await isAuthenticated(request, config))) return json({ error: 'Nicht authentifiziert.' }, 401);

  try {
    if (request.method === 'GET') {
      const params = new URLSearchParams({
        owner_id: 'eq.' + config.ownerId,
        select: 'state,updated_at',
        limit: '1',
      });
      const response = await fetcher(
        config.supabaseUrl.replace(/\/$/, '') + '/rest/v1/tracker_state?' + params.toString(),
        {
          cache: 'no-store',
          headers: supabaseHeaders(config),
        },
      );
      if (!response.ok) return json({ error: 'Supabase konnte nicht gelesen werden.' }, 502);
      const rows = (await response.json()) as Array<{ state?: unknown; updated_at?: string }>;
      return json({
        configured: true,
        state: rows[0] ? normalizeState(rows[0].state) : null,
        updatedAt: rows[0]?.updated_at ?? null,
      });
    }

    const contentLength = Number(request.headers.get('content-length') || 0);
    if (contentLength > MAX_BODY_BYTES) return json({ error: 'Anfrage ist zu gross.' }, 413);
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) return json({ error: 'Anfrage ist zu gross.' }, 413);
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return json({ error: 'Ungueltiger JSON-Inhalt.' }, 400);
    }
    const state = normalizeState(body);
    const response = await fetcher(config.supabaseUrl.replace(/\/$/, '') + '/rest/v1/tracker_state?on_conflict=owner_id', {
      method: 'POST',
      headers: supabaseHeaders(config, { Prefer: 'resolution=merge-duplicates' }),
      body: JSON.stringify({
        owner_id: config.ownerId,
        state,
        updated_at: new Date().toISOString(),
      }),
    });
    if (!response.ok) return json({ error: 'Supabase konnte nicht gespeichert werden.' }, 502);
    return json({ configured: true, saved: true });
  } catch {
    return json({ error: 'Supabase ist nicht erreichbar.' }, 502);
  }
}
