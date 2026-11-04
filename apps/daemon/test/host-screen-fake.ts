import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import {
  AgentDesktopHostScreen,
  type AgentDesktopHostScreenOptions,
  type ScreenCall,
} from '../src/computer/host-screen.js';
import { encodePng } from '../src/computer/host-screen-png.js';

export const FIXTURES = path.join(import.meta.dirname, 'fixtures', 'agent-desktop');

export interface FakeRule {
  command: string;
  has?: string[];
  fixture?: string;
  stdout?: string;
  replace?: Record<string, string>;
  exit?: number;
  delayMs?: number;
  floodBytes?: number;
  override?: (fixture: unknown) => unknown;
}

const SCRIPT = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const scenario = JSON.parse(fs.readFileSync(path.join(__dirname, 'scenario.json'), 'utf8'));
const argv = process.argv.slice(2);
fs.appendFileSync(
  path.join(__dirname, 'calls.log'),
  JSON.stringify({ argv, home: process.env.AGENT_DESKTOP_HOME, env: Object.keys(process.env) }) + '\\n',
);
const rule = scenario.rules.find(
  (candidate) =>
    candidate.command === argv[0] && (candidate.has ?? []).every((token) => argv.includes(token)),
);
const finish = () => {
  if (!rule) {
    process.stdout.write(JSON.stringify({ version: '2.6', ok: false, command: argv[0], error: { code: 'INVALID_ARGS', message: 'no scenario rule', disposition: { delivery: 'not_delivered', retry: 'safe' } } }));
    process.exit(1);
  }
  if (rule.floodBytes) process.stdout.write('x'.repeat(rule.floodBytes));
  let body = rule.stdout ?? (rule.fixture ? fs.readFileSync(path.join(scenario.fixtures, rule.fixture + '.json'), 'utf8') : '');
  for (const [from, to] of Object.entries(rule.replace ?? {})) body = body.split(from).join(to);
  process.stdout.write(body);
  process.exit(rule.exit ?? JSON.parse(body || '{"ok":true}').ok === false ? 1 : 0);
};
setTimeout(finish, rule?.delayMs ?? 0);
`;

export interface FakeScreen {
  screen: AgentDesktopHostScreen;
  dir: string;
  binary: string;
  calls(): { argv: string[]; home: string; env: string[] }[];
  commands(): string[];
  cleanup(): void;
}

export function fakeScreen(
  rules: FakeRule[],
  options: Partial<AgentDesktopHostScreenOptions> = {},
): FakeScreen {
  const dir = makeTestTempDir('screen-');
  const binary = path.join(dir, 'agent-desktop');
  writeFileSync(binary, SCRIPT);
  chmodSync(binary, 0o755);
  const resolved = rules.map(({ override, fixture, ...rule }) => {
    if (!override || !fixture) return { ...rule, ...(fixture ? { fixture } : {}) };
    const parsed = JSON.parse(readFileSync(path.join(FIXTURES, `${fixture}.json`), 'utf8'));
    return { ...rule, stdout: JSON.stringify(override(parsed)) };
  });
  writeFileSync(
    path.join(dir, 'scenario.json'),
    JSON.stringify({ fixtures: FIXTURES, rules: resolved }),
  );
  const screen = new AgentDesktopHostScreen({
    binary,
    stateDir: path.join(dir, 'state'),
    env: { PATH: process.env.PATH, HOME: dir },
    isOwnProcess: async () => false,
    ...options,
  });
  const calls = () => {
    try {
      return readFileSync(path.join(dir, 'calls.log'), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    } catch {
      return [];
    }
  };
  return {
    screen,
    dir,
    binary,
    calls,
    commands: () => calls().map((call) => call.argv[0]),
    cleanup: () => {
      releaseTestTempDir(dir);
    },
  };
}

export function call(params: Record<string, unknown>, overrides: Partial<ScreenCall> = {}) {
  return {
    params,
    deadlineAt: Date.now() + 60_000,
    signal: new AbortController().signal,
    ...overrides,
  } satisfies ScreenCall;
}

export function solidPng(
  width: number,
  height: number,
  rgb: [number, number, number] = [10, 20, 30],
) {
  const pixels = Buffer.alloc(width * height * 3);
  for (let index = 0; index < width * height; index += 1) {
    pixels[index * 3] = rgb[0];
    pixels[index * 3 + 1] = rgb[1];
    pixels[index * 3 + 2] = rgb[2];
  }
  return encodePng(width, height, 2, pixels);
}

export function noisePng(width: number, height: number) {
  const pixels = Buffer.alloc(width * height * 3);
  let seed = 12345;
  for (let index = 0; index < pixels.length; index += 1) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    pixels[index] = seed >> 16;
  }
  return encodePng(width, height, 2, pixels);
}

export function filteredPng(width: number, height: number, pixels: Buffer, filters: number[]) {
  const channels = 3;
  const stride = width * channels;
  const rows: Buffer[] = [];
  for (let row = 0; row < height; row += 1) {
    const filter = filters[row % filters.length] ?? 0;
    const line = Buffer.alloc(stride + 1);
    line[0] = filter;
    for (let index = 0; index < stride; index += 1) {
      const value = pixels[row * stride + index] ?? 0;
      const left = index >= channels ? (pixels[row * stride + index - channels] ?? 0) : 0;
      const up = row > 0 ? (pixels[(row - 1) * stride + index] ?? 0) : 0;
      const upLeft =
        row > 0 && index >= channels ? (pixels[(row - 1) * stride + index - channels] ?? 0) : 0;
      const estimate = left + up - upLeft;
      const [nearLeft, nearUp, nearCorner] = [left, up, upLeft].map((candidate) =>
        Math.abs(estimate - candidate),
      ) as [number, number, number];
      const paeth =
        nearLeft <= nearUp && nearLeft <= nearCorner ? left : nearUp <= nearCorner ? up : upLeft;
      const predicted = [0, left, up, (left + up) >> 1, paeth][filter] ?? 0;
      line[index + 1] = (value - predicted) & 0xff;
    }
    rows.push(line);
  }
  const chunk = (type: string, body: Buffer) => {
    const out = Buffer.alloc(12 + body.length);
    out.writeUInt32BE(body.length, 0);
    out.write(type, 4, 'latin1');
    body.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
