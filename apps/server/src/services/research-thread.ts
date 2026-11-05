import type { Assignment, ResearchTier, TodoSourceKind } from '@cairn/shared';
import { researchPrompt } from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import { agent, chief, todo } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { type BuildDeps, startBuilds } from './builds.js';
import { recordResearchTier } from './research-citations.js';
import { runnableResearchAgentIds } from './research-dispatch.js';
import { routeForStep } from './routing-rules.js';
import { createTodo } from './todos.js';

export const RESEARCH_AGENT_PROVIDER = 'claude-code';

const PREFERRED_MODEL: Record<ResearchTier, string> = {
  1: 'claude-sonnet-5-5',
  2: 'claude-opus-5-5',
};

export interface OpenResearchThreadInput {
  teamId: string;
  projectId: string;
  title: string;
  question: string;
  tier: ResearchTier;
  agentId?: string;
  source?: { kind: TodoSourceKind; ref: string };
}

export interface OpenedResearchThread {
  todoId: string;
  buildId: string;
  agentId: string;
}

function chooseResearchAgent(
  deps: BuildDeps,
  input: OpenResearchThreadInput,
  route: ReturnType<typeof routeForStep>,
): string {
  const { db } = deps;
  if (input.agentId !== undefined) {
    const row = db
      .select()
      .from(agent)
      .where(and(eq(agent.id, input.agentId), eq(agent.teamId, input.teamId)))
      .get();
    if (row === undefined) throw new HttpError(404, `agent ${input.agentId}`);
    if (row.status !== 'active') throw new HttpError(409, `agent ${row.displayName} is not active`);
    return row.id;
  }
  const coordinators = new Set(
    db
      .select({ agentId: chief.agentId })
      .from(chief)
      .where(eq(chief.teamId, input.teamId))
      .all()
      .flatMap((row) => (row.agentId === null ? [] : [row.agentId])),
  );
  const candidates = db
    .select()
    .from(agent)
    .where(
      and(
        eq(agent.teamId, input.teamId),
        eq(agent.status, 'active'),
        eq(agent.provider, RESEARCH_AGENT_PROVIDER),
      ),
    )
    .all()
    .filter(
      (row) => !coordinators.has(row.id) && (route?.modelId ?? row.modelId ?? '').trim().length > 0,
    );
  const runnable = runnableResearchAgentIds(db, input, candidates, route);
  const preferred = PREFERRED_MODEL[input.tier];
  const rank = (row: { modelId: string | null }) =>
    row.modelId === preferred
      ? 0
      : Object.values(PREFERRED_MODEL).includes(row.modelId ?? '')
        ? 1
        : 2;
  const [best] = candidates.sort(
    (a, b) =>
      Number(!runnable.has(a.id)) - Number(!runnable.has(b.id)) ||
      Number(a.persona !== null) - Number(b.persona !== null) ||
      rank(a) - rank(b) ||
      a.id.localeCompare(b.id),
  );
  if (best === undefined) {
    throw new HttpError(
      409,
      'No active Claude Code agent is available for research: add a non-Coordinator agent that runs Claude Code, or pass agentId.',
    );
  }
  return best.id;
}

export function openResearchThread(
  deps: BuildDeps,
  input: OpenResearchThreadInput,
): OpenedResearchThread {
  const existing =
    input.source === undefined
      ? undefined
      : deps.db
          .select()
          .from(todo)
          .where(
            and(
              eq(todo.teamId, input.teamId),
              eq(todo.sourceKind, input.source.kind),
              eq(todo.sourceRef, input.source.ref),
            ),
          )
          .get();
  if (existing?.latestBuildId != null) {
    recordResearchTier(deps, existing.latestBuildId, input.tier);
    return {
      todoId: existing.id,
      buildId: existing.latestBuildId,
      agentId: existing.assignment?.build?.agentId ?? '',
    };
  }
  const route = routeForStep(deps.db, { teamId: input.teamId }, 'build');
  if (route !== null && route.provider !== RESEARCH_AGENT_PROVIDER) {
    throw new HttpError(
      409,
      `Research needs a Claude Code route, but this team's session route runs ${route.provider}/${route.modelId}.`,
    );
  }
  const agentId = chooseResearchAgent(deps, input, route);
  const todoId =
    existing?.id ??
    createTodo(deps, {
      teamId: input.teamId,
      projectId: input.projectId,
      title: input.title,
      spec: researchPrompt({ tier: input.tier, title: input.title, question: input.question }),
      createdBy: deps.user.id,
      ownerId: deps.user.id,
      output: 'info',
      ...(input.source === undefined
        ? {}
        : { sourceKind: input.source.kind, sourceRef: input.source.ref }),
    }).id;
  const assignment: Assignment = { plan: null, build: { agentId } };
  const [started] = startBuilds(deps, {
    projectId: input.projectId,
    todoIds: [todoId],
    assignment,
    withPlan: false,
    triggerSource: 'chief',
  });
  if (started === undefined) throw new Error('research build was not created');
  recordResearchTier(deps, started.id, input.tier);
  return { todoId, buildId: started.id, agentId };
}
