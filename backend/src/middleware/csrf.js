/**
 * CSRF double-submit cookie middleware.
 *
 * The browser automatically sends the httpOnly `refreshToken` cookie on every
 * same-origin AND cross-origin credentialed request, making /auth/refresh and
 * /auth/logout vulnerable to CSRF-based forced token rotation.
 *
 * Defence: on login/refresh the server also sets a non-httpOnly `csrf_token`
 * cookie. JavaScript can read it and must echo it back as the `X-CSRF-Token`
 * request header. A cross-origin attacker cannot read the cookie value, so
 * they cannot forge the header.
 */
const crypto = require('crypto');

const CSRF_COOKIE = 'csrf_token';

const CSRF_COOKIE_OPTIONS = {
  httpOnly: false,          // must be readable by JS
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
  path: '/',
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days — matches refresh token lifetime
};

/** Generate a new CSRF token and set it as a readable cookie. */
function setCsrfCookie(res) {
  const token = crypto.randomBytes(32).toString('hex');
  res.cookie(CSRF_COOKIE, token, CSRF_COOKIE_OPTIONS);
  return token;
}

/** Middleware: reject the request if the X-CSRF-Token header doesn't match the cookie. */
function verifyCsrf(req, res, next) {
  const cookieToken = req.cookies?.[CSRF_COOKIE];
  const headerToken = req.headers['x-csrf-token'];

  if (!cookieToken || !headerToken) {
    return res.status(403).json({ error: 'CSRF token missing' });
  }

  // Constant-time comparison to prevent timing attacks
  const a = Buffer.from(cookieToken);
  const b = Buffer.from(headerToken);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(403).json({ error: 'CSRF token invalid' });
  }

  next();
}

module.exports = { setCsrfCookie, verifyCsrf, CSRF_COOKIE };
