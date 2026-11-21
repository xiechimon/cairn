import {
  memoryEditBodySchema,
  memoryEditStopBodySchema,
  memoryImportBodySchema,
  patchMemoryBodySchema,
} from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import type { AppContext } from './context.js';
import { agentMemory } from './db/schema.js';
import { HttpError, notFound, parseWith } from './lib/errors.js';
import { jsonBody, requireTeam, svcOf, toMemoryRecord } from './routes-helpers.js';
import {
  deleteMemoryEntry,
  isMemoryIndex,
  listMemoryEntries,
  memoryDocumentVersion,
  updateMemoryEntry,
} from './services/memory.js';
import { executeMemoryDocumentTool } from './services/memory-documents.js';
import {
  currentMemoryEdit,
  stopMemoryEdit,
  submitMemoryEdit,
  toMemoryEditRecord,
} from './services/memory-edit.js';
import {
  importMemoryFile,
  listMemoryImportCandidates,
  repoReaderOf,
} from './services/memory-import.js';

export function registerMemoryRoutes(app: Hono, ctx: AppContext): void {
  app.get('/api/teams/:id/memories', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const rows = listMemoryEntries(
      ctx.db,
      { agentId: teamId, teamId },
      c.req.query('includeInvalid') === 'true',
    );
    return c.json(rows.map(toMemoryRecord));
  });

  app.post('/api/teams/:id/memory-edits', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const body = parseWith(memoryEditBodySchema, await jsonBody(c), 'body');
    return c.json(submitMemoryEdit(svcOf(ctx), teamId, body), 201);
  });

  app.get('/api/teams/:id/memory-edits/current', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const row = currentMemoryEdit(ctx.db, teamId);
    return c.json(row === undefined ? null : toMemoryEditRecord(ctx.db, row));
  });

  app.post('/api/teams/:id/memory-edits/:eid/stop', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const body = parseWith(memoryEditStopBodySchema, await jsonBody(c), 'body');
    return c.json(stopMemoryEdit(svcOf(ctx), teamId, c.req.param('eid'), body.attempt));
  });

  app.get('/api/teams/:id/memory-imports/candidates', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    return c.json({
      candidates: await listMemoryImportCandidates(
        ctx.db,
        teamId,
        repoReaderOf({ ...ctx, box: ctx.secretBox }),
      ),
    });
  });

  app.post('/api/teams/:id/memory-imports', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const body = parseWith(memoryImportBodySchema, await jsonBody(c), 'body');
    return c.json(
      {
        result: await importMemoryFile(
          ctx.db,
          teamId,
          body,
          repoReaderOf({ ...ctx, box: ctx.secretBox }),
        ),
      },
      201,
    );
  });

  app.patch('/api/teams/:id/memories/:mid', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const body = parseWith(patchMemoryBodySchema, await jsonBody(c), 'body');
    const mid = c.req.param('mid');
    const row = ctx.db
      .select()
      .from(agentMemory)
      .where(and(eq(agentMemory.id, mid), eq(agentMemory.teamId, teamId)))
      .get();
    const document =
      row !== undefined &&
      row.invalidAt === null &&
      row.supersededBy === null &&
      (row.layer === 'searchable' || isMemoryIndex(ctx.db, mid));
    if (document && row !== undefined) {
      const updated = executeMemoryDocumentTool(
        ctx.db,
        { agentId: teamId, teamId, projectId: null },
        'update_memory',
        {
          scope: row.projectId ?? 'team',
          file: row.title,
          baseVersion: memoryDocumentVersion(row),
          ...(body.content !== undefined ? { content: body.content } : {}),
          ...(body.title !== undefined ? { renameTo: body.title } : {}),
        },
      ) as { id: string };
      const successor = ctx.db
        .select()
        .from(agentMemory)
        .where(eq(agentMemory.id, updated.id))
        .get();
      if (!successor) throw new HttpError(500, `memory ${mid}`);
      return c.json(toMemoryRecord(successor));
    }
    if (row !== undefined && body.title !== undefined)
      throw new HttpError(400, 'memory file name cannot be changed here');
    const updated = updateMemoryEntry(ctx.db, {
      memoryId: mid,
      agentId: teamId,
      teamId,
      content: body.content ?? '',
    });
    return c.json(toMemoryRecord(updated));
  });

  app.delete('/api/teams/:id/memories/:mid', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const removed = deleteMemoryEntry(ctx.db, {
      memoryId: c.req.param('mid'),
      agentId: teamId,
      teamId,
    });
    if (removed === 0) throw notFound(`memory ${c.req.param('mid')}`);
    return c.body(null, 204);
  });
}
