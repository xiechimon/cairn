// Seeds a GitHub-form project on xiechimon/pacman (public, anonymous reads)
// with two todos for the isolated verify stack: one building on PR A, one in
// review on an already merged PR B. Usage: node seed.mjs <db> <openPr> <mergedPr>
import { createRequire } from 'node:module';
const require = createRequire('/home/user/pacman/.claude/worktrees/p2/apps/server/package.json');
const Database = require('better-sqlite3');
const [db, openPr, mergedPr] = process.argv.slice(2);
const sqlite = new Database(db);
const team = sqlite.prepare('select id from team limit 1').get();
const now = Date.now();
sqlite.prepare('insert into project (id, name, teamId, repoKind, githubRepo) values (?, ?, ?, ?, ?)')
  .run('proj-live', 'pacman-live', team.id, 'github', 'xiechimon/pacman');
const seq = (sqlite.prepare('select max(seqNum) as m from todo').get().m ?? 0) + 1;
const todo = sqlite.prepare(
  'insert into todo (id, teamId, projectId, title, spec, phase, phaseAt, seqNum, assignment) values (?, ?, ?, ?, ?, ?, ?, ?, ?)',
);
const build = sqlite.prepare(
  'insert into build (id, todoId, withPlan, triggerSource, createdAt, prUrl, prNumber) values (?, ?, 0, ?, ?, ?, ?)',
);
todo.run('todo-live-grind', team.id, 'proj-live', `grind on PR #${openPr}`, '', 'building', now, seq, '{"plan":null,"build":null}');
build.run('build-live-grind', 'todo-live-grind', 'user', now - 60000, `https://github.com/xiechimon/pacman/pull/${openPr}`, Number(openPr));
todo.run('todo-live-merged', team.id, 'proj-live', `review on PR #${mergedPr}`, '', 'review', now, seq + 1, '{"plan":null,"build":null}');
build.run('build-live-merged', 'todo-live-merged', 'user', now - 60000, `https://github.com/xiechimon/pacman/pull/${mergedPr}`, Number(mergedPr));
console.log(JSON.stringify(sqlite.prepare("select t.id, t.phase, b.prNumber from todo t join build b on b.todoId = t.id where t.projectId = 'proj-live'").all()));
