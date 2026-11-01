import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { estimateTokens } from './assemble.mts';
import type { FixtureTurn } from './fixture.mts';

function piUsage(input: number, total: number) {
  return {
    input,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: total,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

export function writeSession(
  path: string,
  cwd: string,
  turns: readonly FixtureTurn[],
  preamble: string | null,
  model: { provider: string; id: string },
) {
  const lines: unknown[] = [];
  let parentId: string | null = null;
  let t = Date.parse('2026-10-01T00:00:00Z');
  let context = 0;
  const push = (message: Record<string, unknown>) => {
    const id = randomUUID().slice(0, 8);
    t += 1000;
    lines.push({
      type: 'message',
      id,
      parentId,
      timestamp: new Date(t).toISOString(),
      message: { ...message, timestamp: t },
    });
    parentId = id;
  };
  const assistant = (content: unknown[], stopReason: string, added: number) => {
    context += added;
    push({
      role: 'assistant',
      content,
      api: 'anthropic-messages',
      provider: model.provider,
      model: model.id,
      usage: piUsage(context, context),
      stopReason,
    });
  };
  lines.push({
    type: 'session',
    version: 3,
    id: randomUUID(),
    timestamp: new Date(t).toISOString(),
    cwd,
  });
  if (preamble !== null) {
    context += estimateTokens(preamble);
    push({ role: 'user', content: [{ type: 'text', text: preamble }] });
  }
  for (const turn of turns) {
    context += estimateTokens(turn.user);
    push({ role: 'user', content: [{ type: 'text', text: turn.user }] });
    for (const tool of turn.tools) {
      assistant(
        [{ type: 'toolCall', id: tool.id, name: tool.name, arguments: tool.arguments }],
        'toolUse',
        estimateTokens(JSON.stringify(tool.arguments)),
      );
      context += estimateTokens(tool.result);
      push({
        role: 'toolResult',
        toolCallId: tool.id,
        toolName: tool.name,
        content: [{ type: 'text', text: tool.result }],
        isError: false,
      });
    }
    if (turn.reply !== '')
      assistant([{ type: 'text', text: turn.reply }], 'stop', estimateTokens(turn.reply));
  }
  writeFileSync(path, `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
}
