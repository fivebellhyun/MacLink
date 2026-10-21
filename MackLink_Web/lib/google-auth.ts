import * as oauth from 'oauth4webapi';

export type GoogleUser = {
  userId: string;
  email: string;
  displayName: string;
  fullName: string | null;
};

export type GoogleSession = GoogleUser & { sessionHash: string };

export type GoogleAuthBindings = {
  DB?: D1Database;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  AUTH_BASE_URL?: string;
};

// Google's published OpenID configuration. Endpoints are fixed so neither an
// incoming Host header nor token contents can choose a credential destination.
// https://accounts.google.com/.well-known/openid-configuration
const GOOGLE: oauth.AuthorizationServer = {
  issuer: 'https://accounts.google.com',
  authorization_endpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  token_endpoint: 'https://oauth2.googleapis.com/token',
  jwks_uri: 'https://www.googleapis.com/oauth2/v3/certs',
  id_token_signing_alg_values_supported: ['RS256'],
  token_endpoint_auth_methods_supported: ['client_secret_post'],
  code_challenge_methods_supported: ['S256'],
};
const SESSION_LIFETIME = 7 * 24 * 60 * 60;
const TRANSACTION_LIFETIME = 10 * 60;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const CALLBACK = '/auth/google/callback';
type Settings = { db: D1Database; origin: string; secure: boolean; sessionCookie: string; transactionCookie: string };
type Transaction = { verifier: string; nonce: string; return_path: string };

function settings(env: GoogleAuthBindings): Settings | null {
  if (!env.DB || !env.AUTH_BASE_URL) return null;
  try {
    const url = new URL(env.AUTH_BASE_URL);
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/') return null;
    if (env.AUTH_BASE_URL !== url.origin && env.AUTH_BASE_URL !== url.origin + '/') return null;
    const secure = url.protocol === 'https:';
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (!secure && !(url.protocol === 'http:' && loopback)) return null;
    return {
      db: env.DB, origin: url.origin, secure,
      sessionCookie: secure ? '__Host-maclink_session' : 'maclink_local_session',
      transactionCookie: secure ? '__Host-maclink_oauth' : 'maclink_local_oauth',
    };
  } catch { return null; }
}

function clientSettings(env: GoogleAuthBindings): oauth.Client | null {
  if (!env.GOOGLE_CLIENT_ID || !/^[A-Za-z0-9_.-]+\.apps\.googleusercontent\.com$/.test(env.GOOGLE_CLIENT_ID) || env.GOOGLE_CLIENT_ID.length > 256) return null;
  if (!env.GOOGLE_CLIENT_SECRET || env.GOOGLE_CLIENT_SECRET.length > 2048 || /[\s\x00-\x1f\x7f]/.test(env.GOOGLE_CLIENT_SECRET)) return null;
  return { client_id: env.GOOGLE_CLIENT_ID, id_token_signed_response_alg: 'RS256', [oauth.clockTolerance]: 0 };
}

function response(status: number, message: string, headers = new Headers()): Response {
  headers.set('Cache-Control', 'no-store');
  headers.set('Pragma', 'no-cache');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Content-Type', 'text/plain; charset=utf-8');
  return new Response(message, { status, headers });
}

function redirect(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ Location: location });
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return response(303, '', headers);
}

function cookie(config: Settings, name: string, value: string, lifetime: number): string {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${lifetime}${config.secure ? '; Secure' : ''}`;
}

// Reject duplicate cookies rather than depending on framework-specific ordering.
function readCookie(req: Request, name: string): string | null {
  const values = (req.headers.get('cookie') || '').split(';').flatMap(part => {
    const at = part.indexOf('=');
    return at >= 0 && part.slice(0, at).trim() === name ? [part.slice(at + 1).trim()] : [];
  });
  return values.length === 1 && TOKEN.test(values[0]) ? values[0] : null;
}

function randomToken(): string { return oauth.generateRandomState(); }
async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function safeReturnPath(value: string | null): string {
  if (!value || value.length > 2048 || !value.startsWith('/') || value.startsWith('//')) return '/';
  let decoded = value;
  try {
    for (let i = 0; i < 3; i++) {
      if (/[\\\x00-\x20\x7f]/.test(decoded) || decoded.startsWith('//')) return '/';
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
    if (/[\\\x00-\x20\x7f]/.test(decoded) || decoded.startsWith('//')) return '/';
    const url = new URL(value, 'https://return.invalid');
    const decodedPath = new URL(decoded, 'https://return.invalid').pathname;
    if (url.origin !== 'https://return.invalid' || /^\/(?:auth(?:\/|$)|signin-with-chatgpt(?:\/|$)|signout-with-chatgpt(?:\/|$)|callback(?:\/|$))/.test(decodedPath)) return '/';
    return url.pathname + url.search + url.hash;
  } catch { return '/'; }
}

function duplicateParameters(url: URL): boolean {
  const seen = new Set<string>();
  for (const key of url.searchParams.keys()) {
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}

export async function getGoogleSession(req: Request, env: GoogleAuthBindings): Promise<GoogleSession | null> {
  const config = settings(env);
  if (!config || new URL(req.url).origin !== config.origin) return null;
  const token = readCookie(req, config.sessionCookie);
  if (!token) return null;
  try {
    const sessionHash = await hash(token);
    const user = await config.db.prepare(`SELECT u.id,u.email,u.name FROM auth_sessions s JOIN auth_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires>?`)
      .bind(sessionHash, Date.now()).first<{ id: string; email: string; name: string | null }>();
    return user ? { userId: user.id, email: user.email, fullName: user.name, displayName: user.name || user.email, sessionHash } : null;
  } catch { return null; }
}

export async function getGoogleUser(req: Request, env: GoogleAuthBindings): Promise<GoogleUser | null> {
  const session = await getGoogleSession(req, env);
  if (!session) return null;
  const { sessionHash: _sessionHash, ...user } = session;
  return user;
}

function endBrowserConnections(config: Settings, sessionHash: string): D1PreparedStatement {
  return config.db.prepare("UPDATE sessions SET status='ended',reason='로그인이 종료되었습니다. 다시 로그인해 주세요.',offer='',answer=NULL,generation=generation+1 WHERE auth_session_hash=? AND status!='ended'").bind(sessionHash);
}

async function start(req: Request, config: Settings, client: oauth.Client, url: URL): Promise<Response> {
  const origin = req.headers.get('origin');
  if ((origin && origin !== config.origin) || req.headers.get('sec-fetch-site') === 'cross-site') return response(403, '이 사이트에서 로그인을 다시 시작해 주세요.');
  const state = randomToken(), browser = randomToken(), nonce = oauth.generateRandomNonce();
  const verifier = oauth.generateRandomCodeVerifier(), now = Date.now();
  await config.db.batch([
    config.db.prepare('DELETE FROM auth_transactions WHERE expires<=?').bind(now),
    config.db.prepare('DELETE FROM auth_sessions WHERE expires<=?').bind(now),
    config.db.prepare('INSERT INTO auth_transactions (state_hash,browser_hash,verifier,nonce,return_path,expires) VALUES (?,?,?,?,?,?)')
      .bind(await hash(state), await hash(browser), verifier, nonce, safeReturnPath(url.searchParams.get('return_to')), now + TRANSACTION_LIFETIME * 1000),
  ]);
  const authorization = new URL(GOOGLE.authorization_endpoint!);
  authorization.search = new URLSearchParams({
    client_id: client.client_id, redirect_uri: config.origin + CALLBACK, response_type: 'code',
    scope: 'openid email profile', state, nonce,
    code_challenge: await oauth.calculatePKCECodeChallenge(verifier), code_challenge_method: 'S256',
  }).toString();
  return redirect(authorization.href, [cookie(config, config.transactionCookie, browser, TRANSACTION_LIFETIME)]);
}

async function callback(req: Request, env: GoogleAuthBindings, config: Settings, client: oauth.Client, url: URL): Promise<Response> {
  const clear = cookie(config, config.transactionCookie, '', 0);
  const failure = () => response(400, 'Google 로그인을 확인하지 못했습니다. 사이트에서 다시 로그인해 주세요.', new Headers({ 'Set-Cookie': clear }));
  const state = url.searchParams.get('state'), browser = readCookie(req, config.transactionCookie);
  if (!state || !TOKEN.test(state) || !browser) return failure();
  // D1 DELETE RETURNING consumes a transaction atomically. Parallel callbacks,
  // even in another Worker isolate, cannot exchange the same transaction twice.
  const transaction = await config.db.prepare('DELETE FROM auth_transactions WHERE state_hash=? AND browser_hash=? AND expires>? RETURNING verifier,nonce,return_path')
    .bind(await hash(state), await hash(browser), Date.now()).first<Transaction>();
  if (!transaction) return failure();
  try {
    const params = oauth.validateAuthResponse(GOOGLE, client, url, state);
    const code = params.get('code');
    if (!code || code.length > 4096) return failure();
    const tokenResponse = await oauth.authorizationCodeGrantRequest(
      GOOGLE, client, oauth.ClientSecretPost(env.GOOGLE_CLIENT_SECRET!), params,
      config.origin + CALLBACK, transaction.verifier, { signal: AbortSignal.timeout(10_000) },
    );
    const tokens = await oauth.processAuthorizationCodeResponse(GOOGLE, client, tokenResponse, { expectedNonce: transaction.nonce, requireIdToken: true });
    await oauth.validateApplicationLevelSignature(GOOGLE, tokenResponse, { signal: AbortSignal.timeout(10_000) });
    const claims = oauth.getValidatedIdTokenClaims(tokens);
    if (!claims || typeof claims.sub !== 'string' || !/^[\x21-\x7e]{1,255}$/.test(claims.sub) || claims.email_verified !== true) return failure();
    if (typeof claims.email !== 'string' || claims.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(claims.email)) return failure();
    const name = typeof claims.name === 'string' ? claims.name.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 256) || null : null;
    const id = 'google:' + claims.sub, email = claims.email.toLowerCase(), now = Date.now(), session = randomToken();
    const oldSession = readCookie(req, config.sessionCookie);
    const writes = [
      config.db.prepare('INSERT INTO auth_users (id,google_sub,email,name,created,updated) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email,name=excluded.name,updated=excluded.updated')
        .bind(id, claims.sub, email, name, now, now),
      config.db.prepare('INSERT INTO auth_sessions (token_hash,user_id,created,expires) VALUES (?,?,?,?)')
        .bind(await hash(session), id, now, now + SESSION_LIFETIME * 1000),
    ];
    if (oldSession) {
      const oldHash = await hash(oldSession);
      writes.push(endBrowserConnections(config, oldHash), config.db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').bind(oldHash));
    }
    await config.db.batch(writes);
    return redirect(config.origin + safeReturnPath(transaction.return_path), [clear, cookie(config, config.sessionCookie, session, SESSION_LIFETIME)]);
  } catch {
    // Neither provider errors, authorization codes nor token bodies reach logs
    // or client responses. A failed transaction must be restarted.
    return failure();
  }
}

async function signout(req: Request, config: Settings): Promise<Response> {
  if (req.headers.get('origin') !== config.origin || req.headers.get('sec-fetch-site') === 'cross-site') return response(403, '이 사이트에서 로그아웃해 주세요.');
  const token = readCookie(req, config.sessionCookie);
  if (token) {
    const sessionHash = await hash(token);
    await config.db.batch([endBrowserConnections(config, sessionHash), config.db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').bind(sessionHash)]);
  }
  return redirect(config.origin + '/', [cookie(config, config.sessionCookie, '', 0), cookie(config, config.transactionCookie, '', 0)]);
}

export async function handleGoogleAuth(req: Request, env: GoogleAuthBindings): Promise<Response> {
  const url = new URL(req.url);
  const route = url.pathname;
  if (!['/auth/google', CALLBACK, '/auth/signout'].includes(route)) return response(404, '페이지를 찾을 수 없습니다.');
  if ((route === '/auth/signout' && req.method !== 'POST') || (route !== '/auth/signout' && req.method !== 'GET')) return response(405, '허용되지 않은 요청입니다.');
  const config = settings(env);
  if (!config) return response(503, 'Google 로그인 설정이 아직 완료되지 않았습니다. 관리자에게 문의해 주세요.');
  if (url.origin !== config.origin || duplicateParameters(url)) return response(400, '올바른 사이트 주소에서 다시 시도해 주세요.');
  try {
    if (route === '/auth/signout') return await signout(req, config);
    const client = clientSettings(env);
    if (!client) return response(503, 'Google 로그인 설정이 아직 완료되지 않았습니다. 관리자에게 문의해 주세요.');
    return route === CALLBACK ? await callback(req, env, config, client, url) : await start(req, config, client, url);
  } catch { return response(503, '로그인 서비스를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.'); }
}
