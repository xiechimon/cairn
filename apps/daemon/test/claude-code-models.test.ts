// readClaudeCodeReport 对拍（#707 daemon 侧读数）：读本机
// ~/.claude/settings.json → presence/enroll 上报载荷。文件缺失/不可读 →
// installed:false（不抛，上线序列不被上报阻断）。

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { readClaudeCodeReport } from '../src/claude-code-models.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tmpHome(settingsJson?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'cairn-daemon-cc-'));
  dirs.push(dir);
  if (settingsJson !== undefined) {
    mkdirSync(join(dir, '.claude'), { recursive: true });
    writeFileSync(join(dir, '.claude', 'settings.json'), settingsJson);
  }
  return dir;
}

describe('readClaudeCodeReport', () => {
  test('settings.json 缺失 → installed:false + models 空（不抛）', () => {
    expect(readClaudeCodeReport(tmpHome())).toEqual({
      installed: false,
      hostname: hostname(),
      models: [],
    });
  });

  test('model + env 槽解析（shared 槽位语义同源）', () => {
    const report = readClaudeCodeReport(
      tmpHome(
        JSON.stringify({
          model: 'claude-opus-4-5',
          env: { ANTHROPIC_OPUS_MODEL: 'claude-opus-4-1' },
        }),
      ),
    );
    expect(report).toEqual({
      installed: true,
      hostname: hostname(),
      models: [
        { id: 'claude-opus-4-5', name: 'claude-opus-4-5', slot: 'default' },
        { id: 'claude-opus-4-1', name: 'claude-opus-4-1', slot: 'opus' },
      ],
    });
  });

  test('非法 JSON → installed:false（不抛）', () => {
    const report = readClaudeCodeReport(tmpHome('{ not json'));
    expect(report.installed).toBe(false);
    expect(report.models).toEqual([]);
  });
});
