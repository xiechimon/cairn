import { describe, expect, it } from 'vitest';
import { mapChiefStream } from '../src/api/mappers.js';
import { streamForProject } from '../src/board/home-c.js';

const rows = [
  { id: 'u1', role: 'user' as const, content: 'Run the orb canary', createdAt: 1, projectId: 'relay' },
  { id: 'a1', role: 'assistant' as const, content: 'Round 7 is running.', createdAt: 2 },
  { id: 'u2', role: 'user' as const, content: 'Fold turns first', createdAt: 3, projectId: 'cairn' },
  { id: 'a2', role: 'assistant' as const, content: 'Started it.', createdAt: 4 },
  { id: 'u3', role: 'user' as const, content: 'Plan the week', createdAt: 5 },
];

describe('the global Coordinator conversation filtered by project', () => {
  it('user turns carry the project the server tagged them with', () => {
    const users = mapChiefStream(rows).filter((item) => item.kind === 'user');
    expect(users.map((item) => (item.kind === 'user' ? item.projectId : undefined))).toEqual([
      'relay',
      'cairn',
      null,
    ]);
  });

  it('a project keeps its own turns and the replies that follow them, nothing else', () => {
    const kept = streamForProject(mapChiefStream(rows), 'cairn');
    expect(kept.map((item) => ('text' in item ? item.text : item.kind))).toEqual([
      'Fold turns first',
      'robot',
    ]);
  });

  it('a pending question from an untagged turn stays visible under any project', () => {
    const stream = [
      { kind: 'user' as const, text: 'Plan the week', projectId: null },
      {
        kind: 'question' as const,
        requestId: 'q1',
        status: 'pending' as const,
        answers: null,
        questions: [{ header: 'h', question: 'Which first?', options: [{ label: 'A' }] }],
      },
    ];
    expect(streamForProject(stream, 'cairn').map((item) => item.kind)).toEqual(['question']);
  });

  it('no project keeps the whole conversation', () => {
    expect(streamForProject(mapChiefStream(rows), null)).toHaveLength(5);
  });
});
