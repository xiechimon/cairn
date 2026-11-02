import { boardDefault } from './board.js';
import { chiefDefault } from './chief.js';
import { PROJECT_ID, probeTodo, r7 } from './core.js';
import type { ChiefContent, FixtureSet, TodoRecord } from './records.js';

export const HOME_C_CRED = 'home-c-cred';

function homeTodo(
  id: string,
  seqNum: number,
  title: string,
  phase: TodoRecord['phase'],
  projectId: string,
): TodoRecord {
  return { ...probeTodo(phase, r7(20, 10)), id, seqNum, title, spec: title, projectId };
}

const conversation: ChiefContent = {
  ...chiefDefault,
  view: 'none',
  bound: true,
  threadTitle: 'Coordinator',
  threadId: 'chief-global',
  examples: undefined,
  stream: [
    {
      kind: 'user',
      id: 'home-c-ask-orb',
      text: 'Run the orb canary until it passes, then send the first real ticket through cairn.',
      projectId: HOME_C_CRED,
    },
    {
      kind: 'robot',
      id: 'home-c-reply-orb',
      seconds: '',
      paragraphs: [[{ text: 'Round 6 found no /work in the orb; fixed, round 7 is running.' }]],
    },
    {
      kind: 'question',
      id: 'home-c-question',
      requestId: 'home-c-q1',
      status: 'pending',
      answers: null,
      questions: [
        {
          header: 'Credential relay · #74',
          question: 'relay-186 cannot run glm-5.3-flash. Which model should rerun it?',
          options: [
            {
              label: 'Claude subscription (recommended)',
              description: 'Verified, uses the subscription',
            },
            { label: 'wokey · deepseek-v4.1-flash', description: 'Metered' },
            { label: 'Hold it', description: '' },
          ],
        },
      ],
    },
    {
      kind: 'user',
      id: 'home-c-ask-fold',
      text: 'Fold finished turns before review.',
      projectId: PROJECT_ID,
    },
    {
      kind: 'robot',
      id: 'home-c-reply-fold',
      seconds: '',
      paragraphs: [[{ text: 'Started it; the PR is up for your review.' }]],
    },
  ],
  streamAt: [r7(20, 0), r7(20, 1), r7(20, 1), r7(20, 5), r7(20, 6)],
};

export const homeC: FixtureSet = {
  ...boardDefault,
  projectNames: { [PROJECT_ID]: 'cairn', [HOME_C_CRED]: 'Credential relay' },
  todos: [
    homeTodo('home-c-confirm', 2301, 'Connect a Claude subscription token', 'confirm', PROJECT_ID),
    homeTodo('home-c-failed', 74, 'Rerun the relay probe', 'failed', HOME_C_CRED),
    homeTodo(
      'home-c-review',
      2271,
      'Fold finished turns into purpose and duration',
      'review',
      PROJECT_ID,
    ),
    homeTodo('home-c-working-a', 2302, 'Push for finished threads', 'building', PROJECT_ID),
    homeTodo('home-c-working-b', 2303, 'Serif greeting fix', 'planning', PROJECT_ID),
    homeTodo('home-c-working-c', 75, 'Orb canary round 7', 'building', HOME_C_CRED),
    homeTodo('home-c-idle', 2240, 'Sidebar status groups', 'todo', PROJECT_ID),
    homeTodo('home-c-done', 2201, 'Unread dot on threads', 'done', PROJECT_ID),
  ],
  chief: conversation,
  now: r7(20, 30),
};

export const homeCEmpty: FixtureSet = {
  ...boardDefault,
  projectNames: { [PROJECT_ID]: 'cairn' },
  todos: [],
  chief: { ...conversation, stream: [], streamAt: [] },
  now: r7(9, 0),
};
