#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { bannedModelFromLog } from './lane-model-policy.mjs';

const USAGE = `Usage:
  node scripts/lane-worker-exit-gate.mjs --log <path> --rc <n> --duration-s <n>

Classifies an overnight / dispatch lane exit. Exit 0 only when the run looks
like real work completed. Negative controls from issue #2021:
  - ai-route selected banned deepseek-v4-flash
  - rc 0 after ~55s with a Chinese no-op wrap-up (no commit / no PR / no server)`;

const NOOP_PATTERNS = [
  /本轮未改动/,
  /未提交[、,，]?\s*未推送/,
  /未启动服务器/,
  /\bno changes this round\b/i,
  /\bdid not (commit|push|open a pr)\b/i,
  /\bno pr (was )?opened\b/i,
];

const SHORT_NOOP_SECONDS = 180;

export function classifyLaneExit({ log, rc, durationSeconds }) {
  const text = String(log ?? '');
  const banned = bannedModelFromLog(text);
  if (banned) {
    return {
      ok: false,
      code: 'banned-model',
      reason: `banned model ${banned.modelId} via ${banned.route} (task ${banned.task})`,
    };
  }

  const code = Number(rc);
  if (!Number.isInteger(code)) {
    return { ok: false, code: 'bad-rc', reason: `rc is not an integer: ${rc}` };
  }
  if (code !== 0) {
    return { ok: false, code: 'nonzero-rc', reason: `process exited ${code}` };
  }

  const duration = Number(durationSeconds);
  const short =
    Number.isFinite(duration) && duration >= 0 && duration < SHORT_NOOP_SECONDS;
  if (short && NOOP_PATTERNS.some((pattern) => pattern.test(text))) {
    return {
      ok: false,
      code: 'noop-exit',
      reason: `rc 0 after ${duration}s with a no-op wrap-up (threshold ${SHORT_NOOP_SECONDS}s)`,
    };
  }

  const last = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);
  if (short && last && /^ai-route:\s+\S+\s+->\s+\S+/.test(last)) {
    return {
      ok: false,
      code: 'route-only-exit',
      reason: `rc 0 after ${duration}s and the log ends on an ai-route selection line`,
    };
  }

  return { ok: true, code: 'ok', reason: 'lane exit looks complete' };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === '--log' || key === '--rc' || key === '--duration-s') {
      out[key.slice(2)] = argv[++i];
    } else if (key === '--help' || key === '-h') {
      out.help = true;
    } else {
      out.unknown = key;
    }
  }
  return out;
}

function main(argv) {
  const args = parseArgs(argv);
  if (args.help || args.unknown || !args.log || args.rc === undefined || args['duration-s'] === undefined) {
    console.error(USAGE);
    if (args.unknown) console.error(`unknown argument: ${args.unknown}`);
    process.exit(2);
  }
  let log;
  try {
    log = readFileSync(args.log, 'utf8');
  } catch (error) {
    console.error(`lane-worker-exit-gate: cannot read log: ${error.message}`);
    process.exit(2);
  }
  const result = classifyLaneExit({
    log,
    rc: Number(args.rc),
    durationSeconds: Number(args['duration-s']),
  });
  const line = `lane-worker-exit-gate: ${result.code}: ${result.reason}`;
  if (result.ok) {
    console.log(line);
    process.exit(0);
  }
  console.error(line);
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
