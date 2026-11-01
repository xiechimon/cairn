export const FIXTURE_TURNS = 500;
export const SEEDED_TURNS = 480;
export const RARE_FACT_TURN = 20;
export const RECALL_TURN = 500;

export const RARE_FACT_USER =
  'Note for later, no action now: the Kestrel billing migration must run on host build-07 after 02:30 UTC, and its change ticket is KST-4471. Keep that in mind for when I ask.';
export const RARE_FACT_REPLY =
  'Noted. Kestrel billing migration: host build-07, after 02:30 UTC, change ticket KST-4471. I will not schedule anything until you ask.';
export const RECALL_QUESTION =
  'Earlier in this conversation I told you which host and which change ticket the Kestrel billing migration must use. Which host and which ticket? Answer with both values exactly.';
export const RECALL_ANSWERS = ['build-07', 'KST-4471'] as const;

export interface FixtureToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result: string;
}

export interface FixtureTurn {
  n: number;
  user: string;
  tools: FixtureToolCall[];
  reply: string;
}

const PROJECTS = ['Heron', 'Osprey', 'Wren', 'Lark', 'Finch', 'Plover', 'Tern', 'Egret'];
const AGENTS = ['Builder', 'Reviewer', 'Verifier', 'Docs', 'Ops'];
const AREAS = [
  'login form validation',
  'invoice export',
  'search ranking',
  'webhook retries',
  'avatar upload',
  'rate limit banner',
  'audit log paging',
  'dark mode contrast',
  'email digest',
  'CSV import',
  'session timeout',
  'settings page layout',
];
const CHECKS = ['typecheck', 'unit', 'e2e-affected', 'lint', 'spec-parse', 'merge-route'];

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(r: () => number, xs: readonly T[]): T {
  return xs[Math.floor(r() * xs.length)] as T;
}

function todoRows(r: () => number, project: string, count: number): string {
  const rows = [];
  for (let i = 0; i < count; i += 1) {
    const id = 1000 + Math.floor(r() * 9000);
    rows.push(
      JSON.stringify({
        id: `todo-${project.toLowerCase()}-${id}`,
        title: `Fix ${pick(r, AREAS)} in ${project}`,
        phase: pick(r, ['todo', 'building', 'review', 'done', 'failed']),
        agent: pick(r, AGENTS),
        pr: r() < 0.6 ? 2000 + Math.floor(r() * 900) : null,
        updatedMinutesAgo: Math.floor(r() * 600),
        lastEvent: `${pick(r, AGENTS)} ${pick(r, ['pushed a fix for', 'asked a question about', 'reran checks on', 'opened a review of', 'reported a flaky test in'])} the ${pick(r, AREAS)} change; ${pick(r, CHECKS)} took ${30 + Math.floor(r() * 600)}s on build-${String(1 + Math.floor(r() * 12)).padStart(2, '0')}`,
      }),
    );
  }
  return `[${rows.join(',\n')}]`;
}

function ordinaryTurn(n: number, r: () => number): FixtureTurn {
  const project = pick(r, PROJECTS);
  const area = pick(r, AREAS);
  const agent = pick(r, AGENTS);
  const pr = 2000 + Math.floor(r() * 900);
  const host = `build-${String(1 + Math.floor(r() * 12)).padStart(2, '0')}`;
  const check = pick(r, CHECKS);
  const kind = n % 5;
  if (kind === 0) {
    return {
      n,
      user: `What is the state of ${project} right now? I mostly care about the ${area} work and whether anything is stuck waiting on me.`,
      tools: [
        {
          id: `call-${n}`,
          name: 'todos',
          arguments: { project, phase: 'any' },
          result: todoRows(r, project, 12),
        },
      ],
      reply: `${project} has twelve open items. The ${area} task is in review with ${agent}; PR #${pr} is waiting for ${check}. Nothing is blocked on you right now. Two items finished in the last hour and one failed build on ${host} is being retried automatically.`,
    };
  }
  if (kind === 1) {
    return {
      n,
      user: `Dispatch a task for ${project}: ${area} regressed after yesterday's release. Give it to ${agent} and keep me posted only if it needs a decision.`,
      tools: [
        {
          id: `call-${n}`,
          name: 'create_todo',
          arguments: { project, title: `Fix ${area} regression`, agent },
          result: JSON.stringify({
            id: `todo-${project.toLowerCase()}-${n}`,
            phase: 'queued',
            agent,
            queuePosition: Math.floor(r() * 4),
          }),
        },
      ],
      reply: `Created the ${area} regression task in ${project} and assigned it to ${agent}. It is queued; I will only come back to you if it needs a decision.`,
    };
  }
  if (kind === 2) {
    return {
      n,
      user: `PR #${pr} on ${project} failed ${check} again. Is that the same flake as last week or a real failure?`,
      tools: [
        {
          id: `call-${n}`,
          name: 'pull_requests',
          arguments: { project, number: pr },
          result: JSON.stringify({
            number: pr,
            state: 'open',
            checks: CHECKS.map((name) => ({
              name,
              conclusion: name === check ? 'failure' : 'success',
              durationS: 30 + Math.floor(r() * 600),
            })),
            lastLog: `${check}: ${Math.floor(r() * 4) + 1} failing assertions in ${area} spec; runner ${host}; retry ${Math.floor(r() * 3)}`,
          }),
        },
      ],
      reply: `PR #${pr} failed ${check} on runner ${host} with assertions in the ${area} spec. Last week's flake was a timeout, so this looks like a real failure. I asked ${agent} to look at it before retrying.`,
    };
  }
  if (kind === 3) {
    return {
      n,
      user: `Decision for ${project}: we keep the old ${area} behaviour behind a flag until the next release. Record that and tell ${agent}.`,
      tools: [],
      reply: `Recorded for ${project}: the old ${area} behaviour stays behind a flag until the next release. I told ${agent}.`,
    };
  }
  return {
    n,
    user: `Quick one: which machines are busy and is anything for ${project} waiting for a slot?`,
    tools: [
      {
        id: `call-${n}`,
        name: 'machines',
        arguments: {},
        result: JSON.stringify(
          Array.from({ length: 6 }, (_, i) => ({
            name: `build-${String(i + 1).padStart(2, '0')}`,
            online: r() < 0.9,
            running: Math.floor(r() * 3),
            maxConcurrent: 3,
          })),
        ),
      },
    ],
    reply: `Five of six machines are online and most have a free slot. Nothing for ${project} is waiting for capacity right now.`,
  };
}

export function buildFixture(seed = 2522): FixtureTurn[] {
  const r = rng(seed);
  const turns: FixtureTurn[] = [];
  for (let n = 1; n <= FIXTURE_TURNS; n += 1) {
    if (n === RARE_FACT_TURN) {
      turns.push({ n, user: RARE_FACT_USER, tools: [], reply: RARE_FACT_REPLY });
      continue;
    }
    if (n === RECALL_TURN) {
      turns.push({ n, user: RECALL_QUESTION, tools: [], reply: '' });
      continue;
    }
    turns.push(ordinaryTurn(n, r));
  }
  return turns;
}

export function messageId(n: number, role: 'user' | 'assistant'): string {
  return `m-${String(n).padStart(4, '0')}-${role}`;
}

export function toolMessageId(n: number, index: number): string {
  return `m-${String(n).padStart(4, '0')}-tool-${index}`;
}

export function recalled(answer: string): boolean {
  return RECALL_ANSWERS.every((value) => answer.includes(value));
}
