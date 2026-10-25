import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const SESSION_COOKIE = 'rb_session';
const SESSION_DAYS = 365;

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

function parseCookies(header = '') {
  const cookies = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    try {
      cookies[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      // ignore malformed cookies from other apps on the same host
    }
  }
  return cookies;
}

// Single shared password. Sessions and the API token are signed with a key
// derived from it (plus a server-side secret, so a leaked cookie can't be used
// to guess the password offline). Changing APP_PASSWORD logs out every device
// and invalidates old tokens.
export function createAuth(password, serverSecret = randomBytes(32).toString('hex')) {
  const enabled = Boolean(password);
  const secret = createHash('sha256').update(`rezeptbox:${serverSecret}:${password || ''}`).digest();
  const sign = (value) => createHmac('sha256', secret).update(value).digest('base64url');
  const apiToken = sign('api-token').slice(0, 32);
  const failures = new Map();

  function sessionValid(token) {
    const [expires, signature] = String(token || '').split('.');
    return Boolean(expires && signature) && Number(expires) > Date.now() && safeEqual(signature, sign(`session:${expires}`));
  }

  return {
    enabled,
    apiToken,

    // `headers` is a Fetch API Headers object.
    isAuthorized(headers) {
      if (!enabled) return true;
      const header = headers.get('authorization') || '';
      if (header.startsWith('Bearer ') && safeEqual(header.slice(7).trim(), apiToken)) return true;
      return sessionValid(parseCookies(headers.get('cookie') || '')[SESSION_COOKIE]);
    },

    // Basic brute-force protection: 10 wrong passwords per IP per 15 minutes.
    checkPassword(candidate, ip) {
      const now = Date.now();
      const entry = failures.get(ip);
      if (entry && entry.until > now && entry.count >= 10) return { ok: false, locked: true };
      if (safeEqual(candidate, password)) {
        failures.delete(ip);
        return { ok: true };
      }
      const fresh = !entry || entry.until <= now;
      failures.set(ip, { count: fresh ? 1 : entry.count + 1, until: fresh ? now + 15 * 60_000 : entry.until });
      if (failures.size > 1000) {
        for (const [key, value] of failures) if (value.until <= now) failures.delete(key);
      }
      return { ok: false, locked: false };
    },

    sessionCookie(secure) {
      const expires = Date.now() + SESSION_DAYS * 86_400_000;
      const value = `${expires}.${sign(`session:${expires}`)}`;
      return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86_400}${secure ? '; Secure' : ''}`;
    },

    clearCookie() {
      return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
    },
  };
}
