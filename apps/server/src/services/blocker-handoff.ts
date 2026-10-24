import {
  type BlockerHandoffEntry,
  type BlockerHandoffRecord,
  clipHandoffFiles,
  clipHandoffSummary,
  conversationBranch,
} from '@cairn/shared';
import { and, asc, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { build, message, step, todo } from '../db/schema.js';
import { type FetchLike, githubPull } from '../lib/github.js';
import { readAttachmentMeta } from './attachments.js';
import { extractText } from './chief.js';
import { githubRepoOfProject, projectOfTodo, readBuildChanges } from './git.js';
import { githubTokenOrNull } from './github-connection.js';
import { githubText } from './github-text.js';

const PR_TITLE_PROBE_TIMEOUT_MS = 5_000;

export interface BlockerHandoffDeps {
  db: Db;
  box?: Parameters<typeof githubTokenOrNull>[0]['box'];
  reposDir: string;
  githubFetch?: FetchLike;
  attachmentsDir: string;
}

export async function blockerHandoffForClaim(
  deps: BlockerHandoffDeps,
  stepRow: typeof step.$inferSelect,
  todoRow: typeof todo.$inferSelect,
): Promise<BlockerHandoffRecord | null> {
  if (stepRow.kind !== 'plan' && stepRow.kind !== 'build') return null;
  const snapshot = deps.db
    .select({ blockerHandoff: step.blockerHandoff })
    .from(step)
    .where(and(eq(step.buildId, stepRow.buildId), isNotNull(step.blockerHandoff)))
    .orderBy(asc(step.createdAt), sql`rowid`)
    .get();
  if (snapshot?.blockerHandoff) return snapshot.blockerHandoff;
  const blockerIds = todoRow.blockedBy ?? [];
  if (blockerIds.length === 0) return null;
  const blockerRows = new Map(
    deps.db
      .select()
      .from(todo)
      .where(inArray(todo.id, blockerIds))
      .all()
      .map((row) => [row.id, row] as const),
  );
  const projectRow = projectOfTodo(deps.db, todoRow);
  const repoRef = githubRepoOfProject(projectRow);
  const token = githubTokenOrNull(deps, todoRow.teamId);
  const blockers: BlockerHandoffEntry[] = [];
  for (const blockerId of blockerIds) {
    const blockerRow = blockerRows.get(blockerId);
    if (blockerRow === undefined) continue;
    const buildRow =
      blockerRow.latestBuildId === null
        ? undefined
        : deps.db.select().from(build).where(eq(build.id, blockerRow.latestBuildId)).get();
    if (buildRow === undefined) {
      blockers.push({
        todoId: blockerRow.id,
        title: blockerRow.title,
        phase: blockerRow.phase,
        delivery: null,
        changedFiles: [],
        omittedFiles: 0,
        summary: null,
      });
      continue;
    }
    let delivery: BlockerHandoffEntry['delivery'];
    if (repoRef !== null && buildRow.prNumber !== null) {
      const page = await githubPull(
        deps.githubFetch ?? fetch,
        token,
        repoRef.owner,
        repoRef.repo,
        buildRow.prNumber,
        { timeoutMs: PR_TITLE_PROBE_TIMEOUT_MS },
      );
      delivery = {
        kind: 'pr',
        number: buildRow.prNumber,
        url: buildRow.prUrl,
        title: page?.pull?.title != null ? githubText(page.pull.title) : null,
      };
    } else {
      const head = deps.db
        .select({ checkpointCommit: step.checkpointCommit })
        .from(step)
        .where(and(eq(step.buildId, buildRow.id), isNotNull(step.checkpointCommit)))
        .orderBy(desc(step.createdAt), sql`rowid desc`)
        .get();
      delivery = {
        kind: 'branch',
        branch: conversationBranch(buildRow.id),
        head: head?.checkpointCommit ?? null,
      };
    }
    const changes = await readBuildChanges(deps, buildRow.id).catch(() => ({ files: [] }));
    const report =
      blockerRow.output === 'info' && buildRow.reportAttachmentId !== null
        ? (() => {
            try {
              const attachment = readAttachmentMeta(
                { db: deps.db, attachmentsDir: deps.attachmentsDir },
                todoRow.teamId,
                buildRow.reportAttachmentId,
              );
              return { attachmentId: attachment.id, content: attachment.content };
            } catch {
              return undefined;
            }
          })()
        : undefined;
    const assistantRows = deps.db
      .select({ content: message.content })
      .from(message)
      .where(and(eq(message.conversationId, buildRow.id), eq(message.role, 'assistant')))
      .orderBy(desc(message.createdAt), sql`rowid desc`)
      .all();
    const lastText = assistantRows
      .map((row) => extractText(row.content)?.trim() ?? '')
      .find((text) => text !== '');
    blockers.push({
      todoId: blockerRow.id,
      title: blockerRow.title,
      phase: blockerRow.phase,
      delivery,
      ...clipHandoffFiles(changes.files.map((file) => file.path)),
      summary: lastText === undefined ? null : clipHandoffSummary(lastText),
      ...(report !== undefined ? { report } : {}),
    });
  }
  return blockers.length === 0 ? null : { blockers };
}
