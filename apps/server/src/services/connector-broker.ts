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
  type UserRecord,
} from '@cairn/shared';
import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { actionJournal, mcpConnector } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { proposalCardId } from './action-proposals.js';
import { executeAction } from './action-registry.js';
import { announceQuestion } from './chief-questions.js';
import type { ConversationStreamHub, TeamStreamHub } from './events.js';
import {
  callConnectorTool,
  connectorEndpointBySlug,
  type McpConnectorDeps,
} from './mcp-servers.js';
import type { VapidKeys } from './push.js';

export interface ConnectorBrokerDeps {
  db: Db;
  mcp: McpConnectorDeps;
  hub?: TeamStreamHub;
  convHub?: ConversationStreamHub;
  user?: UserRecord;
  vapidKeys?: VapidKeys | null;
  reposDir: string;
}

export interface ConnectorCallContext {
  teamId: string;
  threadId: string;
  scopeProjectId: string | null;
  untrustedTurn?: boolean;
}

type ConnectorRow = typeof mcpConnector.$inferSelect;

function cachedTools(row: ConnectorRow): McpConnectorTool[] {
  const parsed = cachedConnectorToolsSchema.safeParse(row.toolsJson ?? []);
  return parsed.success ? parsed.data : [];
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
      defs.push({
        name,
        label: `${row.label}: ${tool.name}`,
        description: tool.description ?? `${row.label} tool ${tool.name}`,
        ...(tool.inputSchema === undefined ? {} : { parameters: tool.inputSchema }),
      });
    }
  }
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
      if (!(key in record)) return `${path}: missing ${key}`;
    }
    const properties =
      typeof spec.properties === 'object' && spec.properties !== null
        ? (spec.properties as Record<string, unknown>)
        : {};
    for (const [key, item] of Object.entries(record)) {
      const sub = properties[key];
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

export function gateOutboundAction(
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

export async function executeConnectorToolCall(
  deps: ConnectorBrokerDeps,
  ctx: ConnectorCallContext,
  name: string,
  params: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<string> {
  const parsed = parseConnectorToolName(name);
  if (parsed === null) throw new HttpError(400, `unknown connector tool ${name}`);
  const row = deps.db
    .select()
    .from(mcpConnector)
    .where(and(eq(mcpConnector.teamId, ctx.teamId), eq(mcpConnector.slug, parsed.slug)))
    .get();
  const actionId = `connector.${parsed.slug}.${parsed.tool}`;
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
