import { type BuildRecord, todoRecordSchema } from '@cairn/shared';
import { expect, test } from 'vitest';
import { type StreamQueryEvent, streamEventQueryEffect } from '../src/api/sse-team-events.js';
import { todo } from './helpers.js';

const TEAM = 'team-1';
const doc = todoRecordSchema.parse({
  ...todo(7, 'review'),
  teamId: TEAM,
  projectId: 'project-a',
  title: 'Review the final release',
  latestBuildId: 'build-a',
  createdBy: 'user-1',
  ownerId: null,
  sourceBuildId: null,
  sourceKind: null,
  sourceRef: null,
});
const build: BuildRecord = {
  id: 'build-a', todoId: doc.id, withPlan: false, prevPhase: null, triggerSource: 'user',
  planDocId: null, errorMessage: null, prUrl: null, prNumber: 42, diffHash: null, createdAt: 1,
  reportAttachmentId: 'report-a',
};
const todoEvent = { type: 'todo', teamId: TEAM, doc } satisfies StreamQueryEvent;
const buildEvent = { type: 'build', teamId: TEAM, doc: build, projectId: 'project-a', parent: doc } satisfies StreamQueryEvent;
const step = { type: 'step', teamId: TEAM, conversationId: 'build-a', todoId: doc.id, status: 'stopped' } satisfies StreamQueryEvent;
const message = { type: 'message', teamId: TEAM, conversationId: 'build-a', targetId: 'build-next', deliveredFromId: 'build-before', todoId: doc.id } satisfies StreamQueryEvent;
const keys = {
  todos: ['todos', TEAM], tasks: ['tasks', TEAM], todo: ['todo', doc.id], design: ['design', doc.id],
  steps: ['steps', 'build-a'], build: ['build', 'build-a'], plans: ['plans', 'build-a'],
  otherPlans: ['plans', 'build-b'], changes: ['changes', 'build-a'], usage: ['usage', 'build-a'],
  messages: ['messages', 'build-a', 'pages'], target: ['messages', 'build-next', 'pages'],
  source: ['messages', 'build-before', 'pages'], project: ['projectBuilds', 'project-a'],
  otherProject: ['projectBuilds', 'project-b'], title: ['search', 'release'],
  otherTitle: ['search', 'unrelated'], by: ['search', 'by:alice'],
  pr: ['search', 'pr:42'], otherPr: ['search', 'pr:99'],
  notifications: ['notifications', TEAM], chiefThreads: ['chiefThreads', TEAM], chief: ['chief', TEAM],
  machines: ['machines', TEAM], computers: ['computers', TEAM, 1], routing: ['model-routing', TEAM],
  schedules: ['schedules'], session: ['session'],
};

type Key = keyof typeof keys;
const cases: { event: StreamQueryEvent; cancel: Key[]; stale?: Key[] }[] = [
  { event: todoEvent, cancel: ['todos', 'tasks', 'todo', 'design', 'steps', 'plans', 'otherPlans', 'messages', 'project', 'title', 'schedules'], stale: ['otherTitle', 'by', 'pr', 'otherPr'] },
  { event: buildEvent, cancel: ['todos', 'tasks', 'todo', 'design', 'steps', 'build', 'plans', 'changes', 'messages', 'project', 'pr'], stale: ['otherPr'] },
  { event: step, cancel: ['todo', 'steps', 'build', 'plans', 'otherPlans', 'changes', 'usage', 'messages'] },
  { event: message, cancel: ['todo', 'plans', 'otherPlans', 'messages', 'source', 'target'] },
  { event: { type: 'notification', teamId: TEAM }, cancel: ['notifications', 'chiefThreads', 'chief'] },
  { event: { type: 'machine_presence', teamId: TEAM }, cancel: ['machines', 'computers', 'routing'] },
  { event: { type: 'computer.state', teamId: TEAM }, cancel: ['computers'] },
];

test.each(cases)('$event.type event × query key', ({ event, cancel, stale = [] }) => {
  for (const name of Object.keys(keys) as Key[]) {
    const expected = cancel.includes(name) ? 'cancel' : stale.includes(name) ? 'stale' : 'ignore';
    expect(streamEventQueryEffect(event, keys[name]), name).toBe(expected);
  }
});

test.each([
  ['project reassignment', { ...todoEvent, previous: { ...doc, projectId: 'project-old' } }, ['projectBuilds', 'project-old'], undefined, 'cancel'],
  ['unrelated project, no cached parent', { ...buildEvent, parent: undefined }, ['projectBuilds', 'project-b'], undefined, 'ignore'],
  ['related project, no cached parent', { ...buildEvent, parent: undefined }, ['projectBuilds', 'project-a'], undefined, 'cancel'],
  ['older frame, possible project', { ...buildEvent, parent: undefined, projectId: undefined }, ['projectBuilds', 'project-b'], undefined, 'stale'],
  ['older frame, known project result', { ...buildEvent, parent: undefined, projectId: undefined }, ['projectBuilds', 'project-a'], [build], 'cancel'],
  ['proved unrelated title', { ...todoEvent, previous: doc }, ['search', 'unrelated'], undefined, 'ignore'],
  ['new task cannot have an earlier title', { ...todoEvent, doc: { ...doc, v: 1 } }, ['search', 'unrelated'], undefined, 'ignore'],
  ['renamed out of the result', todoEvent, ['search', 'old title'], { todos: [{ id: doc.id }] }, 'cancel'],
  ['prior title matches', { ...todoEvent, previous: { ...doc, title: 'old title' } }, ['search', 'old title'], undefined, 'cancel'],
  ['status and title match', todoEvent, ['search', 'is:review RELEASE'], undefined, 'cancel'],
  ['status and title exclude', { ...todoEvent, previous: doc }, ['search', 'is:running release'], undefined, 'ignore'],
  ['known title excludes build owner', buildEvent, ['search', 'pr:any unrelated'], undefined, 'ignore'],
  ['invalid positive filter', todoEvent, ['search', 'pr:none'], undefined, 'ignore'],
  ['other team', todoEvent, ['todos', 'team-b'], undefined, 'ignore'],
  ['other todo', todoEvent, ['todo', 'todo-b'], undefined, 'ignore'],
  ['other conversation', step, ['steps', 'build-b'], undefined, 'ignore'],
  ['Coordinator terminal', { ...step, conversationId: 'chief-a' }, ['chief', TEAM, 'chief-a'], undefined, 'cancel'],
  ['Coordinator terminal refreshes other channel settings', { ...step, conversationId: 'chief-a' }, ['chief', TEAM, 'chief-b'], undefined, 'cancel'],
  ['Coordinator claim', { ...step, conversationId: 'chief-a', status: 'claimed' }, ['messages', 'chief-a', 'pages'], undefined, 'cancel'],
  ['Coordinator saved question', { ...message, conversationId: 'chief-a', targetId: 'chief-a' }, ['tasks', TEAM], undefined, 'cancel'],
  ['reconnect', { type: 'reconnect' }, ['session'], undefined, 'cancel'],
  ['reconcile search', { type: 'reconcile', teamId: TEAM }, ['search', 'release'], undefined, 'cancel'],
  ['reconcile ignores session', { type: 'reconcile', teamId: TEAM }, ['session'], undefined, 'ignore'],
] as const)('%s', (_scenario, event, key, data, expected) => {
  expect(streamEventQueryEffect(event, key, data)).toBe(expected);
});
