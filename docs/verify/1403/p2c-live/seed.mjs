// Seeds a GitHub-form project on xiechimon/pacman (public, anonymous reads)
// for the isolated verify stack. Each spec is <phase>:<prNumber>; every todo
// gets one build carrying that PR, set as its current build (latestBuildId).
// Usage: node seed.mjs <db> building:1410 review:1415 ...
import { createRequire } from 'node:module';
const require = createRequire('/home/user/pacman/.claude/worktrees/p2/apps/server/package.json');
const Database = require('better-sqlite3');
const [db, ...specs] = process.argv.slice(2);
const sqlite = new Database(db);
const team = sqlite.prepare('select id from team limit 1').get();
const now = Date.now();
sqlite.prepare('insert into project (id, name, teamId, repoKind, githubRepo) values (?, ?, ?, ?, ?)')
  .run('proj-live', 'pacman-live', team.id, 'github', 'xiechimon/pacman');
let seq = (sqlite.prepare('select max(seqNum) as m from todo').get().m ?? 0) + 1;
for (const spec of specs) {
  const [phase, pr] = spec.split(':');
  const todoId = `todo-live-${phase}-${pr}`;
  const buildId = `build-live-${phase}-${pr}`;
  sqlite.prepare(
    'insert into todo (id, teamId, projectId, title, spec, phase, phaseAt, seqNum, assignment) values (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(todoId, team.id, 'proj-live', `${phase} on PR #${pr}`, '', phase, now, seq++, '{"plan":null,"build":null}');
  sqlite.prepare(
    'insert into build (id, todoId, withPlan, triggerSource, createdAt, prUrl, prNumber) values (?, ?, 0, ?, ?, ?, ?)',
  ).run(buildId, todoId, 'user', now - 60000, `https://github.com/xiechimon/pacman/pull/${pr}`, Number(pr));
  sqlite.prepare('update todo set latestBuildId = ? where id = ?').run(buildId, todoId);
}
console.log(JSON.stringify(sqlite.prepare("select t.id, t.phase, b.prNumber from todo t join build b on b.id = t.latestBuildId where t.projectId = 'proj-live' order by t.id").all()));
