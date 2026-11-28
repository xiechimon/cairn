import { workspaceFilePathSchema } from '@cairn/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { Hono } from 'hono';
import { z } from 'zod';
import type { AppContext } from './context.js';
import { chiefMessage, machine, message } from './db/schema.js';
import { parseWith } from './lib/errors.js';
import { pairedDeviceIdOf } from './lib/token-auth.js';
import { jsonBody } from './routes-helpers.js';
import { eligibleFileSource, sameFileSource } from './services/file-source.js';
import { isChiefConversation } from './services/machine-deps.js';
import { messageFileReferences } from './services/message-file-references.js';
import { pairedDeviceExists } from './services/paired-devices.js';
import { requireTeamConversation } from './services/tool-guards.js';
import { requestWorkspaceFile } from './services/workspace-file-read.js';

const requestSchema = z.strictObject({ path: workspaceFilePathSchema });

export function registerMessageFileRoutes(app: Hono, ctx: AppContext): void {
  app.post('/api/conversations/:id/messages/:messageId/file', async (c) => {
    c.header('Cache-Control', 'no-store');
    const conversationId = c.req.param('id');
    const messageId = c.req.param('messageId');
    const { path } = parseWith(requestSchema, await jsonBody(c), 'body');
    const teamId = ctx.team.id;
    const findSource = () => {
      requireTeamConversation(ctx.db, conversationId, teamId);
      const row = isChiefConversation(conversationId)
        ? ctx.db
            .select()
            .from(chiefMessage)
            .where(and(eq(chiefMessage.threadId, conversationId), eq(chiefMessage.id, messageId)))
            .get()
        : ctx.db
            .select()
            .from(message)
            .where(and(eq(message.conversationId, conversationId), eq(message.id, messageId)))
            .get();
      if (row?.role !== 'assistant' || !eligibleFileSource(row.fileSource)) return undefined;
      return messageFileReferences(row.content).includes(path) ? row.fileSource : undefined;
    };
    const source = findSource();
    if (!source) return c.json({ status: 'unavailable' }, 404);
    const runner = ctx.db
      .select({ capabilities: machine.capabilities })
      .from(machine)
      .where(
        and(
          eq(machine.id, source.machineId),
          eq(machine.teamId, teamId),
          isNull(machine.retiredAt),
        ),
      )
      .get();
    if (!runner || !ctx.machineHub.isConnected(source.machineId))
      return c.json({ status: 'offline' }, 503);
    if (runner.capabilities?.workspaceFileRead !== true)
      return c.json({ status: 'unavailable' }, 503);
    const result = await requestWorkspaceFile(
      ctx.machineHub,
      { teamId, machineId: source.machineId, workspace: source.workspace },
      path,
      c.req.raw.signal,
    );
    if (result.status === 'ok') {
      const deviceId = pairedDeviceIdOf(c);
      if (
        (deviceId !== null && !pairedDeviceExists(ctx.db, deviceId)) ||
        !sameFileSource(findSource(), source)
      ) {
        return c.json({ status: 'unavailable' }, 404);
      }
      return c.json(result);
    }
    return c.json(
      result,
      result.status === 'gone' ? 404 : result.status === 'unsupported' ? 415 : 503,
    );
  });
}
