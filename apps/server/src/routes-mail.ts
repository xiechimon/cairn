import {
  mailAccountCreateBodySchema,
  mailAccountPatchBodySchema,
  mailRuleCreateBodySchema,
} from '@cairn/shared';
import type { Context, Hono } from 'hono';
import type { AppContext } from './context.js';
import { HttpError, parseWith } from './lib/errors.js';
import { pairedDeviceIdOf } from './lib/token-auth.js';
import { jsonBody, requireTeam } from './routes-helpers.js';
import {
  addMailRule,
  createMailAccount,
  listMailAccounts,
  removeMailRule,
  requireMailAccount,
  updateMailAccount,
} from './services/mail-accounts.js';
import type { MailConnector } from './services/mail-connector.js';

function requireMail(ctx: AppContext): MailConnector {
  if (ctx.mail === undefined) throw new HttpError(503, 'mail service is not available');
  return ctx.mail;
}

export function registerMailRoutes(app: Hono, ctx: AppContext): void {
  const requireOwnerSession = (c: Context): void => {
    const owner =
      pairedDeviceIdOf(c) === null &&
      (ctx.authToken === null || c.get('ownerIdentity') !== undefined);
    if (!owner) throw new HttpError(403, 'owner session required');
  };
  const secrets = { db: ctx.db, box: ctx.secretBox };

  app.get('/api/teams/:id/mail/accounts', (c) => {
    requireTeam(ctx, c.req.param('id'));
    c.header('Cache-Control', 'no-store');
    return c.json({
      accounts: listMailAccounts(ctx.db, ctx.team.id, (accountId) =>
        ctx.mail ? ctx.mail.retryState(accountId) : { nextRetryAt: null, retryAttempt: 0 },
      ),
    });
  });

  app.post('/api/teams/:id/mail/accounts/:accountId/retry', (c) => {
    requireTeam(ctx, c.req.param('id'));
    requireOwnerSession(c);
    requireMail(ctx).retryNow(ctx.team.id, c.req.param('accountId'));
    return c.json({ ok: true });
  });

  app.post('/api/teams/:id/mail/accounts', async (c) => {
    requireTeam(ctx, c.req.param('id'));
    requireOwnerSession(c);
    const mail = requireMail(ctx);
    const body = parseWith(mailAccountCreateBodySchema, await jsonBody(c), 'body');
    const account = createMailAccount(secrets, {
      teamId: ctx.team.id,
      userId: ctx.user.id,
      body,
    });
    mail.connect(account.id);
    return c.json({ account }, 201);
  });

  app.patch('/api/teams/:id/mail/accounts/:accountId', async (c) => {
    requireTeam(ctx, c.req.param('id'));
    requireOwnerSession(c);
    const accountId = c.req.param('accountId');
    const body = parseWith(mailAccountPatchBodySchema, await jsonBody(c), 'body');
    const { account, reconnect } = updateMailAccount(secrets, ctx.team.id, accountId, body);
    if (reconnect) {
      await requireMail(ctx).reconnect(accountId);
    }
    return c.json({ account });
  });

  app.delete('/api/teams/:id/mail/accounts/:accountId', async (c) => {
    requireTeam(ctx, c.req.param('id'));
    requireOwnerSession(c);
    await requireMail(ctx).disconnect(ctx.team.id, c.req.param('accountId'));
    return c.json({ ok: true });
  });

  app.post('/api/teams/:id/mail/accounts/:accountId/rules', async (c) => {
    requireTeam(ctx, c.req.param('id'));
    requireOwnerSession(c);
    const body = parseWith(mailRuleCreateBodySchema, await jsonBody(c), 'body');
    return c.json({ account: addMailRule(ctx.db, ctx.team.id, c.req.param('accountId'), body) });
  });

  app.delete('/api/teams/:id/mail/accounts/:accountId/rules/:ruleId', (c) => {
    requireTeam(ctx, c.req.param('id'));
    requireOwnerSession(c);
    requireMailAccount(ctx.db, ctx.team.id, c.req.param('accountId'));
    return c.json({
      account: removeMailRule(ctx.db, ctx.team.id, c.req.param('accountId'), c.req.param('ruleId')),
    });
  });
}
