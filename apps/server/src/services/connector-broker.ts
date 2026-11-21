import { createHash } from 'node:crypto';
import {
  type ActionEntry,
  CONNECTOR_TOOL_NAME_MAX,
  cachedConnectorToolsSchema,
  connectorActionEntry,
  connectorToolName,
  type McpConnectorTool,
  parseConnectorToolName,
  type RemoteToolDef,
  sanitizeToolParameters,
  type UserRecord,
} from '@cairn/shared';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { actionJournal, mailAccount, mailEvent, mcpConnector } from '../db/schema.js';
import { HttpError, parseWith } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { proposalCardId } from './action-proposals.js';
import { executeAction } from './action-registry.js';
import { announceQuestion } from './chief-questions.js';
import type { ConversationStreamHub, TeamStreamHub } from './events.js';
import { type SendMail, sendSmtpMail } from './mail-smtp.js';
import {
  callConnectorTool,
  connectorEndpointBySlug,
  type McpConnectorDeps,
} from './mcp-servers.js';
import type { VapidKeys } from './push.js';
import { openMailPassword } from './secrets.js';

export interface ConnectorBrokerDeps {
  db: Db;
  mcp: McpConnectorDeps;
  hub?: TeamStreamHub;
  convHub?: ConversationStreamHub;
  user?: UserRecord;
  vapidKeys?: VapidKeys | null;
  reposDir: string;
  sendMail?: SendMail;
}

export interface ConnectorCallContext {
  teamId: string;
  threadId: string;
  scopeProjectId: string | null;
  untrustedTurn?: boolean;
  mcpGrant: readonly string[] | null;
}

type ConnectorRow = typeof mcpConnector.$inferSelect;

function cachedTools(row: ConnectorRow): McpConnectorTool[] {
  const parsed = cachedConnectorToolsSchema.safeParse(row.toolsJson ?? []);
  return parsed.success ? parsed.data : [];
}

export const MAIL_CONNECTOR_SLUG = 'cairn-mail';
const MAIL_SEND_TOOL = 'send';

const mailSendArgsSchema = z
  .object({
    to: z.string().email().max(254),
    subject: z
      .string()
      .min(1)
      .max(300)
      .regex(/^[^\r\n]+$/, 'subject must be one line'),
    body: z.string().min(1).max(20_000),
    inReplyTo: z.string().min(1).max(64).optional(),
    from: z.string().optional(),
  })
  .strict();

const MAIL_SEND_DEF: RemoteToolDef = {
  name: connectorToolName(MAIL_CONNECTOR_SLUG, MAIL_SEND_TOOL),
  label: '邮件: send',
  description:
    "Send a plain-text email from the owner's connected mailbox. The owner approves every send on a card that shows the recipient, subject and body; nothing leaves before that. Set inReplyTo to the mail event id when answering a received mail.",
  parameters: {
    type: 'object',
    required: ['to', 'subject', 'body'],
    properties: {
      to: { type: 'string', description: 'One recipient email address.' },
      subject: { type: 'string' },
      body: { type: 'string' },
      inReplyTo: { type: 'string', description: 'Mail event id this message answers.' },
    },
  },
};

function liveMailAccounts(db: Db, teamId: string) {
  return db
    .select()
    .from(mailAccount)
    .where(
      and(
        eq(mailAccount.teamId, teamId),
        eq(mailAccount.provider, 'imap'),
        inArray(mailAccount.status, ['watching', 'degraded']),
      ),
    )
    .orderBy(asc(mailAccount.createdAt), asc(mailAccount.id))
    .all();
}

export function connectorToolDefsForTeam(db: Db, teamId: string): RemoteToolDef[] {
  const rows = db
    .select()
    .from(mcpConnector)
    .where(and(eq(mcpConnector.teamId, teamId), eq(mcpConnector.status, 'connected')))
    .orderBy(asc(mcpConnector.slug))
    .all();
  const defs: RemoteToolDef[] = [];
  for (const row of rows) {
    for (const tool of cachedTools(row)) {
      const name = connectorToolName(row.slug, tool.name);
      if (name.length > CONNECTOR_TOOL_NAME_MAX) continue;
      const parameters = sanitizeToolParameters(tool.inputSchema);
      defs.push({
        name,
        label: `${row.label}: ${tool.name}`,
        description: tool.description ?? `${row.label} tool ${tool.name}`,
        ...(parameters === undefined ? {} : { parameters }),
      });
    }
  }
  if (liveMailAccounts(db, teamId).length > 0) defs.push(MAIL_SEND_DEF);
  return defs;
}

function inputHash(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function journalRow(
  deps: ConnectorBrokerDeps,
  ctx: ConnectorCallContext,
  actionId: string,
  targetId: string,
  input: unknown,
  kind: 'run' | 'error',
): void {
  deps.db
    .insert(actionJournal)
    .values({
      id: newRecordId(),
      teamId: ctx.teamId,
      actionId,
      targetId,
      actor: 'coordinator',
      surface: 'coordinator',
      kind,
      inputHash: inputHash(input),
      createdAt: nowMs(),
    })
    .run();
}

const JSON_SCHEMA_TYPES = ['string', 'number', 'integer', 'boolean', 'object', 'array', 'null'];

function valueMatchesType(value: unknown, type: string): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number';
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    case 'array':
      return Array.isArray(value);
    case 'null':
      return value === null;
    default:
      return true;
  }
}

function validateAgainstSchema(schema: unknown, value: unknown, path: string): string | null {
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) return null;
  const spec = schema as Record<string, unknown>;
  const types = spec.type;
  if (typeof types === 'string' && JSON_SCHEMA_TYPES.includes(types)) {
    if (!valueMatchesType(value, types)) return `${path}: expected ${types}`;
  } else if (Array.isArray(types)) {
    const list = types.filter((t): t is string => typeof t === 'string');
    if (list.length > 0 && !list.some((t) => valueMatchesType(value, t)))
      return `${path}: expected ${list.join('|')}`;
  }
  if (Array.isArray(spec.enum) && !spec.enum.some((item) => item === value))
    return `${path}: not an allowed value`;
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const required = Array.isArray(spec.required)
      ? spec.required.filter((k): k is string => typeof k === 'string')
      : [];
    for (const key of required) {
      if (!Object.hasOwn(record, key)) return `${path}: missing ${key}`;
    }
    const properties =
      typeof spec.properties === 'object' && spec.properties !== null
        ? (spec.properties as Record<string, unknown>)
        : {};
    for (const [key, item] of Object.entries(record)) {
      const sub = Object.hasOwn(properties, key) ? properties[key] : undefined;
      if (sub === undefined) {
        if (spec.additionalProperties === false) return `${path}: unexpected ${key}`;
        continue;
      }
      const failure = validateAgainstSchema(sub, item, `${path}.${key}`);
      if (failure !== null) return failure;
    }
  }
  if (Array.isArray(value) && spec.items !== undefined) {
    for (const [index, item] of value.entries()) {
      const failure = validateAgainstSchema(spec.items, item, `${path}[${index}]`);
      if (failure !== null) return failure;
    }
  }
  return null;
}

function gateOutboundAction(
  deps: Pick<ConnectorBrokerDeps, 'db' | 'reposDir' | 'hub' | 'convHub' | 'user' | 'vapidKeys'>,
  ctx: ConnectorCallContext,
  entry: ActionEntry,
  params: Record<string, unknown>,
): string | null {
  const result = executeAction(
    { db: deps.db, reposDir: deps.reposDir },
    {
      id: entry.id,
      input: params,
      actor: 'coordinator',
      surface: 'coordinator',
      teamId: ctx.teamId,
      threadId: ctx.threadId,
      scopeProjectId: ctx.scopeProjectId,
      ...(ctx.untrustedTurn === true ? { untrustedTurn: true } : {}),
      registry: [entry],
    },
  );
  if (result.status !== 'pending') return null;
  if (result.created)
    announceQuestion(
      {
        db: deps.db,
        ...(deps.hub !== undefined ? { hub: deps.hub } : {}),
        ...(deps.convHub !== undefined ? { convHub: deps.convHub } : {}),
        ...(deps.user !== undefined ? { user: deps.user } : {}),
        vapidKeys: deps.vapidKeys,
      },
      ctx.threadId,
      proposalCardId(result.proposalId),
    );
  return JSON.stringify({
    ...result,
    note: '没有发出任何内容。审批卡已发给用户，卡上是这次要发出的全部内容和对象；用户点发送后你会被唤醒，再用完全相同的参数重新调用才会发出，改动任何参数都要重新审批。告诉用户在等批准，然后结束本轮。',
  });
}

async function executeMailSend(
  deps: ConnectorBrokerDeps,
  ctx: ConnectorCallContext,
  params: Record<string, unknown>,
): Promise<string> {
  const entry = connectorActionEntry(MAIL_CONNECTOR_SLUG, MAIL_SEND_TOOL, undefined);
  const args = parseWith(mailSendArgsSchema, params, 'args');
  const accounts = liveMailAccounts(deps.db, ctx.teamId);
  const replied =
    args.inReplyTo === undefined
      ? undefined
      : deps.db.select().from(mailEvent).where(eq(mailEvent.id, args.inReplyTo)).get();
  const account =
    accounts.find((row) => row.id === replied?.accountId) ?? (replied ? undefined : accounts[0]);
  if (account === undefined) throw new HttpError(409, 'no connected mailbox can send this');
  if (args.from !== undefined && args.from !== account.address)
    throw new HttpError(409, 'from must be the connected mailbox that sends this');
  const gated = { ...args, from: account.address };
  const parked = gateOutboundAction(deps, ctx, entry, gated);
  if (parked !== null) return parked;
  const password =
    account.secretId === null
      ? null
      : openMailPassword({ db: deps.db, box: deps.mcp.box }, ctx.teamId, account.secretId);
  if (password === null || account.address === null || account.smtpHost === null) {
    journalRow(deps, ctx, entry.id, MAIL_CONNECTOR_SLUG, args, 'error');
    throw new HttpError(409, 'the mailbox has no usable credentials');
  }
  try {
    await (deps.sendMail ?? sendSmtpMail)(
      {
        host: account.smtpHost,
        port: account.smtpPort ?? 465,
        user: account.address,
        password,
      },
      {
        from: account.address,
        to: args.to,
        subject: args.subject,
        text: args.body,
        inReplyTo: /^<[^\s<>]+>$/.test(replied?.messageId ?? '')
          ? (replied?.messageId ?? null)
          : null,
      },
    );
  } catch {
    journalRow(deps, ctx, entry.id, MAIL_CONNECTOR_SLUG, args, 'error');
    throw new HttpError(502, 'the mail server refused or could not send this message');
  }
  journalRow(deps, ctx, entry.id, MAIL_CONNECTOR_SLUG, args, 'run');
  return JSON.stringify({ sent: true, to: args.to, subject: args.subject });
}

export async function executeConnectorToolCall(
  deps: ConnectorBrokerDeps,
  ctx: ConnectorCallContext,
  name: string,
  params: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<string> {
  const parsed = parseConnectorToolName(name);
  if (parsed === null) throw new HttpError(400, `unknown connector tool ${name}`);
  if (parsed.slug === MAIL_CONNECTOR_SLUG) {
    if (parsed.tool !== MAIL_SEND_TOOL) throw new HttpError(400, `unknown connector tool ${name}`);
    return executeMailSend(deps, ctx, params);
  }
  const actionId = `connector.${parsed.slug}.${parsed.tool}`;
  if (!(ctx.mcpGrant ?? []).includes(parsed.slug)) {
    journalRow(deps, ctx, actionId, parsed.slug, params, 'error');
    throw new HttpError(403, `connector ${parsed.slug} is outside the step's grant`);
  }
  const row = deps.db
    .select()
    .from(mcpConnector)
    .where(and(eq(mcpConnector.teamId, ctx.teamId), eq(mcpConnector.slug, parsed.slug)))
    .get();
  if (row === undefined) {
    journalRow(deps, ctx, actionId, parsed.slug, params, 'error');
    throw new HttpError(400, `unknown connector ${parsed.slug}`);
  }
  if (row.status !== 'connected') {
    journalRow(deps, ctx, actionId, parsed.slug, params, 'error');
    throw new HttpError(409, `connector ${parsed.slug} is ${row.status}`);
  }
  const tool = cachedTools(row).find((item) => item.name === parsed.tool);
  if (tool === undefined) {
    journalRow(deps, ctx, actionId, parsed.slug, params, 'error');
    throw new HttpError(400, `connector ${parsed.slug} has no tool ${parsed.tool}`);
  }
  const failure = validateAgainstSchema(tool.inputSchema ?? { type: 'object' }, params, 'args');
  if (failure !== null) {
    journalRow(deps, ctx, actionId, parsed.slug, params, 'error');
    throw new HttpError(400, `invalid args for ${parsed.tool}: ${failure}`);
  }
  const dispatch = async (): Promise<string> => {
    const endpoint = await connectorEndpointBySlug(deps.mcp, ctx.teamId, parsed.slug);
    if (endpoint === null) throw new HttpError(409, `connector ${parsed.slug} is not deliverable`);
    return callConnectorTool(deps.mcp, endpoint, tool.name, params, signal);
  };
  const entry = connectorActionEntry(parsed.slug, tool.name, tool.annotations);
  if (entry.class === 'free') {
    journalRow(deps, ctx, entry.id, parsed.slug, params, 'run');
    try {
      return await dispatch();
    } catch (err) {
      journalRow(deps, ctx, entry.id, parsed.slug, params, 'error');
      throw err;
    }
  }
  const parked = gateOutboundAction(deps, ctx, entry, params);
  if (parked !== null) return parked;
  try {
    return await dispatch();
  } catch (err) {
    journalRow(deps, ctx, entry.id, parsed.slug, params, 'error');
    throw err;
  }
}
