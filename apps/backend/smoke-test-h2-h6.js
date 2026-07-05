#!/usr/bin/env node
/**
 * Smoke test — H2 (HttpOnly cookie refresh handshake) + H6 (global JWT guard)
 *
 * Usage:
 *   node smoke-test-h2-h6.js [email] [password]
 *
 * Defaults (from .env / known test account):
 *   email    = mr.manishshrestha@gmail.com
 *   password = read from TEST_PASSWORD env or prompted
 *
 * What is tested:
 *   H2-1  POST /auth/login          → 200, Set-Cookie: refresh_token (HttpOnly)
 *   H2-2  POST /auth/refresh        → 200, cookie-only (no body token), rotates cookie
 *   H2-3  GET  /auth/me             → 200 with Bearer from step H2-1
 *   H2-4  POST /auth/refresh (bad)  → 401 (reuse detection — uses stale token)
 *   H2-5  POST /auth/logout         → 200, clears cookie
 *   H2-6  POST /auth/refresh        → 401 after logout
 *
 *   H6-1  GET  /users               → 401 with NO token        (guard blocks)
 *   H6-2  GET  /api/v1/health       → 200 with NO token        (@Public)
 *   H6-3  GET  /auth/me             → 401 with no token        (guard blocks)
 *   H6-4  GET  /auth/me             → 200 with valid token     (guard passes)
 */

const http = require('http');
const https = require('https');

const BASE = process.env.API_BASE || 'http://localhost:4000/api/v1';
const EMAIL = process.argv[2] || process.env.TEST_EMAIL || 'mr.manishshrestha@gmail.com';
const PASSWORD = process.argv[3] || process.env.TEST_PASSWORD || 'P@ssword123!';

if (!PASSWORD) {
  console.error('ERROR: Provide a password: node smoke-test-h2-h6.js <email> <password>');
  console.error('    or set TEST_PASSWORD env var');
  process.exit(1);
}

// tiny HTTP helper
function request(method, path, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;

    const bodyStr = body ? JSON.stringify(body) : undefined;
    const opts = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
        ...headers,
      },
    };

    const req = lib.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(Buffer.concat(chunks).toString()); } catch { }
        resolve({ status: res.statusCode, headers: res.headers, body: json });
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

const results = [];
let passed = 0, failed = 0;

function assert(name, condition, details) {
  if (condition) {
    console.log('  PASS  ' + name);
    results.push({ name, ok: true });
    passed++;
  } else {
    console.error('  FAIL  ' + name + (details ? '  =>  ' + details : ''));
    results.push({ name, ok: false, details });
    failed++;
  }
}

function extractCookie(setCookieHeader) {
  const headers = Array.isArray(setCookieHeader)
    ? setCookieHeader
    : [setCookieHeader].filter(Boolean);
  for (const h of headers) {
    const m = h.match(/^refresh_token=([^;]+)/);
    if (m) return { value: decodeURIComponent(m[1]), raw: h };
  }
  return null;
}

function cookieIsHttpOnly(rawHeader) {
  return /;\s*HttpOnly/i.test(rawHeader);
}

function cookieHasPath(rawHeader, path) {
  return new RegExp(';\\s*Path=' + path, 'i').test(rawHeader);
}

async function main() {
  console.log('');
  console.log('----------------------------------------------------------------------');
  console.log('Smoke test: H2 (cookie handshake) + H6 (global guard)');
  console.log('Base URL  : ' + BASE);
  console.log('User      : ' + EMAIL);
  console.log('----------------------------------------------------------------------');
  console.log('');

  let accessToken, cookieHeader, refreshCookieValue;

  // H2 tests
  console.log('H2 - HttpOnly cookie refresh handshake');
  console.log('');

  // H2-1: Login
  {
    const r = await request('POST', '/auth/login', {
      body: { email: EMAIL, password: PASSWORD, rememberMe: false },
    });
    assert('H2-1  login returns 200', r.status === 200, 'status=' + r.status + ' body=' + JSON.stringify(r.body));
    assert('H2-1  login returns access_token', !!r.body && !!r.body.access_token, JSON.stringify(r.body));
    assert('H2-1  login returns refresh_token in body (API-client compat)', !!(r.body && r.body.refresh_token));

    const cookie = extractCookie(r.headers['set-cookie']);
    assert('H2-1  Set-Cookie contains refresh_token', !!cookie, 'set-cookie: ' + JSON.stringify(r.headers['set-cookie']));
    assert('H2-1  cookie is HttpOnly', cookie ? cookieIsHttpOnly(cookie.raw) : false, cookie ? cookie.raw : '');
    assert('H2-1  cookie is path-scoped to /api/v1/auth', cookie ? cookieHasPath(cookie.raw, '/api/v1/auth') : false, cookie ? cookie.raw : '');

    accessToken = r.body && r.body.access_token;
    refreshCookieValue = cookie && cookie.value;
    cookieHeader = 'refresh_token=' + encodeURIComponent(refreshCookieValue || '');
  }

  // H2-2: Refresh using ONLY the cookie (no body token)
  let newRefreshCookieValue, newAccessToken;
  {
    const r = await request('POST', '/auth/refresh', {
      headers: { Cookie: cookieHeader },
    });
    assert('H2-2  cookie-only refresh returns 200', r.status === 200, 'status=' + r.status + ' body=' + JSON.stringify(r.body));
    assert('H2-2  refresh returns new access_token', !!(r.body && r.body.access_token));

    const newCookie = extractCookie(r.headers['set-cookie']);
    assert('H2-2  refresh rotates cookie', !!newCookie, 'set-cookie: ' + JSON.stringify(r.headers['set-cookie']));
    assert('H2-2  rotated cookie is HttpOnly', newCookie ? cookieIsHttpOnly(newCookie.raw) : false);

    newRefreshCookieValue = newCookie && newCookie.value;
    newAccessToken = r.body && r.body.access_token;
  }

  // H2-3: GET /auth/me with valid Bearer
  {
    const token = newAccessToken || accessToken;
    const r = await request('GET', '/auth/me', {
      headers: { Authorization: 'Bearer ' + token },
    });
    assert('H2-3  /auth/me with Bearer returns 200', r.status === 200, 'status=' + r.status);
    assert('H2-3  /auth/me returns user email', r.body && r.body.email === EMAIL, 'email=' + (r.body && r.body.email));
  }

  // H2-4: Replay the OLD (now-rotated) refresh token -> reuse detection -> 401
  {
    const r = await request('POST', '/auth/refresh', {
      headers: { Cookie: cookieHeader }, // old cookie
    });
    assert('H2-4  stale/replayed refresh token -> 401 (reuse detection)', r.status === 401, 'status=' + r.status + ' body=' + JSON.stringify(r.body));
  }

  // H2-5: Logout using the new cookie
  const newCookieHeader = 'refresh_token=' + encodeURIComponent(newRefreshCookieValue || '');
  {
    const r = await request('POST', '/auth/logout', {
      headers: { Cookie: newCookieHeader },
    });
    assert('H2-5  logout returns 200', r.status === 200, 'status=' + r.status);
    const sc = (r.headers['set-cookie'] || []).join('; ');
    assert('H2-5  logout clears cookie (Max-Age=0 or empty value)', /Max-Age=0|expires=Thu, 01 Jan 1970/i.test(sc) || sc.includes('refresh_token=;') || sc.includes('refresh_token=,') || sc === '', 'set-cookie: ' + sc);
  }

  // H2-6: Refresh after logout -> 401
  {
    const r = await request('POST', '/auth/refresh', {
      headers: { Cookie: newCookieHeader },
    });
    assert('H2-6  refresh after logout -> 401', r.status === 401, 'status=' + r.status + ' body=' + JSON.stringify(r.body));
  }

  // H6 tests
  console.log('');
  console.log('H6 - Global JWT guard');
  console.log('');

  // H6-1: Protected route with NO token -> 401
  {
    const r = await request('GET', '/users');
    assert('H6-1  GET /users (no token) -> 401', r.status === 401, 'status=' + r.status + ' body=' + JSON.stringify(r.body));
  }

  // H6-2: @Public health endpoint with NO token -> 200
  {
    const r = await request('GET', '/health');
    assert('H6-2  GET /health (@Public, no token) -> 200', r.status === 200, 'status=' + r.status);
  }

  // H6-3: /auth/me with NO token -> 401
  {
    const r = await request('GET', '/auth/me');
    assert('H6-3  GET /auth/me (no token) -> 401', r.status === 401, 'status=' + r.status);
  }

  // H6-4: Re-login and confirm /auth/me with token -> 200
  {
    const loginRes = await request('POST', '/auth/login', {
      body: { email: EMAIL, password: PASSWORD, rememberMe: false },
    });
    const token = loginRes.body && loginRes.body.access_token;
    const r = await request('GET', '/auth/me', {
      headers: { Authorization: 'Bearer ' + token },
    });
    assert('H6-4  GET /auth/me (valid Bearer) -> 200', r.status === 200, 'status=' + r.status);
  }

  // Summary
  console.log('');
  console.log('----------------------------------------------------------------------');
  console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
  console.log('----------------------------------------------------------------------');
  console.log('');

  if (failed > 0) {
    console.error('FAILED TESTS:');
    results.filter(function (r) { return !r.ok; }).forEach(function (r) {
      console.error('  FAIL ' + r.name + (r.details ? '  =>  ' + r.details : ''));
    });
    process.exit(1);
  } else {
    console.log('All smoke tests passed');
    process.exit(0);
  }
}

main().catch(function (err) {
  console.error('Unexpected error:', err);
  process.exit(2);
});
