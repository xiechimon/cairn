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
      undefined,
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

  it('a reply or report tagged with another project files under its own project, not the turn before it', () => {
    const interleaved = mapChiefStream([
      { id: 'u1', role: 'user', content: 'Fold turns first', createdAt: 1, projectId: 'cairn' },
      { id: 'r1', role: 'assistant', content: 'relay probe finished', createdAt: 2, projectId: 'relay' },
      { id: 'a1', role: 'assistant', content: 'Started it.', createdAt: 3, projectId: 'cairn' },
    ]);
    const text = (items: ReturnType<typeof mapChiefStream>) =>
      items.map((item) => ('markdown' in item ? item.markdown : 'text' in item ? item.text : item.kind));
    expect(text(streamForProject(interleaved, 'cairn'))).toEqual(['Fold turns first', 'Started it.']);
    expect(text(streamForProject(interleaved, 'relay'))).toEqual(['relay probe finished']);
  });

  it('background thread reports from two projects interleaved after one turn file under their own projects', () => {
    const report = (todoId: string, seqNum: number, title: string) =>
      JSON.stringify({ kind: 'thread-report', todoId, phase: 'done', seqNum, title });
    const stream = mapChiefStream([
      { id: 'u1', role: 'user', content: 'Fold turns first', createdAt: 1, projectId: 'cairn' },
      { id: 'r1', role: 'system', content: report('todo-relay', 74, 'Relay probe'), createdAt: 2, projectId: 'relay' },
      { id: 'r2', role: 'system', content: report('todo-cairn', 2271, 'Fold turns'), createdAt: 3, projectId: 'cairn' },
      { id: 'r3', role: 'system', content: report('todo-relay-2', 75, 'Orb canary'), createdAt: 4, projectId: 'relay' },
    ]);
    const reports = (projectId: string) =>
      streamForProject(stream, projectId).flatMap((item) =>
        item.kind === 'thread-report' ? [item.title] : [],
      );
    expect(reports('cairn')).toEqual(['Fold turns']);
    expect(reports('relay')).toEqual(['Relay probe', 'Orb canary']);
  });

  it('a server that tags no rows leaves the conversation unfiltered instead of empty', () => {
    const untagged = mapChiefStream([
      { id: 'u1', role: 'user', content: 'Plan the week', createdAt: 1 },
      { id: 'a1', role: 'assistant', content: 'On it.', createdAt: 2 },
    ]);
    expect(streamForProject(untagged, 'cairn')).toHaveLength(2);
  });

  it('no project keeps the whole conversation', () => {
    expect(streamForProject(mapChiefStream(rows), null)).toHaveLength(5);
  });
});
