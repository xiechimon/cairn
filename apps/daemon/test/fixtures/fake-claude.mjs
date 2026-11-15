#!/usr/bin/env node
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { join } from 'node:path';

const args = process.argv.slice(2);
if (args.includes('--version')) {
  console.log('2.1.325 (Claude Code)');
  process.exit(0);
}
if (args[0] === 'auth') {
  console.log(JSON.stringify({ loggedIn: false, authMethod: 'none', apiProvider: 'firstParty' }));
  process.exit(0);
}

const sha = (text) => createHash('sha256').update(text).digest('hex').slice(0, 12);
let token = process.env.CLAUDE_CODE_OAUTH_TOKEN ?? '';
let via = token === '' ? 'none' : 'env';
const fd = process.env.CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR;
if (fd !== undefined) {
  try {
    token = readFileSync(Number(fd), 'utf8');
    via = 'fd';
  } catch {
    via = 'fd-unreadable';
  }
}
const note = (line) => {
  if (process.env.FAKE_CLAUDE_LOG) appendFileSync(process.env.FAKE_CLAUDE_LOG, `${line}\n`);
};
if (args.includes('-p')) {
  if (token.includes('REVOKED')) {
    process.stderr.write('Failed to authenticate: invalid token\n');
    process.exit(1);
  }
  note(JSON.stringify({ verify: true, via, tokenSha: sha(token) }));
  console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'OK' }));
  process.exit(0);
}
const emit = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const sessionId = '00000000-0000-4000-8000-000000000001';
let handled = false;

createInterface({ input: process.stdin }).on('line', (line) => {
  if (line.trim() === '') return;
  const message = JSON.parse(line);
  if (message.type === 'control_request') {
    emit({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: message.request_id,
        response: {
          commands: [],
          output_style: 'default',
          available_output_styles: ['default'],
          models: [],
          account: {},
        },
      },
    });
    return;
  }
  if (message.type !== 'user' || handled) return;
  handled = true;
  const content = message.message?.content;
  const firstUserText =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content.map((block) => (typeof block?.text === 'string' ? block.text : '')).join('')
        : '';
  note(JSON.stringify({ firstUserText }));
  const marker = join(process.cwd(), 'fake-claude-edit.txt');
  writeFileSync(
    join(process.cwd(), 'plan.md'),
    '# Plan\nKind: fix\n\nContext: harmless probe.\nChanges: none beyond the marker file.\nEdge cases: none.\nVerification: `cat fake-claude-edit.txt` shows the marker line in fake-claude-edit.txt.\n',
  );
  writeFileSync(marker, `${JSON.stringify({ via, tokenSha: sha(token) })}\n`);
  note(JSON.stringify({ via, tokenSha: sha(token), cwd: process.cwd(), authToken: process.env.ANTHROPIC_AUTH_TOKEN ?? null, apiKey: process.env.ANTHROPIC_API_KEY ?? null }));
  emit({
    type: 'system',
    subtype: 'init',
    session_id: sessionId,
    cwd: process.cwd(),
    tools: [],
    model: 'claude-sonnet-5-5',
  });
  emit({
    type: 'assistant',
    session_id: sessionId,
    message: {
      id: 'msg_fake',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-5-5',
      content: [{ type: 'text', text: 'fake claude finished the task' }],
      usage: { input_tokens: 10, output_tokens: 5 },
    },
  });
  emit({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'fake claude finished the task',
    session_id: sessionId,
    duration_ms: 1,
    num_turns: 1,
    total_cost_usd: 0,
    usage: { input_tokens: 10, output_tokens: 5 },
    modelUsage: {
      'claude-sonnet-5-5': {
        inputTokens: 10,
        outputTokens: 5,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        costUSD: 0,
      },
    },
  });
});
