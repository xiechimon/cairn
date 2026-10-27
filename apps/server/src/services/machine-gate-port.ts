import {
  buildReviewStepPrompt,
  parseGithubIssueSourceRef,
  parseReviewPromptMeta,
  reviewVerdictSchema,
  verifyVerdictSchema,
} from '@cairn/shared';
import { and, desc, eq, isNull } from 'drizzle-orm';
import {
  agent,
  build,
  chief,
  gateDigest,
  gateRound,
  gateState,
  gateVerdict,
  message,
  plan,
  step,
  todo,
} from '../db/schema.js';
import { githubCreateIssue } from '../lib/github.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { type BuildDeps, enqueueStep } from './builds.js';
import { githubRepoOfProject, projectOfTodo } from './git.js';
import { teamGithubToken } from './github-connection.js';
import { appendGateRun, readGateRuns, readGateSession } from './machine-gate-storage.js';
import type { GateAuditIssuePort } from './merge-gate/audit.js';
import { evaluateMergeGate, readMergeGateState } from './merge-gate/run.js';
import type { GateRuntimePort } from './merge-gate/runtime-port.js';
import { githubGatePort } from './merge-gate-github.js';
import { projectMergeConfigOf } from './projects.js';

export function machineGatePort(deps: BuildDeps): GateRuntimePort {
  const db = deps.db;
  return {
    readBuild: (id) => db.select().from(build).where(eq(build.id, id)).get(),
    readTodo: (id) => db.select().from(todo).where(eq(todo.id, id)).get(),
    readProject: (row) => projectOfTodo(db, row),
    projectRepo: githubRepoOfProject,
    projectPolicy: (row) => projectMergeConfigOf(row).mergePolicy,
    readPlanContent: (id) =>
      db
        .select({ content: plan.content })
        .from(plan)
        .where(eq(plan.buildId, id))
        .orderBy(desc(plan.version))
        .get()?.content ?? null,
    readSteps: (id) => db.select().from(step).where(eq(step.buildId, id)).all(),
    readAgents: (id) => db.select().from(agent).where(eq(agent.teamId, id)).all(),
    readVerdicts: (id) => db.select().from(gateVerdict).where(eq(gateVerdict.buildId, id)).all(),
    readMessages: (id) =>
      db
        .select()
        .from(message)
        .where(and(eq(message.conversationId, id), eq(message.role, 'system')))
        .all(),
    readChief: (id) => db.select().from(chief).where(eq(chief.teamId, id)).get(),
    readState: (id) => db.select().from(gateState).where(eq(gateState.buildId, id)).get(),
    bindVerdictDigest: (id, digest) => {
      db.update(gateVerdict)
        .set({ patchDigest: digest })
        .where(and(eq(gateVerdict.stepId, id), isNull(gateVerdict.patchDigest)))
        .run();
    },
    insertDigest: (row) => {
      db.insert(gateDigest).values(row).onConflictDoNothing().run();
    },
    readRounds: (id) => db.select().from(gateRound).where(eq(gateRound.buildId, id)).all(),
    insertRound: (row) => {
      db.insert(gateRound).values(row).run();
    },
    updateRound: (id, values) => {
      db.update(gateRound).set(values).where(eq(gateRound.id, id)).run();
    },
    saveState: (row) => {
      db.insert(gateState)
        .values(row)
        .onConflictDoUpdate({
          target: gateState.buildId,
          set: row,
        })
        .run();
    },
    githubPort: async (teamId, repo) => {
      const access = await teamGithubToken(deps, teamId);
      return 'token' in access
        ? githubGatePort(deps.githubFetch ?? fetch, access.token, repo.owner, repo.repo, 10_000)
        : null;
    },
    auditPort: async (teamId, repo): Promise<GateAuditIssuePort | null> => {
      const access = await teamGithubToken(deps, teamId);
      if (!('token' in access)) return null;
      const fetchImpl = deps.githubFetch ?? fetch;
      return {
        readIssuePage: async (page) => {
          const response = await fetchImpl(
            `https://api.github.com/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/issues?state=all&page=${page}&per_page=100`,
            {
              headers: {
                Authorization: `Bearer ${access.token}`,
                Accept: 'application/vnd.github+json',
              },
              signal: AbortSignal.timeout(10_000),
            },
          );
          if (!response.ok)
            throw new Error(`Gate audit issue read failed: HTTP ${response.status}`);
          const value: unknown = await response.json();
          if (!Array.isArray(value)) throw new Error('Gate audit issue response is not an array');
          const issues = value.flatMap((item: unknown) => {
            if (item === null || typeof item !== 'object') return [];
            const raw = item as { number?: unknown; body?: unknown; pull_request?: unknown };
            return raw.pull_request === undefined && typeof raw.number === 'number'
              ? [{ number: raw.number, body: typeof raw.body === 'string' ? raw.body : '' }]
              : [];
          });
          return { issues, hasMore: (response.headers.get('link') ?? '').includes('rel="next"') };
        },
        createIssue: async (input) => {
          const created = await githubCreateIssue(fetchImpl, access.token, repo.owner, repo.repo, {
            ...input,
            labels: ['gate-mismatch'],
          });
          return created.number;
        },
      };
    },
    parseIssueRef: parseGithubIssueSourceRef,
    parseReviewMeta: parseReviewPromptMeta,
    parseReviewVerdict: (value) => {
      const result = reviewVerdictSchema.safeParse(value);
      return result.success ? result.data : null;
    },
    parseVerifyVerdict: (value) => {
      const result = verifyVerdictSchema.safeParse(value);
      return result.success ? result.data : null;
    },
    reviewPrompt: buildReviewStepPrompt,
    enqueueReview: (buildId, teamId, prompt) => {
      enqueueStep(deps, buildId, 'review', teamId, prompt);
    },
    now: nowMs,
    newId: newRecordId,
    hasAuditStorage: deps.attachmentsDir !== undefined,
    readSession: (id) =>
      deps.attachmentsDir === undefined ? null : readGateSession(deps.attachmentsDir, id),
    readRuns: (id) =>
      deps.attachmentsDir === undefined ? [] : readGateRuns(deps.attachmentsDir, id),
    appendRun: (run) => {
      if (deps.attachmentsDir !== undefined) appendGateRun(deps.attachmentsDir, run);
    },
  };
}

export function evaluateProductGate(
  deps: BuildDeps,
  buildId: string,
  opts: Parameters<typeof evaluateMergeGate>[2] = {},
) {
  return evaluateMergeGate(machineGatePort(deps), buildId, opts);
}

export function readProductGateState(deps: BuildDeps, buildId: string) {
  return readMergeGateState(machineGatePort(deps), buildId);
}
