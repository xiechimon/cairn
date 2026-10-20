// Prints the seeded todos, their builds and their system rows.
import { createRequire } from 'node:module';
const require = createRequire('/home/user/pacman/.claude/worktrees/p2/apps/server/package.json');
const Database = require('better-sqlite3');
const sqlite = new Database(process.argv[2], { readonly: true });
const rows = sqlite.prepare("select t.id, t.phase, b.id as buildId, b.prNumber, b.errorMessage from todo t join build b on b.todoId = t.id where t.projectId = 'proj-live' order by t.id").all();
for (const r of rows) {
  const msgs = sqlite.prepare("select role, content from message where conversationId = ? and role = 'system' order by createdAt").all(r.buildId);
  console.log(JSON.stringify({ todo: r.id, phase: r.phase, pr: r.prNumber, errorMessage: r.errorMessage, systemRows: msgs.map((m) => m.content) }));
}
