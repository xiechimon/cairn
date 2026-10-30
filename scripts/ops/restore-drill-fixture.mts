import { openDbWithHandle } from '../../apps/server/src/db/client.js';
import {
  build,
  chiefMessage,
  chiefThread,
  project,
  step,
  team,
  todo,
} from '../../apps/server/src/db/schema.js';
import { seed } from '../../apps/server/src/db/seed.js';
import { createKeyfileSecretBox } from '../../apps/server/src/lib/secret-box.js';
import { upsertMessage } from '../../apps/server/src/services/machine-deps.js';

const [dbPath, keyPath] = process.argv.slice(2);
const opened = openDbWithHandle(dbPath);
seed(opened.db);
const db = opened.db;
const seededTeam = db.select().from(team).get();
if (!seededTeam) throw new Error('Missing seeded team');
const teamId = seededTeam.id;

console.log(createKeyfileSecretBox(keyPath).seal('fixture plaintext must stay private'));
db.insert(project).values({ id: 'p', name: 'Project', teamId }).run();
db.insert(todo)
  .values({ id: 't', teamId, projectId: 'p', title: 'Task', phaseAt: 1, seqNum: 1 })
  .run();
const buildRow = db
  .insert(build)
  .values({ id: 'b', todoId: 't', withPlan: false, triggerSource: 'user', createdAt: 1 })
  .returning()
  .get();
db.insert(step).values({ id: 's', buildId: buildRow.id, kind: 'build', createdAt: 1 }).run();
upsertMessage(
  { db },
  { id: 'm', conversationId: buildRow.id, role: 'user', content: 'original', createdAt: 1 },
);
const thread = db
  .insert(chiefThread)
  .values({
    id: 'chief-ct',
    chiefId: 'c',
    userId: 'u',
    teamId,
    title: 'Thread',
    createdAt: 1,
    updatedAt: 1,
    sessionId: 'session',
    sessionOpenedAt: 1,
  })
  .returning()
  .get();
db.insert(chiefMessage)
  .values({ id: 'cm', threadId: thread.id, role: 'user', content: 'hello', createdAt: 1 })
  .run();
opened.close();
