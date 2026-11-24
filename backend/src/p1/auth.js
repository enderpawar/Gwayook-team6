import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { P1Error } from './db.js';

const derive = promisify(scrypt);
const sessionTtl = 12 * 60 * 60 * 1000;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/u;
const absentSalt = randomBytes(16);

export function hashToken(token) {
  return typeof token === 'string' && tokenPattern.test(token)
    ? createHash('sha256').update(token).digest() : null;
}

export function newToken() {
  return randomBytes(32).toString('base64url');
}

function emailAndPassword(body) {
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = body?.password;
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    throw new P1Error(422, 'INVALID_CREDENTIAL_INPUT', ['email']);
  }
  if (typeof password !== 'string' || password.length < 12 || Buffer.byteLength(password) > 256) {
    throw new P1Error(422, 'INVALID_CREDENTIAL_INPUT', ['password']);
  }
  return { email, password };
}

export async function register(store, body) {
  const { email, password } = emailAndPassword(body);
  const displayName = typeof body?.displayName === 'string' ? body.displayName.trim() : '';
  if (!displayName || displayName.length > 40 || /[\p{Cc}\p{Cf}]/u.test(displayName)) {
    throw new P1Error(422, 'INVALID_DISPLAY_NAME', ['displayName']);
  }
  const salt = randomBytes(16);
  const passwordHash = await derive(password, salt, 64);
  const user = { id: randomUUID(), displayName };
  store.transaction((db) => {
    const result = db.prepare(`INSERT INTO users (id, email, display_name, password_salt, password_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (email) DO NOTHING`).run(user.id, email, displayName, salt, passwordHash, Date.now());
    if (!result.changes) throw new P1Error(409, 'EMAIL_ALREADY_REGISTERED');
  });
  return user;
}

export async function login(store, body) {
  const { email, password } = emailAndPassword(body);
  const row = store.db.prepare('SELECT id, display_name, password_salt, password_hash FROM users WHERE email = ?').get(email);
  const candidate = await derive(password, row?.password_salt ?? absentSalt, 64);
  if (!row || !timingSafeEqual(candidate, row.password_hash)) throw new P1Error(401, 'INVALID_CREDENTIALS');
  const token = newToken();
  const expiresAt = store.transaction((db) => {
    const now = Date.now();
    db.prepare('INSERT INTO auth_session VALUES (?, ?, ?, ?)').run(hashToken(token), row.id, now, now + sessionTtl);
    return now + sessionTtl;
  });
  return { token, expiresAt: new Date(expiresAt).toISOString(), user: { id: row.id, displayName: row.display_name } };
}

function bearerHash(request) {
  const header = request.headers.authorization;
  return typeof header === 'string' && header.startsWith('Bearer ') ? hashToken(header.slice(7)) : null;
}

export function requireUser(db, request) {
  const hash = bearerHash(request);
  const user = hash && db.prepare(`SELECT u.id, u.display_name AS displayName FROM auth_session AS s
    JOIN users AS u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?`).get(hash, Date.now());
  if (!user) throw new P1Error(401, 'AUTH_REQUIRED');
  return user;
}

export function logout(store, request) {
  const hash = bearerHash(request);
  if (!hash) throw new P1Error(401, 'AUTH_REQUIRED');
  store.transaction((db) => db.prepare('DELETE FROM auth_session WHERE token_hash = ?').run(hash));
}
