#!/usr/bin/env -S pnpm exec tsx
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { user as userTable } from '../../../apps/server/src/db/schema.js';
import type { RosterAgent } from './grade.mts';
import { bootStack, resolveFromRoot, seedWorld } from './stack.mts';

const FLOW = process.argv[2] ?? '.claude/hillclimb/chief-dispatch';
const FLOW_DIR = resolveFromRoot(FLOW);
const d = JSON.parse(readFileSync(join(FLOW_DIR, 'cases.json'), 'utf8')) as {
  roster: RosterAgent[];
};

const stack = await bootStack();
try {
  const world = await seedWorld(stack, {
    relayBaseUrl: 'http://127.0.0.1:9/v1',
    relayKey: 'unused',
    roster: d.roster,
    chiefModelId: 'glm-5.3',
  });
  const bare = join(stack.server.reposDir, stack.server.teamId, 'eval-project.git');
  const git = (...args: string[]) => {
    const r = spawnSync('git', args, { encoding: 'utf8' });
    return { out: r.stdout ?? '', err: r.stderr ?? '', code: r.status };
  };
  console.log(`裸仓: ${bare}`);
  console.log('\n=== 分支 ===');
  console.log(git('--git-dir', bare, 'branch', '-a').out.trim() || '(无分支)');
  console.log('\n=== main 的完整文件树 ===');
  const ls = git('--git-dir', bare, 'ls-tree', '-r', '--name-only', 'main');
  console.log(ls.out.trim() || '(空树)');
  console.log(`\n提交历史:`);
  console.log(git('--git-dir', bare, 'log', '--oneline', '--all').out.trim() || '(无提交)');
  console.log(`\n文件数 ${ls.out.trim() ? ls.out.trim().split('\n').length : 0}`);

  const { composeChiefSystemPrompt } = await import('../../../apps/server/src/services/chief.ts');
  const userRow = stack.server.db.select().from(userTable).all()[0];
  if (userRow === undefined) throw new Error('seed 的用户行缺失');
  console.log('\n=== chief 系统提示词 ===');
  console.log(
    composeChiefSystemPrompt(
      { db: stack.server.db, hub: {} as never, user: userRow, skillsDir: stack.skillsDir },
      stack.server.teamId,
    ),
  );
  void world;
} finally {
  await stack.close();
}
process.exit(0);
