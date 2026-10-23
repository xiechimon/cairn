// #1406 P5-3：Implementer 档案点名本仓的技能（spec 28 §4 P5「仓规内化」）。
// 失败方式（docs/verify/1406/p5-3-failure-modes.txt）：
//   F11 播种落库的档案超过 agent.description 长度闸（PATCH 回不来的行）
//   F12 档案点名的技能在本仓 .claude/skills/<name>/SKILL.md 不存在——agent 在
//       daemon worktree 里照着名字找不到技能
// 读仓库文件，故不放 packages/shared 的单测（那里没有 node 类型）。

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENT_DESC_MAX_LENGTH } from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { agent as agentTable } from '../src/db/schema.js';
import { ensurePersonasSeeded } from '../src/services/personas.js';
import { bootServer } from './helpers.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('Implementer 档案点名的技能（#1406 P5-3）', () => {
  test('F11/F12：播种落库的 Implementer 职责文本在长度闸内，点名的 *-cairn 技能都在本仓', () => {
    const s = bootServer();
    try {
      ensurePersonasSeeded(s.db, s.team.id);
      const row = s.db
        .select({ description: agentTable.description })
        .from(agentTable)
        .where(and(eq(agentTable.teamId, s.team.id), eq(agentTable.persona, 'implementer')))
        .get();
      const description = row?.description ?? '';
      expect(description.length).toBeLessThanOrEqual(AGENT_DESC_MAX_LENGTH);
      const named = [...new Set(description.match(/\b[a-z][a-z0-9]*(?:-[a-z0-9]+)*-cairn\b/g))];
      expect(named).toEqual(expect.arrayContaining(['pr-cairn', 'verify-cairn']));
      for (const name of named) {
        expect(existsSync(join(REPO_ROOT, '.claude', 'skills', name, 'SKILL.md')), name).toBe(true);
      }
    } finally {
      s.dispose();
    }
  });
});
