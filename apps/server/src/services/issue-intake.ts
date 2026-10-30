import {
  githubIssueSourceRef,
  orchestrateThreadTitle,
  type Phase,
  parseGithubIssueSourceRef,
  type SecretBox,
} from '@cairn/shared';
import {
  and,
  asc,
  eq,
  exists,
  gte,
  isNotNull,
  like,
  notExists,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type { Db } from '../db/client.js';
import { build, chiefThread, project, step, todo } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import {
  type FetchLike,
  type GithubConditionalRead,
  type GithubIssueEvent,
  type GithubIssueEventsPage,
  type GithubLabeledIssuesPage,
  GithubRateLimitedError,
  type GithubRepoPermission,
  githubCloseIssue,
  githubCollaboratorPermission,
  githubIssueClosingPulls,
  githubIssueEvents,
  githubIssueState,
  githubIssueTimeline,
  githubOpenIssuesWithLabel,
} from '../lib/github.js';
import { nowMs } from '../lib/ids.js';
import {
  type AutonomyGateResult,
  autonomySettingsOf,
  autonomyStateOf,
  evaluateAutonomyGates,
  evaluateRequestedRun,
  lastMemberWriteAt,
  recordAutonomyStart,
  recordAutonomyVerdict,
  spentForGate,
} from './autonomy-gates.js';
import type { BuildDeps } from './builds.js';
import { chiefBinding } from './chief.js';
import { type TransitionActor, transitionTodos } from './chief-tools.js';
import { githubRepoOfProject } from './git.js';
import { teamGithubToken } from './github-connection.js';
import { importGithubIssue, importsInFlightFor } from './github-issues.js';
import { orchestrateTodo } from './orchestrate.js';

export const ISSUE_INTAKE_INTERVAL_MS = 300_000;

export const ISSUE_INTAKE_LABEL = 'ready-for-agent';

export const ISSUE_INTAKE_OWN_LANE_LABEL = 'by:cairn';

export const ISSUE_INTAKE_HOLD_LABELS: readonly string[] = [
  'waits-ian',
  'needs-triage',
  'ready-for-human',
  'needs-decision',
];

export const ISSUE_INTAKE_TRUSTED_LABEL_APPS: readonly string[] = ['claude'];

export const ISSUE_INTAKE_IN_FLIGHT_CAP = 3;

export const ISSUE_INTAKE_MAX_LIST_PAGES = 3;

export const ISSUE_INTAKE_MAX_EVENT_PAGES = 5;

export const ISSUE_INTAKE_PERMISSION_TTL_MS = 15 * 60_000;

export const ISSUE_INTAKE_MAX_ORCHESTRATE_ATTEMPTS = 3;

const LABELER_ROLES = new Set(['triage', 'write', 'maintain', 'admin']);
const LABELER_BASE_PERMISSIONS = new Set(['write', 'admin']);

const NOT_IN_FLIGHT: Phase[] = ['done', 'closed'];

const CLOSE_RECONCILE_SKIPPED: Phase[] = ['done', 'closed', 'review'];

const CHILD_SETTLED: Phase[] = ['done', 'closed'];

const childTodo = alias(todo, 'child_todo');

const ISSUE_INTAKE_ACTOR: TransitionActor = { kind: 'agent', name: 'GitHub issue intake' };

export interface IssueIntakeLogger {
  info(obj: object, msg: string): void;
}

export interface IssueIntakeTally {
  teams: number;
  projects: number;
  skipped: number;
  listNotModified: number;
  listTruncated: number;
  candidates: number;
  claimed: number;
  atCap: number;
  otherLane: number;
  held: number;
  notEligible: number;
  unverifiable: number;
  imported: number;
  orchestrated: number;
  closed: number;
  closeSkipped: number;
  githubIssuesClosed: number;
  rateLimited: number;
  gated: number;
  errors: number;
}

export interface IssueIntake {
  sweep(now?: number): Promise<IssueIntakeTally | null>;
}

type ProjectRow = typeof project.$inferSelect;

interface AppLabel {
  reason: 'label-via-app';
  labeler: string | null;
  viaApp: string;
}

type Verdict =
  | { labeler: string }
  | ({ notTaken: 'not-eligible' } & AppLabel)
  | { notTaken: 'not-eligible' | 'unverifiable'; reason: string };

interface ReconcileRow {
  id: string;
  phase: Phase;
  sourceRef: string;
}

interface IssueTaskRow extends ReconcileRow {
  createdBy: string | null;
}

interface TeamAccess {
  token: string;
  box: SecretBox;
  createdBy: string;
}

interface OrchestrateAttempt {
  teamId: string;
  importedAt: number;
  attempts: number;
}

function emptyTally(): IssueIntakeTally {
  return {
    teams: 0,
    projects: 0,
    skipped: 0,
    otherLane: 0,
    held: 0,
    listNotModified: 0,
    listTruncated: 0,
    candidates: 0,
    claimed: 0,
    atCap: 0,
    notEligible: 0,
    unverifiable: 0,
    imported: 0,
    orchestrated: 0,
    closed: 0,
    closeSkipped: 0,
    githubIssuesClosed: 0,
    rateLimited: 0,
    gated: 0,
    errors: 0,
  };
}

type EtagCache<T> = Map<string, { etag: string | null; data: T }>;

function settle<T>(cache: EtagCache<T>, key: string, page: GithubConditionalRead<T> | null) {
  if (page === null) return null;
  if (page.notModified) return cache.get(key)?.data ?? null;
  cache.set(key, { etag: page.etag, data: page.data });
  return page.data;
}

function etagFor<T extends { full: boolean }>(cache: EtagCache<T>, key: string): string | null {
  const hit = cache.get(key);
  return hit !== undefined && !hit.data.full ? hit.etag : null;
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function later(a: GithubIssueEvent, b: GithubIssueEvent): boolean {
  return a.at > b.at || (a.at === b.at && a.id > b.id);
}

interface IssueHistory {
  events: GithubIssueEvent[];
  complete: boolean;
}

function newestOf(
  events: GithubIssueEvent[],
  match: (e: GithubIssueEvent) => boolean,
): GithubIssueEvent | null {
  let newest: GithubIssueEvent | null = null;
  for (const e of events) if (match(e) && (newest === null || later(e, newest))) newest = e;
  return newest;
}

function newestLabeler(data: IssueHistory): { labeler: string } | AppLabel | { reason: string } {
  if (!data.complete) return { reason: 'events-incomplete' };
  const forLabel = (kind: 'labeled' | 'unlabeled') => (e: GithubIssueEvent) =>
    e.event === kind && e.label?.toLowerCase() === ISSUE_INTAKE_LABEL;
  const labeled = newestOf(data.events, forLabel('labeled'));
  const unlabeled = newestOf(data.events, forLabel('unlabeled'));
  if (labeled === null) return { reason: 'no-labeled-event' };
  if (unlabeled !== null && later(unlabeled, labeled)) return { reason: 'label-removed' };
  if (
    labeled.viaApp !== null &&
    !(
      ISSUE_INTAKE_TRUSTED_LABEL_APPS.includes(labeled.viaApp) &&
      labeled.actor !== null &&
      !labeled.actor.endsWith('[bot]')
    )
  ) {
    return { reason: 'label-via-app', labeler: labeled.actor, viaApp: labeled.viaApp };
  }
  if (labeled.actor === null) return { reason: 'labeler-deleted' };
  return { labeler: labeled.actor };
}

type LinkedPullVerdict =
  | { ok: true }
  | { closeGithub: { pr: number } }
  | { notTaken: 'not-eligible'; reason: 'open-linked-pull' | 'merged-linked-pull'; pr: number }
  | { notTaken: 'unverifiable'; reason: string };

export function projectAtInFlightCap(db: Db, projectId: string): boolean {
  return projectInFlight(db, projectId) >= ISSUE_INTAKE_IN_FLIGHT_CAP;
}

function projectInFlight(db: Db, projectId: string): number {
  const inFlight =
    db
      .select({ n: sql<number>`count(*)` })
      .from(todo)
      .where(
        and(
          eq(todo.projectId, projectId),
          eq(todo.sourceKind, 'github-issue'),
          notInArray(todo.phase, NOT_IN_FLIGHT),
        ),
      )
      .get()?.n ?? 0;
  return inFlight + importsInFlightFor(projectId);
}

const permissionCache = new Map<string, { at: number; permission: GithubRepoPermission }>();

export async function hasRepoTriage(
  githubFetch: FetchLike,
  teamId: string,
  token: string,
  owner: string,
  repo: string,
  login: string,
  now: number,
): Promise<boolean | null> {
  for (const [key, hit] of permissionCache) {
    if (now - hit.at >= ISSUE_INTAKE_PERMISSION_TTL_MS) permissionCache.delete(key);
  }
  const key = `${teamId}\u0000${owner}/${repo}\u0000${login}`.toLowerCase();
  let p: GithubRepoPermission | null = permissionCache.get(key)?.permission ?? null;
  if (p === null) {
    p = await githubCollaboratorPermission(githubFetch, token, owner, repo, login);
    if (p === null) return null;
    permissionCache.set(key, { at: now, permission: p });
  }
  return (
    LABELER_BASE_PERMISSIONS.has(p.permission) ||
    (p.roleName !== null && LABELER_ROLES.has(p.roleName)) ||
    p.triage === true
  );
}

export function createIssueIntake(
  deps: BuildDeps,
  run: { githubFetch: FetchLike; logger?: IssueIntakeLogger },
): IssueIntake {
  const log = (obj: object, msg: string) => run.logger?.info(obj, msg);
  const listCache: EtagCache<GithubLabeledIssuesPage> = new Map();
  const eventsCache: EtagCache<GithubIssueEventsPage> = new Map();
  const stateCache: EtagCache<{ state: 'open' | 'closed' }> = new Map();
  const closerEventsCache: EtagCache<GithubIssueEventsPage> = new Map();
  const seenOpen = new Set<string>();
  const orchestrateRetries = new Map<string, OrchestrateAttempt>();
  let sweeping = false;
  const refKey = (teamId: string, sourceRef: string) => `${teamId}\u0000${sourceRef}`.toLowerCase();

  function noDeliveredPr() {
    return notExists(
      deps.db
        .select({ id: build.id })
        .from(build)
        .where(
          and(eq(build.todoId, todo.id), or(isNotNull(build.prNumber), isNotNull(build.prUrl))),
        ),
    );
  }

  function noOpenChildren() {
    return notExists(
      deps.db
        .select({ id: childTodo.id })
        .from(childTodo)
        .where(and(eq(childTodo.sourceTodo, todo.id), notInArray(childTodo.phase, CHILD_SETTLED))),
    );
  }

  function claimedRefs(teamId: string): Set<string> {
    return new Set(
      deps.db
        .select({ sourceRef: todo.sourceRef })
        .from(todo)
        .where(and(eq(todo.teamId, teamId), like(todo.sourceRef, 'github:%')))
        .all()
        .map((r) => (r.sourceRef ?? '').toLowerCase()),
    );
  }

  async function readHistory(
    cache: EtagCache<GithubIssueEventsPage>,
    issueKey: string,
    token: string,
    ref: { owner: string; repo: string; issueNumber: number },
  ): Promise<IssueHistory | null> {
    const events: GithubIssueEvent[] = [];
    let url: string | null = null;
    for (let pageNo = 1; pageNo <= ISSUE_INTAKE_MAX_EVENT_PAGES; pageNo += 1) {
      const key: string = `${issueKey}\u0001${url ?? 'first'}`;
      const page = await githubIssueEvents(
        run.githubFetch,
        token,
        ref.owner,
        ref.repo,
        ref.issueNumber,
        { url, etag: etagFor(cache, key) },
      );
      const data: GithubIssueEventsPage | null = settle(cache, key, page);
      if (data === null) return null;
      events.push(...data.events);
      if (!data.more) return { events, complete: true };
      if (data.next === null) return { events, complete: false };
      url = data.next;
    }
    return { events, complete: false };
  }

  async function labelerVerdict(
    teamId: string,
    token: string,
    owner: string,
    repo: string,
    issueNumber: number,
    now: number,
  ): Promise<Verdict> {
    const key = `${teamId}\u0000${owner}/${repo}#${issueNumber}`.toLowerCase();
    const history = await readHistory(eventsCache, key, token, { owner, repo, issueNumber });
    if (history === null) return { notTaken: 'unverifiable', reason: 'events-unreadable' };
    const found = newestLabeler(history);
    if ('reason' in found) return { notTaken: 'not-eligible', ...found };
    const trusted = await hasRepoTriage(
      run.githubFetch,
      teamId,
      token,
      owner,
      repo,
      found.labeler,
      now,
    );
    if (trusted === null) return { notTaken: 'unverifiable', reason: 'permission-unreadable' };
    return trusted ? found : { notTaken: 'not-eligible', reason: 'labeler-below-triage' };
  }

  function orchestrateImported(
    todoId: string,
    entry: OrchestrateAttempt,
    tally: IssueIntakeTally,
  ): void {
    try {
      orchestrateTodo(deps, todoId);
      orchestrateRetries.delete(todoId);
      tally.orchestrated += 1;
    } catch (err) {
      tally.errors += 1;
      log(
        { todoId, attempts: entry.attempts, err: errText(err) },
        'issue intake orchestrate failed',
      );
      if (entry.attempts < ISSUE_INTAKE_MAX_ORCHESTRATE_ATTEMPTS) {
        orchestrateRetries.set(todoId, entry);
      } else {
        orchestrateRetries.delete(todoId);
        log({ todoId, attempts: entry.attempts }, 'issue intake orchestrate given up');
      }
    }
  }

  function startedSince(teamId: string, seqNum: number, importedAt: number): boolean {
    const thread = deps.db
      .select({ id: chiefThread.id })
      .from(chiefThread)
      .where(
        and(
          eq(chiefThread.teamId, teamId),
          eq(chiefThread.title, orchestrateThreadTitle(seqNum)),
          gte(chiefThread.createdAt, importedAt),
          exists(
            deps.db
              .select({ id: step.id })
              .from(step)
              .where(and(eq(step.buildId, chiefThread.id), eq(step.kind, 'chief'))),
          ),
        ),
      )
      .get();
    return thread !== undefined;
  }

  function retryOrchestration(
    teamId: string,
    agentId: string,
    now: number,
    tally: IssueIntakeTally,
  ): void {
    for (const [todoId, entry] of orchestrateRetries) {
      if (entry.teamId !== teamId) continue;
      let dropped: 'todo-gone' | 'left-todo' | 'chief-rebound' | 'thread-exists' | null;
      let gate: AutonomyGateResult = { ok: true };
      try {
        const row = deps.db
          .select({
            phase: todo.phase,
            seqNum: todo.seqNum,
            createdBy: todo.createdBy,
            projectId: todo.projectId,
            autonomy: project.autonomy,
          })
          .from(todo)
          .innerJoin(project, eq(project.id, todo.projectId))
          .where(eq(todo.id, todoId))
          .get();
        dropped =
          row === undefined
            ? 'todo-gone'
            : row.phase !== 'todo'
              ? 'left-todo'
              : row.createdBy !== agentId
                ? 'chief-rebound'
                : startedSince(teamId, row.seqNum, entry.importedAt)
                  ? 'thread-exists'
                  : null;
        if (row !== undefined && dropped === null) {
          gate = evaluateRequestedRun(deps.db, { id: row.projectId, autonomy: row.autonomy }, now);
        }
      } catch (err) {
        tally.errors += 1;
        log({ todoId, err: errText(err) }, 'issue intake orchestrate retry failed');
        continue;
      }
      if (dropped !== null) {
        orchestrateRetries.delete(todoId);
        log({ todoId, reason: dropped }, 'issue intake orchestrate retry dropped');
        continue;
      }
      if (!gate.ok) {
        log({ todoId, reason: gate.reason }, 'issue intake orchestrate retry gated');
        continue;
      }
      orchestrateImported(todoId, { ...entry, attempts: entry.attempts + 1 }, tally);
    }
  }

  async function take(
    row: ProjectRow,
    owner: string,
    repo: string,
    access: TeamAccess,
    issueNumber: number,
    now: number,
    tally: IssueIntakeTally,
  ): Promise<'imported' | 'full' | 'not-taken'> {
    const verdict = await labelerVerdict(row.teamId, access.token, owner, repo, issueNumber, now);
    if ('notTaken' in verdict) {
      if (verdict.notTaken === 'unverifiable') tally.unverifiable += 1;
      else tally.notEligible += 1;
      const at = { projectId: row.id, issue: issueNumber, reason: verdict.reason };
      if ('viaApp' in verdict) {
        log(
          { ...at, labeler: verdict.labeler, viaApp: verdict.viaApp },
          `issue intake label applied through app ${verdict.viaApp}, not taken`,
        );
      } else log(at, 'issue intake candidate not taken');
      return 'not-taken';
    }
    if (projectAtInFlightCap(deps.db, row.id)) {
      tally.atCap += 1;
      return 'full';
    }
    let links: LinkedPullVerdict;
    try {
      const timeline = await githubIssueTimeline(
        run.githubFetch,
        access.token,
        owner,
        repo,
        issueNumber,
      );
      const closing = await githubIssueClosingPulls(
        run.githubFetch,
        access.token,
        owner,
        repo,
        issueNumber,
      );
      if (timeline === null) {
        links = { notTaken: 'unverifiable', reason: 'timeline-unreadable' };
      } else if (closing === null) {
        links = { notTaken: 'unverifiable', reason: 'closing-pulls-unreadable' };
      } else if (!timeline.complete) {
        links = { notTaken: 'unverifiable', reason: 'timeline-incomplete' };
      } else if (!closing.complete) {
        links = { notTaken: 'unverifiable', reason: 'closing-pulls-incomplete' };
      } else {
        const sameRepo = `${owner}/${repo}`.toLowerCase();
        const byNumber = new Map<number, { open: boolean; merged: boolean; closed: boolean }>();
        for (const source of [timeline.pulls, closing.pulls]) {
          for (const pull of source) {
            if (pull.repo.toLowerCase() !== sameRepo) continue;
            const cur = byNumber.get(pull.number) ?? {
              open: false,
              merged: false,
              closed: false,
            };
            if (pull.state === 'open') cur.open = true;
            else if (pull.merged) cur.merged = true;
            else cur.closed = true;
            byNumber.set(pull.number, cur);
          }
        }
        links = { ok: true };
        for (const evidence of byNumber.values()) {
          if (evidence.open && (evidence.merged || evidence.closed)) {
            links = { notTaken: 'unverifiable', reason: 'linked-pull-conflict' };
            break;
          }
        }
        if ('ok' in links) {
          for (const [number, evidence] of byNumber) {
            if (evidence.open) {
              links = {
                notTaken: 'not-eligible',
                reason: 'open-linked-pull',
                pr: number,
              };
              break;
            }
          }
        }
        if ('ok' in links && byNumber.size === 1) {
          const closingPull = closing.pulls.find(
            (pull) => pull.repo.toLowerCase() === sameRepo && pull.merged,
          );
          if (closingPull !== undefined && !byNumber.get(closingPull.number)?.closed) {
            links = { closeGithub: { pr: closingPull.number } };
          }
        }
        if ('ok' in links) {
          for (const [number, evidence] of byNumber) {
            if (evidence.merged) {
              links = {
                notTaken: 'not-eligible',
                reason: 'merged-linked-pull',
                pr: number,
              };
              break;
            }
          }
        }
      }
    } catch (err) {
      if (!(err instanceof GithubRateLimitedError)) throw err;
      links = { notTaken: 'unverifiable', reason: 'linked-pulls-rate-limited' };
    }
    if ('notTaken' in links) {
      if (links.notTaken === 'unverifiable') tally.unverifiable += 1;
      else tally.notEligible += 1;
      log(
        {
          projectId: row.id,
          issue: issueNumber,
          reason: links.reason,
          ...('pr' in links ? { pr: links.pr } : {}),
        },
        'issue intake candidate not taken',
      );
      return 'not-taken';
    }
    if ('closeGithub' in links) {
      if (
        claimedRefs(row.teamId).has(githubIssueSourceRef(owner, repo, issueNumber).toLowerCase())
      ) {
        tally.claimed += 1;
        return 'not-taken';
      }
      try {
        await githubCloseIssue(run.githubFetch, access.token, owner, repo, issueNumber, {
          stateReason: 'completed',
        });
        tally.githubIssuesClosed += 1;
        log(
          { projectId: row.id, issue: issueNumber, pr: links.closeGithub.pr },
          'issue intake closed github issue after merged closing pull request',
        );
      } catch (err) {
        tally.errors += 1;
        log(
          {
            projectId: row.id,
            issue: issueNumber,
            pr: links.closeGithub.pr,
            err: errText(err),
          },
          'issue intake github issue close failed',
        );
      }
      return 'not-taken';
    }
    if (projectAtInFlightCap(deps.db, row.id)) {
      tally.atCap += 1;
      return 'full';
    }
    let todoId: string;
    try {
      const record = await importGithubIssue(
        { ...deps, box: access.box, githubFetch: run.githubFetch },
        row,
        issueNumber,
        { createdBy: access.createdBy },
      );
      todoId = record.id;
    } catch (err) {
      if (err instanceof HttpError && err.status === 409) {
        tally.claimed += 1;
        return 'not-taken';
      }
      tally.errors += 1;
      log(
        { projectId: row.id, issue: issueNumber, err: errText(err) },
        'issue intake import failed',
      );
      return 'not-taken';
    }
    tally.imported += 1;
    log(
      { projectId: row.id, issue: issueNumber, todoId, labeler: verdict.labeler },
      'issue intake candidate taken',
    );
    seenOpen.add(refKey(row.teamId, githubIssueSourceRef(owner, repo, issueNumber)));
    orchestrateImported(todoId, { teamId: row.teamId, importedAt: nowMs(), attempts: 1 }, tally);
    return 'imported';
  }

  async function intakeProject(
    row: ProjectRow,
    owner: string,
    repo: string,
    access: TeamAccess,
    now: number,
    tally: IssueIntakeTally,
  ): Promise<void> {
    const settings = autonomySettingsOf(row);
    const gate = evaluateAutonomyGates({
      now,
      settings,
      inFlight: projectInFlight(deps.db, row.id),
      inFlightCap: ISSUE_INTAKE_IN_FLIGHT_CAP,
      lastMemberWriteAt: lastMemberWriteAt(deps.db),
      lastStartedAt: autonomyStateOf(deps.db, row.id, 'issue-intake')?.lastStartedAt ?? null,
      spentTodayUsd: spentForGate(deps.db, row.id, settings, now),
    });
    recordAutonomyVerdict(deps.db, row.id, 'issue-intake', gate, now);
    if (!gate.ok) {
      tally.gated += 1;
      if (gate.reason !== 'in-flight-cap') {
        log({ projectId: row.id, reason: gate.reason }, 'issue intake project gated');
      }
      return;
    }
    const listKey = `${row.teamId}\u0000${owner}/${repo}`.toLowerCase();
    const claimed = claimedRefs(row.teamId);
    const listed = new Set<string>();
    const visitedPages = new Set<string>();
    let atCap = false;
    let started = false;
    let url: string | null = null;
    for (let pageNo = 1; ; pageNo += 1) {
      if (pageNo > ISSUE_INTAKE_MAX_LIST_PAGES) {
        tally.listTruncated += 1;
        log(
          { projectId: row.id, pages: ISSUE_INTAKE_MAX_LIST_PAGES },
          'issue intake list truncated',
        );
        break;
      }
      const pageKey: string = `${listKey}\u0000${url ?? 'first'}`;
      visitedPages.add(pageKey);
      const page = await githubOpenIssuesWithLabel(
        run.githubFetch,
        access.token,
        owner,
        repo,
        ISSUE_INTAKE_LABEL,
        { url, etag: etagFor(listCache, pageKey) },
      );
      const data: GithubLabeledIssuesPage | null = settle(listCache, pageKey, page);
      if (data === null) {
        if (pageNo === 1) {
          tally.skipped += 1;
          log({ projectId: row.id, reason: 'list-unreadable' }, 'issue intake project skipped');
          return;
        }
        log({ projectId: row.id, page: pageNo }, 'issue intake list page unreadable');
        break;
      }
      if (page?.notModified === true) tally.listNotModified += 1;
      const candidates = [...data.issues].sort((a, b) => a.number - b.number);
      tally.candidates += candidates.length;
      for (const issue of candidates) {
        const ref = githubIssueSourceRef(owner, repo, issue.number);
        listed.add(`${listKey}#${issue.number}`);
        if (claimed.has(ref.toLowerCase())) {
          tally.claimed += 1;
          continue;
        }
        const labelNames = issue.labels.map((l) => l.name.toLowerCase());
        if (labelNames.some((n) => n.startsWith('by:') && n !== ISSUE_INTAKE_OWN_LANE_LABEL)) {
          tally.otherLane += 1;
          continue;
        }
        if (labelNames.some((n) => ISSUE_INTAKE_HOLD_LABELS.includes(n))) {
          tally.held += 1;
          continue;
        }
        if (!atCap) atCap = projectAtInFlightCap(deps.db, row.id);
        if (atCap) {
          tally.atCap += 1;
          continue;
        }
        const outcome = await take(row, owner, repo, access, issue.number, now, tally);
        if (outcome === 'full') atCap = true;
        if (outcome === 'imported') {
          claimed.add(ref.toLowerCase());
          if (!started) recordAutonomyStart(deps.db, row.id, 'issue-intake', now);
          started = true;
        }
      }
      if (atCap || data.next === null) break;
      url = data.next;
    }
    for (const key of listCache.keys()) {
      if (key.startsWith(`${listKey}\u0000`) && !visitedPages.has(key)) listCache.delete(key);
    }
    for (const key of eventsCache.keys()) {
      const issueKey = key.split('\u0001')[0] ?? '';
      if (key.startsWith(`${listKey}#`) && !listed.has(issueKey)) eventsCache.delete(key);
    }
  }

  async function closerVerdict(
    teamId: string,
    token: string,
    ref: { owner: string; repo: string; issueNumber: number },
    key: string,
    now: number,
  ): Promise<'trusted' | { reason: string }> {
    const history = await readHistory(closerEventsCache, key, token, ref);
    if (history === null) return { reason: 'events-unreadable' };
    if (!history.complete) return { reason: 'events-incomplete' };
    const closed = newestOf(history.events, (e) => e.event === 'closed');
    if (closed === null) return { reason: 'no-closed-event' };
    if (closed.actor === null) return { reason: 'closer-deleted' };
    const trusted = await hasRepoTriage(
      run.githubFetch,
      teamId,
      token,
      ref.owner,
      ref.repo,
      closed.actor,
      now,
    );
    if (trusted === null) return { reason: 'permission-unreadable' };
    return trusted ? 'trusted' : { reason: 'closer-below-triage' };
  }

  async function reconcileClosed(
    teamId: string,
    token: string,
    rows: ReconcileRow[],
    now: number,
    tally: IssueIntakeTally,
  ): Promise<void> {
    const keep = new Set<string>();
    for (const t of rows) {
      const ref = parseGithubIssueSourceRef(t.sourceRef);
      if (ref === null) continue;
      const key = refKey(teamId, t.sourceRef);
      keep.add(key);
      try {
        const page = await githubIssueState(
          run.githubFetch,
          token,
          ref.owner,
          ref.repo,
          ref.issueNumber,
          { etag: stateCache.get(key)?.etag ?? null },
        );
        const issue = settle(stateCache, key, page);
        if (issue === null) {
          tally.closeSkipped += 1;
          continue;
        }
        if (issue.state === 'open') {
          seenOpen.add(key);
          continue;
        }
        if (!seenOpen.has(key)) continue;
        const closer = await closerVerdict(teamId, token, ref, key, now);
        if (closer !== 'trusted') {
          tally.closeSkipped += 1;
          log(
            { todoId: t.id, issue: ref.issueNumber, reason: closer.reason },
            'issue intake close skipped',
          );
          continue;
        }
        const fresh = deps.db
          .select({ phase: todo.phase })
          .from(todo)
          .where(and(eq(todo.id, t.id), noDeliveredPr(), noOpenChildren()))
          .get();
        if (fresh === undefined || fresh.phase !== t.phase) {
          tally.closeSkipped += 1;
          continue;
        }
        const result = transitionTodos(deps, teamId, [t.id], 'closed', ISSUE_INTAKE_ACTOR);
        if (result.transitioned.includes(t.id)) {
          tally.closed += 1;
          seenOpen.delete(key);
        } else tally.closeSkipped += 1;
      } catch (err) {
        if (err instanceof GithubRateLimitedError) throw err;
        tally.errors += 1;
        log({ todoId: t.id, err: errText(err) }, 'issue intake close failed');
      }
    }
    const teamPrefix = `${teamId}\u0000`.toLowerCase();
    for (const cache of [stateCache, closerEventsCache]) {
      for (const key of cache.keys()) {
        if (key.startsWith(teamPrefix) && !keep.has(key.split('\u0001')[0] ?? '')) {
          cache.delete(key);
        }
      }
    }
    for (const key of seenOpen) {
      if (key.startsWith(teamPrefix) && !keep.has(key)) seenOpen.delete(key);
    }
  }

  async function sweepTeam(
    teamId: string,
    projects: ProjectRow[],
    issueTasks: IssueTaskRow[],
    now: number,
    tally: IssueIntakeTally,
  ): Promise<void> {
    const got = await teamGithubToken(deps, teamId);
    if ('reason' in got) {
      tally.skipped += projects.length;
      log({ teamId, reason: got.reason }, 'issue intake team skipped');
      return;
    }
    const agentId = chiefBinding(deps, teamId).agentId;
    if (agentId === null) {
      if (issueTasks.some((t) => t.createdBy !== null && t.createdBy !== deps.user.id)) {
        log({ teamId, reason: 'chief-not-bound' }, 'issue intake close reconcile skipped');
      }
    } else {
      const taken = issueTasks.filter((t) => t.createdBy === agentId);
      await reconcileClosed(teamId, got.token, taken, now, tally);
    }
    if (projects.length === 0) return;
    const binding = chiefBinding(deps, teamId);
    const createdBy = binding.canOrchestrate ? binding.agentId : null;
    if (createdBy === null) {
      tally.skipped += projects.length;
      log({ teamId, reason: 'chief-not-bound' }, 'issue intake team skipped');
      return;
    }
    retryOrchestration(teamId, createdBy, now, tally);
    const seenRepos = new Set<string>();
    for (const row of projects) {
      const repoRef = githubRepoOfProject(row);
      if (repoRef === null) {
        tally.skipped += 1;
        log({ projectId: row.id, reason: 'malformed-repo' }, 'issue intake project skipped');
        continue;
      }
      const githubRepo = `${repoRef.owner}/${repoRef.repo}`;
      if (seenRepos.has(githubRepo.toLowerCase())) {
        tally.skipped += 1;
        log({ projectId: row.id, reason: 'duplicate-repo' }, 'issue intake project skipped');
        continue;
      }
      seenRepos.add(githubRepo.toLowerCase());
      tally.projects += 1;
      try {
        await intakeProject(row, repoRef.owner, repoRef.repo, { ...got, createdBy }, now, tally);
      } catch (err) {
        if (err instanceof GithubRateLimitedError) throw err;
        tally.errors += 1;
        log({ projectId: row.id, err: errText(err) }, 'issue intake project failed');
      }
    }
  }

  async function sweep(now: number = nowMs()): Promise<IssueIntakeTally | null> {
    if (sweeping) return null;
    sweeping = true;
    const tally = emptyTally();
    try {
      const projects = deps.db
        .select()
        .from(project)
        .where(and(eq(project.repoKind, 'github'), isNotNull(project.githubRepo)))
        .orderBy(asc(project.id))
        .all();
      const issueTasks = deps.db
        .select({
          id: todo.id,
          teamId: todo.teamId,
          phase: todo.phase,
          sourceRef: todo.sourceRef,
          createdBy: todo.createdBy,
        })
        .from(todo)
        .where(
          and(
            eq(todo.sourceKind, 'github-issue'),
            isNotNull(todo.sourceRef),
            notInArray(todo.phase, CLOSE_RECONCILE_SKIPPED),
            noDeliveredPr(),
            noOpenChildren(),
          ),
        )
        .all();
      const teamIds = new Set([
        ...projects.map((p) => p.teamId),
        ...issueTasks.map((t) => t.teamId),
      ]);
      for (const teamId of teamIds) {
        tally.teams += 1;
        try {
          await sweepTeam(
            teamId,
            projects.filter((p) => p.teamId === teamId),
            issueTasks
              .filter((t) => t.teamId === teamId)
              .map((t) => ({ ...t, sourceRef: t.sourceRef ?? '' })),
            now,
            tally,
          );
        } catch (err) {
          if (err instanceof GithubRateLimitedError) {
            tally.rateLimited += 1;
            const retryAt = err.retryAt(now);
            log(
              {
                teamId,
                status: err.status,
                resetAt: retryAt === null ? null : new Date(retryAt).toISOString(),
              },
              'issue intake team rate limited',
            );
          } else {
            tally.errors += 1;
            log({ teamId, err: errText(err) }, 'issue intake team failed');
          }
        }
      }
    } catch (err) {
      tally.errors += 1;
      log({ err: errText(err) }, 'issue intake sweep failed');
    } finally {
      sweeping = false;
    }
    log(tally, 'issue intake sweep');
    return tally;
  }

  return { sweep };
}
