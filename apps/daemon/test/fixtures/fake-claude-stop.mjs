#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const args = process.argv.slice(2);
if (args.includes('--version')) {
  console.log('2.1.325 (Claude Code)');
  process.exit(0);
}

const mode = process.env.FAKE_STOP_MODE ?? 'work';
const sessionId = '00000000-0000-4000-8000-000000000002';
const emit = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const keepAlive = setInterval(() => {}, 1000);
if (mode === 'stubborn') process.on('SIGTERM', () => {});

const answer = (message, response) =>
  emit({
    type: 'control_response',
    response: { subtype: 'success', request_id: message.request_id, response },
  });

let started = false;
const lines = createInterface({ input: process.stdin });
lines.on('line', (line) => {
  if (line.trim() === '') return;
  const message = JSON.parse(line);
  if (message.type === 'control_request') {
    if (message.request?.subtype === 'initialize') {
      answer(message, {
        commands: [],
        output_style: 'default',
        available_output_styles: ['default'],
        models: [],
        account: {},
      });
      return;
    }
    answer(message, {});
    return;
  }
  if (message.type !== 'user' || started) return;
  started = true;
  const background = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    detached: true,
    stdio: 'ignore',
  });
  background.unref();
  writeFileSync(
    process.env.FAKE_STOP_PIDS,
    JSON.stringify({ cli: process.pid, background: background.pid }),
  );
  emit({ type: 'system', subtype: 'init', session_id: sessionId, cwd: process.cwd(), tools: [] });
  emit({
    type: 'system',
    subtype: 'task_started',
    task_id: 'bash-1',
    task_type: 'local_bash',
    is_backgrounded: true,
    description: 'dev server',
    session_id: sessionId,
  });
  emit({
    type: 'assistant',
    session_id: sessionId,
    message: {
      id: 'msg_stop',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-5-5',
      content: [{ type: 'text', text: 'Started the dev server in the background.' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    },
  });
  if (mode !== 'finish') return;
  emit({
    type: 'system',
    subtype: 'task_notification',
    task_id: 'bash-1',
    status: 'completed',
    session_id: sessionId,
  });
  emit({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'done',
    session_id: sessionId,
    duration_ms: 1,
    num_turns: 1,
    total_cost_usd: 0,
    usage: { input_tokens: 1, output_tokens: 1 },
  });
});
lines.on('close', () => {
  if (mode === 'stubborn') return;
  setTimeout(() => {
    clearInterval(keepAlive);
    process.exit(0);
  }, 300);
});
