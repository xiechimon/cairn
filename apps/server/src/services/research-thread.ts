import type { ResearchTier, TodoSourceKind } from '@cairn/shared';
import { researchPrompt } from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import { todo } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { type BuildDeps, startBuilds } from './builds.js';
import { recordResearchTier } from './research-citations.js';
import { routeForStep } from './routing-rules.js';
import { createAutonomousTodo } from './todos.js';

export interface OpenResearchThreadInput {
  teamId: string;
  projectId: string;
  title: string;
  question: string;
  tier: ResearchTier;
  source?: { kind: TodoSourceKind; ref: string };
}

export interface OpenedResearchThread {
  todoId: string;
  buildId: string;
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
    };
  }
  const route = routeForStep(deps.db, { teamId: input.teamId }, 'build');
  if (route === null) {
    throw new HttpError(409, 'Research needs a session routing rule, but this team has none.');
  }
  const todoId =
    existing?.id ??
    createAutonomousTodo(deps, {
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
  const [started] = startBuilds(deps, {
    projectId: input.projectId,
    todoIds: [todoId],
    triggerSource: 'chief',
  });
  if (started === undefined) throw new Error('research build was not created');
  recordResearchTier(deps, started.id, input.tier);
  return { todoId, buildId: started.id };
}
