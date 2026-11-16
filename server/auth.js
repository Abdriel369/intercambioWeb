'use strict';

const crypto = require('node:crypto');

const SESSION_ABSOLUTE_MS = 2 * 60 * 60 * 1000;
const SESSION_IDLE_MS = 30 * 60 * 1000;
const PARTICIPANT_COOKIE_MS = 180 * 24 * 60 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;
const LOGIN_BLOCK_MS = 10 * 60 * 1000;

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

function participantCookieName() {
  return isProduction() ? '__Host-mendiola_participant' : 'mendiola_participant';
}

function adminCookieName() {
  return 'mendiola_admin';
}

function parseCookies(header) {
  const cookies = {};
  if (!header || typeof header !== 'string') return cookies;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    if (!key) continue;
    let value = part.slice(index + 1).trim();
    try {
      value = decodeURIComponent(value);
    } catch (error) {
      // Se conserva el valor crudo si no es un porcentaje válido.
    }
    cookies[key] = value;
  }
  return cookies;
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest();
}

function hmacHex(value, secret) {
  return crypto.createHmac('sha256', String(secret)).update(String(value)).digest('hex');
}

function signValue(value, secret) {
  return `${value}.${hmacHex(value, secret)}`;
}

function unsignValue(signed, secret) {
  if (typeof signed !== 'string' || typeof secret !== 'string' || !secret) return null;
  const separator = signed.lastIndexOf('.');
  if (separator <= 0) return null;
  const value = signed.slice(0, separator);
  const signature = signed.slice(separator + 1);
  if (!/^[a-f0-9]{64}$/.test(value) || !/^[a-f0-9]{64}$/.test(signature)) return null;
  const expected = Buffer.from(hmacHex(value, secret), 'hex');
  const provided = Buffer.from(signature, 'hex');
  if (expected.length !== provided.length) return null;
  return crypto.timingSafeEqual(expected, provided) ? value : null;
}

function verifyAdminPassword(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string') return false;
  return crypto.timingSafeEqual(sha256(provided), sha256(expected));
}

function claimCodeMatches(expected, provided) {
  const expectedBuffer = Buffer.alloc(64);
  const providedBuffer = Buffer.alloc(64);
  const expectedText = String(expected || '');
  const providedText = String(provided || '').trim().toUpperCase();
  Buffer.from(expectedText, 'utf8').copy(expectedBuffer);
  Buffer.from(providedText, 'utf8').copy(providedBuffer);
  const equal = crypto.timingSafeEqual(expectedBuffer, providedBuffer);
  return equal && expectedText.length === providedText.length;
}

function participantCookieOptions() {
  return {
    httpOnly: true,
    secure: isProduction(),
    sameSite: 'lax',
    path: '/',
    maxAge: PARTICIPANT_COOKIE_MS,
  };
}

function adminCookieOptions() {
  return {
    httpOnly: true,
    secure: isProduction(),
    sameSite: 'strict',
    path: '/',
    maxAge: SESSION_ABSOLUTE_MS,
  };
}

function setParticipantCookie(res, token, sessionSecret) {
  res.cookie(participantCookieName(), signValue(token, sessionSecret), participantCookieOptions());
}

function clearParticipantCookie(res) {
  const options = participantCookieOptions();
  delete options.maxAge;
  res.clearCookie(participantCookieName(), options);
}

function participantTokenFromRequest(req, sessionSecret) {
  const cookies = parseCookies(req.headers.cookie);
  const signed = cookies[participantCookieName()];
  return unsignValue(signed, sessionSecret);
}

function originOf(value) {
  try {
    return new URL(String(value)).origin;
  } catch (error) {
    return null;
  }
}

function createAuth(options = {}) {
  const publicUrl = options.publicUrl || process.env.PUBLIC_URL || null;
  const sessionSecret = options.sessionSecret || process.env.SESSION_SECRET;
  if (!sessionSecret) {
    throw new Error('SESSION_SECRET es obligatoria para firmar las sesiones.');
  }
  const configuredOrigin = publicUrl ? originOf(publicUrl) : null;
  const sessions = new Map();
  const loginFailures = new Map();

  function readAdminSession(req) {
    const cookies = parseCookies(req.headers.cookie);
    const signed = cookies[adminCookieName()];
    const token = unsignValue(signed, sessionSecret);
    if (!token) return null;
    const key = sha256(token).toString('hex');
    const session = sessions.get(key);
    const now = Date.now();
    if (
      !session ||
      now - session.createdAt > SESSION_ABSOLUTE_MS ||
      now - session.lastSeen > SESSION_IDLE_MS
    ) {
      if (session) sessions.delete(key);
      return null;
    }
    return { token, key, session };
  }

  function csrf(req, res, next) {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      return next();
    }

    const path = req.path;
    const normalizedPath = path.length > 1 ? path.replace(/\/+$/, '') : path;
    const isLogin = normalizedPath === '/admin/login';
    const isProtectedAdmin =
      normalizedPath === '/admin' || normalizedPath.startsWith('/admin/');

    // Sin sesión de admin, las rutas protegidas deben responder 401 (no 403 por CSRF).
    // No hay ninguna escritura posible sin sesión, y así se mantiene el contrato de la API.
    if (isProtectedAdmin && !isLogin && !readAdminSession(req)) {
      return next();
    }

    const originHeader = req.get('origin');
    const origin = originHeader ? originOf(originHeader) : null;
    if (!origin) {
      return res.status(403).json({ error: 'Origen de solicitud no permitido.' });
    }

    const allowed = new Set();
    if (configuredOrigin) allowed.add(configuredOrigin);
    const host = req.get('host');
    if (host) allowed.add(`${req.protocol}://${host}`);

    if (!allowed.has(origin)) {
      return res.status(403).json({ error: 'Origen de solicitud no permitido.' });
    }
    return next();
  }

  function loginStatus(ip, now = Date.now()) {
    const entry = loginFailures.get(ip);
    if (!entry) return { allowed: true };
    if (entry.blockedUntil && entry.blockedUntil > now) {
      return { allowed: false, retryAfterMs: entry.blockedUntil - now };
    }
    if (entry.blockedUntil && entry.blockedUntil <= now) {
      loginFailures.delete(ip);
    }
    return { allowed: true };
  }

  function recordLoginFailure(ip, now = Date.now()) {
    const previous = loginFailures.get(ip);
    const count = (previous && previous.count ? previous.count : 0) + 1;
    const entry = { count, blockedUntil: null };
    if (count >= LOGIN_MAX_FAILURES) {
      entry.blockedUntil = now + LOGIN_BLOCK_MS;
    }
    loginFailures.set(ip, entry);
    return entry;
  }

  function clearLoginFailures(ip) {
    loginFailures.delete(ip);
  }

  function issueAdminSession(req, res) {
    const cookies = parseCookies(req.headers.cookie);
    const existingSigned = cookies[adminCookieName()];
    const existingToken = unsignValue(existingSigned, sessionSecret);
    if (existingToken) {
      sessions.delete(sha256(existingToken).toString('hex'));
    }

    const token = crypto.randomBytes(32).toString('hex');
    const key = sha256(token).toString('hex');
    const now = Date.now();
    sessions.set(key, { createdAt: now, lastSeen: now });
    res.cookie(adminCookieName(), signValue(token, sessionSecret), adminCookieOptions());
    return token;
  }

  function requireAdmin(req, res, next) {
    const current = readAdminSession(req);
    if (!current) {
      const clearOptions = adminCookieOptions();
      delete clearOptions.maxAge;
      res.clearCookie(adminCookieName(), clearOptions);
      return res.status(401).json({ error: 'No autorizado.' });
    }

    current.session.lastSeen = Date.now();
    req.adminSessionKey = current.key;
    req.adminSessionToken = current.token;
    return next();
  }

  function logoutAdmin(req, res) {
    if (req.adminSessionKey) sessions.delete(req.adminSessionKey);
    const clearOptions = adminCookieOptions();
    delete clearOptions.maxAge;
    res.clearCookie(adminCookieName(), clearOptions);
  }

  function invalidateAllSessions(res) {
    sessions.clear();
    const clearOptions = adminCookieOptions();
    delete clearOptions.maxAge;
    res.clearCookie(adminCookieName(), clearOptions);
  }

  return {
    csrf,
    loginStatus,
    recordLoginFailure,
    clearLoginFailures,
    issueAdminSession,
    requireAdmin,
    logoutAdmin,
    invalidateAllSessions,
  };
}

module.exports = {
  createAuth,
  parseCookies,
  participantCookieName,
  adminCookieName,
  setParticipantCookie,
  clearParticipantCookie,
  participantTokenFromRequest,
  participantCookieOptions,
  adminCookieOptions,
  verifyAdminPassword,
  claimCodeMatches,
  signValue,
  unsignValue,
  originOf,
  isProduction,
};
