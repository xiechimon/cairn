import { createHash } from 'node:crypto';
import { OWNER_LINK_REDEEM_PATH } from '@cairn/shared';
import type { Context, Hono } from 'hono';
import { z } from 'zod';
import type { AppContext } from './context.js';
import { parseWith } from './lib/errors.js';
import { remoteRoutesOf } from './lib/remote-routes.js';
import { isDirectLoopbackOrigin, requestOrigin } from './lib/request-origin.js';
import { tailnetListenerOf } from './lib/tailnet-listener.js';
import { hasOwnerBearer } from './lib/token-auth.js';
import { jsonBody } from './routes-helpers.js';
import { requestIsSecure, setAuthCookie } from './services/browser-session.js';
import { issueOwnerLink, redeemOwnerLink } from './services/paired-devices.js';

const redeemBody = z.object({ code: z.string().min(1).max(256) }).strict();

const signInScript = `
const fragment = location.hash.slice(1);
history.replaceState(null, '', location.pathname);
const code = new URLSearchParams(fragment).get('code');
const showError = () => {
  document.getElementById('status').textContent = 'This sign-in link could not be used. Run npx @xiechimon/cairn token --link on the server to get a fresh link.';
};
if (!code) {
  showError();
} else {
  fetch('${OWNER_LINK_REDEEM_PATH}', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'error',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
  }).then((response) => {
    if (response.ok) location.replace('/app');
    else showError();
  }, showError);
}
`;
const scriptHash = createHash('sha256').update(signInScript).digest('base64');

function trustedRedeemOrigin(c: Context, remote: AppContext['remote']): boolean {
  if (c.req.header('sec-fetch-site') !== 'same-origin') return false;
  const origin = requestOrigin(c);
  const browserOrigin = c.req.header('origin');
  if (browserOrigin !== undefined && browserOrigin !== origin) return false;
  if (tailnetListenerOf(c) === null && isDirectLoopbackOrigin(c)) return true;
  if (remote === undefined || !origin.startsWith('https://')) return false;
  if (c.req.header('host')?.toLowerCase() !== new URL(origin).host) return false;
  return remoteRoutesOf(remote).routes.some((route) => route.url === origin);
}

export function registerOwnerLinkRoutes(app: Hono, ctx: AppContext): void {
  app.get('/app/sign-in', (c) => {
    c.header('cache-control', 'no-store');
    c.header('referrer-policy', 'no-referrer');
    c.header('x-content-type-options', 'nosniff');
    c.header(
      'content-security-policy',
      `default-src 'none'; script-src 'sha256-${scriptHash}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
    );
    return c.html(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sign in to Cairn</title>
</head>
<body>
  <main>
    <h1>Sign in to Cairn</h1>
    <p id="status" role="status">Signing in…</p>
    <noscript>Enable JavaScript to sign in.</noscript>
  </main>
  <script>${signInScript}</script>
</body>
</html>`);
  });

  app.post('/api/auth/owner-link', (c) => {
    c.header('cache-control', 'no-store');
    if (ctx.authToken === null || !hasOwnerBearer(c, ctx.authToken)) {
      return c.json({ error: 'only the owner token can issue a sign-in link' }, 403);
    }
    return c.json(issueOwnerLink(ctx.db), 201);
  });

  app.post('/api/auth/owner-link/redeem', async (c) => {
    c.header('cache-control', 'no-store');
    if (!trustedRedeemOrigin(c, ctx.remote)) {
      return c.json({ error: 'untrusted browser origin' }, 403);
    }
    if (ctx.authToken === null) return c.json({ error: 'owner sign-in needs token auth' }, 409);
    if (
      c.req.header('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json'
    ) {
      return c.json({ error: 'application/json required' }, 415);
    }
    const { code } = parseWith(redeemBody, await jsonBody(c), 'body');
    const session = redeemOwnerLink(ctx.db, code);
    if (session === null) return c.json({ error: 'sign-in link is invalid or expired' }, 401);
    setAuthCookie(c, session.token, requestIsSecure(c), session.expiresAt);
    return c.json({ ok: true });
  });
}
