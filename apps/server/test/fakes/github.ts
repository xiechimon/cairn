import { createHash } from 'node:crypto';
import type { FetchLike } from '../../src/lib/github.js';
import type { GateGithubPort, GateRaw } from '../../src/services/merge-gate/github-port.js';

export interface RawLabel {
  name: string;
  color?: string;
}

export interface RawIssue {
  number: number;
  title: string;
  state: string;
  labels: RawLabel[];
  created_at: string;
  body: string | null;
  pull_request?: unknown;
}

export interface RawEvent {
  id: number;
  actor: { login: string; id: number; type: string } | null;
  event: string;
  commit_id: string | null;
  created_at: string;
  label?: { name: string; color: string };
  performed_via_github_app: unknown;
}

export interface GateAnswers {
  pull: (n: number, o: { etag: string | null }) => GateRaw;
  branch: (name: string, o: { etag: string | null }) => GateRaw;
  rules: (name: string, o: { page: number; perPage: number; etag: string | null }) => GateRaw;
  compare: (base: string, head: string, o: { page: number; perPage: number }) => GateRaw;
  checkRuns: (sha: string, o: { page: number; perPage: number; etag: string | null }) => GateRaw;
  combinedStatus: (
    sha: string,
    o: { page: number; perPage: number; etag: string | null },
  ) => GateRaw;
  contents: (path: string, ref: string) => GateRaw;
}

interface GithubFakeOptions {
  issues?: RawIssue[];
  events?: RawEvent[];
  permissions?: Array<[string, GhResponse]>;
  gate?: GateAnswers;
  handle?: (url: URL, init: Parameters<FetchLike>[1]) => GhResponse | Promise<GhResponse>;
}

export interface GhCall {
  host: string;
  path: string;
  method: string;
  search: URLSearchParams;
  headers: Record<string, string>;
  status: number;
  body: string | undefined;
}

export interface GhResponse {
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
  raw?: string;
}

export type GhOverride = (
  url: URL,
  headers: Record<string, string>,
) => GhResponse | Promise<GhResponse>;

export function etagOf(body: unknown): string {
  return `"${createHash('sha256').update(JSON.stringify(body)).digest('hex')}"`;
}

export function conditional(
  headers: Record<string, string>,
  body: unknown,
  extra: Record<string, string> = {},
): GhResponse {
  const etag = etagOf(body);
  if (headers['if-none-match'] === etag) return { status: 304, headers: { etag, ...extra } };
  return { body, headers: { etag, ...extra } };
}

export interface TimelineEvent {
  event: string;
  source?: {
    type?: string;
    issue?: {
      number: number;
      state: 'open' | 'closed';
      repository?: { full_name: string };
      pull_request?: { merged_at: string | null } | null;
    };
  };
}

export interface ClosingPullNode {
  number: number;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  merged: boolean;
  repository: { nameWithOwner: string };
}

const MISSING_GATE_ANSWER: GateRaw = {
  kind: 'failed',
  failure: { kind: 'status', status: 404, message: 'No fake answer' },
};

export function githubFake(repo: string, options: GithubFakeOptions = {}) {
  const state = {
    open: structuredClone(options.issues ?? []) as RawIssue[],
    issues: new Map<number, RawIssue>(),
    events: new Map<number, RawEvent[]>(),
    eventsHasNext: new Set<number>(),
    eventsForeignNext: new Set<number>(),
    eventsFailPages: new Map<number, Set<number>>(),
    permissions: new Map<string, GhResponse>(options.permissions ?? []),
    listFailPages: new Set<number>(),
    timeline: new Map<number, TimelineEvent[]>(),
    timelineIncomplete: new Set<number>(),
    timelineUnreadable: new Set<number>(),
    closingPulls: new Map<number, ClosingPullNode[]>(),
    closingIncomplete: new Set<number>(),
    closingUnreadable: new Set<number>(),
  };
  const overrides = new Map<string, GhOverride>();
  const calls: GhCall[] = [];
  let onCall: ((path: string) => void | Promise<void>) | null = null;

  const base = `/repos/${repo}`.toLowerCase();
  const sameRepo = repo.toLowerCase();

  function resolve(url: URL, headers: Record<string, string>): GhResponse {
    const path = url.pathname.toLowerCase();
    if (path === `${base}/issues`) {
      const wanted = (url.searchParams.get('labels') ?? '')
        .split(',')
        .filter((l) => l !== '')
        .map((l) => l.toLowerCase());
      const stateParam = url.searchParams.get('state') ?? 'open';
      let items = state.open.filter(
        (i) =>
          (stateParam === 'all' || i.state === stateParam) &&
          wanted.every((w) => i.labels.some((l) => l.name.toLowerCase() === w)),
      );
      items = [...items].sort((a, b) =>
        url.searchParams.get('direction') === 'asc' ? a.number - b.number : b.number - a.number,
      );
      const perPage = Number(url.searchParams.get('per_page') ?? '30');
      const pageNo = Number(url.searchParams.get('page') ?? '1');
      if (state.listFailPages.has(pageNo)) return { status: 502, body: { message: 'Bad Gateway' } };
      const slice = items.slice((pageNo - 1) * perPage, pageNo * perPage);
      if (items.length <= pageNo * perPage) return conditional(headers, slice);
      const next = new URL(url.toString());
      next.searchParams.set('page', String(pageNo + 1));
      return conditional(headers, slice, { link: `<${next.toString()}>; rel="next"` });
    }
    const eventsMatch = new RegExp(`^${base}/issues/(\\d+)/events$`).exec(path);
    if (eventsMatch) {
      const n = Number(eventsMatch[1]);
      const events = state.events.get(n) ?? options.events ?? [];
      const perPage = Number(url.searchParams.get('per_page') ?? '30');
      const pageNo = Number(url.searchParams.get('page') ?? '1');
      if (state.eventsFailPages.get(n)?.has(pageNo) === true) {
        return { status: 502, body: { message: 'Bad Gateway' } };
      }
      const slice = state.eventsHasNext.has(n)
        ? events
        : events.slice((pageNo - 1) * perPage, pageNo * perPage);
      const next = new URL(url.toString());
      next.searchParams.set('page', String(pageNo + 1));
      const link: Record<string, string> = state.eventsForeignNext.has(n)
        ? { link: `<https://evil.example${url.pathname}?page=2>; rel="next"` }
        : state.eventsHasNext.has(n) || events.length > pageNo * perPage
          ? { link: `<${next.toString()}>; rel="next"` }
          : {};
      return conditional(headers, slice, link);
    }
    const issueMatch = new RegExp(`^${base}/issues/(\\d+)$`).exec(path);
    if (issueMatch) {
      const n = Number(issueMatch[1]);
      const issue = state.issues.get(n) ?? state.open.find((i) => i.number === n);
      if (issue === undefined) return { status: 404, body: { message: 'Not Found' } };
      return conditional(headers, issue);
    }
    if (path === `${base}/labels`) {
      const names = new Map<string, RawLabel>();
      for (const i of state.open) for (const l of i.labels) names.set(l.name, l);
      return { body: [...names.values()] };
    }
    const permMatch = new RegExp(`^${base}/collaborators/([^/]+)/permission$`).exec(path);
    if (permMatch) {
      const login = decodeURIComponent(permMatch[1] as string).toLowerCase();
      return state.permissions.get(login) ?? { status: 404, body: { message: 'Not Found' } };
    }
    const timelineMatch = new RegExp(`^${base}/issues/(\\d+)/timeline$`).exec(path);
    if (timelineMatch) {
      const n = Number(timelineMatch[1]);
      if (state.timelineUnreadable.has(n)) {
        return { status: 502, body: { message: 'Bad Gateway' } };
      }
      const events = state.timeline.get(n) ?? [];
      if (state.timelineIncomplete.has(n)) {
        return {
          body: events,
          headers: {
            link: `<https://evil.example/repos/${sameRepo}/issues/${n}/timeline?page=2>; rel="next"`,
          },
        };
      }
      return { body: events };
    }
    return { status: 404, body: { message: `no fake for ${path}` } };
  }

  const impl: FetchLike = async (input, init) => {
    const url = new URL(String(input));
    const headers = { ...(init?.headers ?? {}) };
    const call: GhCall = {
      host: url.host,
      path: url.pathname,
      method: (init?.method ?? 'GET').toUpperCase(),
      search: url.searchParams,
      headers,
      status: 0,
      body: init?.body,
    };
    calls.push(call);
    await new Promise((r) => setTimeout(r, 0));
    if (onCall !== null) await onCall(url.pathname);
    const override = overrides.get(url.pathname);
    let res: GhResponse;
    if (override !== undefined) {
      res = await override(url, headers);
    } else if (options.handle !== undefined) {
      res = await options.handle(url, init);
    } else if (url.pathname.toLowerCase() === '/graphql') {
      let issueNumber: number | null = null;
      try {
        const parsed = JSON.parse(init?.body ?? '{}') as {
          variables?: { number?: unknown };
        };
        if (typeof parsed.variables?.number === 'number') issueNumber = parsed.variables.number;
        else issueNumber = 0;
      } catch {
        issueNumber = null;
      }
      if (issueNumber === null) {
        res = { status: 400, body: { message: 'bad graphql body' } };
      } else if (state.closingUnreadable.has(issueNumber)) {
        res = { status: 502, body: { message: 'Bad Gateway' } };
      } else {
        const nodes = state.closingPulls.get(issueNumber) ?? [];
        res = {
          body: {
            data: {
              repository: {
                issue: {
                  closedByPullRequestsReferences: {
                    pageInfo: { hasNextPage: state.closingIncomplete.has(issueNumber) },
                    nodes,
                  },
                },
              },
            },
          },
        };
      }
    } else if (call.method === 'PATCH' || call.method === 'POST') {
      const path = url.pathname.toLowerCase();
      const issueMatch = new RegExp(`^${base}/issues/(\\d+)$`).exec(path);
      const commentMatch = new RegExp(`^${base}/issues/(\\d+)/comments$`).exec(path);
      if (issueMatch !== null && call.method === 'PATCH') {
        try {
          const payload = JSON.parse(String(init?.body ?? '{}')) as { state?: unknown };
          if (payload.state === 'closed') {
            const n = Number(issueMatch[1]);
            state.open = state.open.filter((i) => i.number !== n);
            const stored = state.issues.get(n);
            if (stored !== undefined) state.issues.set(n, { ...stored, state: 'closed' });
            res = { body: { number: n, state: 'closed' } };
          } else {
            res = { body: { number: Number(issueMatch[1]) } };
          }
        } catch {
          res = { status: 400, body: { message: 'bad json' } };
        }
      } else if (commentMatch !== null && call.method === 'POST') {
        res = { body: { id: 1 } };
      } else {
        res = { status: 404, body: { message: `no fake for ${path}` } };
      }
    } else {
      res = resolve(url, headers);
    }
    const status = res.status ?? 200;
    call.status = status;
    const resHeaders = Object.fromEntries(
      Object.entries(res.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
    );
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (name: string) => resHeaders[name.toLowerCase()] ?? null },
      json: async () => {
        if (status === 304) throw new SyntaxError('304 has no body');
        return res.raw === undefined ? res.body : (JSON.parse(res.raw) as unknown);
      },
      text: async () => res.raw ?? JSON.stringify(res.body ?? ''),
    };
  };

  const log: Array<[string, ...unknown[]]> = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const call = async (name: string, args: unknown[], answer: () => GateRaw): Promise<GateRaw> => {
    log.push([name, ...args]);
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      await new Promise((r) => setTimeout(r, 0));
      return answer();
    } finally {
      inFlight -= 1;
    }
  };
  const port: GateGithubPort = {
    pull: (n, o) => call('pull', [n, o], () => options.gate?.pull(n, o) ?? MISSING_GATE_ANSWER),
    branch: (name, o) =>
      call('branch', [name, o], () => options.gate?.branch(name, o) ?? MISSING_GATE_ANSWER),
    branchRules: (name, o) =>
      call('rules', [name, o], () => options.gate?.rules(name, o) ?? MISSING_GATE_ANSWER),
    compare: (b, h, o) =>
      call('compare', [b, h, o], () => options.gate?.compare(b, h, o) ?? MISSING_GATE_ANSWER),
    checkRuns: (sha, o) =>
      call('checkRuns', [sha, o], () => options.gate?.checkRuns(sha, o) ?? MISSING_GATE_ANSWER),
    combinedStatus: (sha, o) =>
      call(
        'combinedStatus',
        [sha, o],
        () => options.gate?.combinedStatus(sha, o) ?? MISSING_GATE_ANSWER,
      ),
    contents: (path, ref) =>
      call('contents', [path, ref], () => options.gate?.contents(path, ref) ?? MISSING_GATE_ANSWER),
    createStatus: () => Promise.reject(new Error('the shell never writes')),
  };

  return {
    port,
    log,
    maxInFlight: () => maxInFlight,
    impl,
    state,
    overrides,
    calls,
    setOnCall(fn: ((path: string) => void | Promise<void>) | null): void {
      onCall = fn;
    },
    listReads: () => calls.filter((c) => c.path === `${base}/issues`),
    eventReads: (n?: number) =>
      calls.filter((c) =>
        n === undefined
          ? /\/issues\/\d+\/events$/.test(c.path)
          : c.path === `${base}/issues/${n}/events`,
      ),
    issueReads: (n: number) => calls.filter((c) => c.path === `${base}/issues/${n}`),
    permissionReads: (login?: string) =>
      calls.filter((c) =>
        login === undefined
          ? c.path.endsWith('/permission')
          : c.path.toLowerCase() === `${base}/collaborators/${login.toLowerCase()}/permission`,
      ),
    timelineReads: (n?: number) =>
      calls.filter((c) =>
        n === undefined
          ? /\/issues\/\d+\/timeline$/.test(c.path)
          : c.path.toLowerCase() === `${base}/issues/${n}/timeline`,
      ),
    graphqlReads: () => calls.filter((c) => c.path === '/graphql'),
  };
}

export type Answer =
  | { status: number; body?: unknown; raw?: string; headers?: Record<string, string> }
  | 'timeout'
  | 'network';

export interface PullFake {
  state: 'open' | 'closed';
  merged: boolean;
  title?: string | null;
  headSha?: string;
  headRef?: string;
  headRepoId?: number | null;
  baseRef?: string;
  defaultBranch?: string;
  mergeCommitSha?: string | null;
  mergedBy?: string | null;
  mergedAt?: string;
  authorAssociation?: string;
  opener?: unknown;
}

export interface Recorded {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | undefined;
}

const CP = '1a2b3c4d'.repeat(5);
const MERGE_SHA = '9f8e7d6c'.repeat(5);
const REPO_ID = 4242;
const PR_TITLE = 'Add the reconcile hint';

function answer(status: number, raw: string, headers: Record<string, string> = {}): GhResponse {
  return { status, raw, headers };
}

function throwIfFault(a: Answer): asserts a is Exclude<Answer, 'timeout' | 'network'> {
  if (a === 'timeout') {
    throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  }
  if (a === 'network') throw new TypeError('fetch failed');
}

class MergeState {
  requests: Recorded[] = [];
  mergeAnswer: Answer = {
    status: 200,
    body: { sha: MERGE_SHA, merged: true, message: 'Pull Request successfully merged' },
  };
  getAnswer: Answer | null = null;
  onGet: (() => Promise<void> | void) | null = null;
  onPut: (() => Promise<void> | void) | null = null;
  onMarker: (() => Promise<void> | void) | null = null;
  markerAnswer: Answer = { status: 200, body: [] };
  compareStatus = 'identical';
  constructor(
    readonly pulls: Record<number, PullFake>,
    readonly branchOf: (n: number) => string,
  ) {}

  gets = () => this.requests.filter((r) => r.method === 'GET' && /\/pulls\/\d+$/.test(r.url));
  puts = () => this.requests.filter((r) => r.method === 'PUT');

  readonly handle: NonNullable<GithubFakeOptions['handle']> = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    this.requests.push({ method, url, headers: { ...(init?.headers ?? {}) }, body: init?.body });
    const merge = url.match(/\/pulls\/(\d+)\/merge$/);
    if (merge !== null && method === 'PUT') {
      await this.onPut?.();
      const a = this.mergeAnswer;
      throwIfFault(a);
      const pull = this.pulls[Number(merge[1])];
      const body = a.body as { merged?: unknown; sha?: unknown } | undefined;
      if (a.status === 200 && body?.merged === true && pull !== undefined) {
        pull.state = 'closed';
        pull.merged = true;
        pull.mergeCommitSha = typeof body.sha === 'string' ? body.sha : null;
        pull.mergedBy = 'octo';
      }
      return answer(a.status, a.raw ?? JSON.stringify(a.body ?? {}), a.headers);
    }
    if (url.includes('/issues?')) {
      await this.onMarker?.();
      const a = this.markerAnswer;
      throwIfFault(a);
      return answer(a.status, a.raw ?? JSON.stringify(a.body ?? {}));
    }
    if (url.includes('/compare/')) {
      return answer(200, JSON.stringify({ status: this.compareStatus }));
    }
    if (/\/pulls\?/.test(url)) return answer(200, '[]');
    if (url.includes('/check-runs')) return answer(404, '{}');
    const m = url.match(/\/pulls\/(\d+)$/);
    if (m === null || method !== 'GET') return answer(404, '{}');
    await this.onGet?.();
    const g = this.getAnswer;
    if (g !== null) {
      throwIfFault(g);
      return answer(g.status, g.raw ?? JSON.stringify(g.body ?? {}), g.headers);
    }
    const n = Number(m[1]);
    const p = this.pulls[n];
    if (p === undefined) return answer(404, JSON.stringify({ message: 'Not Found' }));
    return answer(
      200,
      JSON.stringify({
        number: n,
        state: p.state,
        merged: p.merged,
        ...(p.title === null ? {} : { title: p.title ?? PR_TITLE }),
        author_association: p.authorAssociation ?? 'OWNER',
        user: p.opener === undefined ? { login: 'octo', type: 'User' } : p.opener,
        merge_commit_sha: p.merged ? (p.mergeCommitSha ?? MERGE_SHA) : 'e'.repeat(40),
        merged_by: p.merged && p.mergedBy != null ? { login: p.mergedBy } : null,
        merged_at: p.merged ? (p.mergedAt ?? new Date().toISOString()) : null,
        closed_at: p.state === 'closed' ? new Date().toISOString() : null,
        head: {
          sha: p.headSha ?? CP,
          ref: p.headRef ?? this.branchOf(n),
          repo: p.headRepoId === null ? null : { id: p.headRepoId ?? REPO_ID },
        },
        base: {
          ref: p.baseRef ?? 'main',
          repo: { id: REPO_ID, default_branch: p.defaultBranch ?? 'main' },
        },
      }),
      { etag: '"p"' },
    );
  };
}

export function mergeGithubFake(pulls: Record<number, PullFake>, branchOf: (n: number) => string) {
  const state = new MergeState(pulls, branchOf);
  const fake = githubFake('octo/demo', { handle: state.handle });
  return Object.assign(state, { fetch: fake.impl });
}
