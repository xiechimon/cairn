import { todoRecordSchema } from '@cairn/shared';
import { expect, test } from 'vitest';
import { toDisplayTodo } from '../src/api/mappers.js';

test.each([undefined, [], ['repository-label']])('maps dedicated label ids without conflating categories: %j', (githubLabelIds) => {
  const wire = todoRecordSchema.parse({
    id: 'task', teamId: 'team', projectId: 'project', title: 'Independent labels', spec: '',
    phase: 'todo', phaseAt: 1, seqNum: 1, orderIndex: 0, tagIds: ['ordinary-category'],
    githubLabelIds, latestBuildId: null, lastRunAt: null, hasChanges: false, hasPlan: false,
    buildHistory: [], sourceTodo: null, v: 1, createdBy: null, ownerId: null,
    sourceBuildId: null, sourceKind: null, sourceRef: null,
  });
  const display = toDisplayTodo(wire);
  expect(display.tagIds).toEqual(['ordinary-category']);
  expect(display).toHaveProperty('githubLabelIds', githubLabelIds ?? []);
});
