import { createServer } from 'node:http';
import { join } from 'node:path';
import { createApp } from '../../apps/server/src/app.js';
import { openDbWithHandle } from '../../apps/server/src/db/client.js';
import { team, todo } from '../../apps/server/src/db/schema.js';
import { seed } from '../../apps/server/src/db/seed.js';
import { createEphemeralSecretBox } from '../../apps/server/src/lib/secret-box.js';
import { ConversationStreamHub, TeamStreamHub } from '../../apps/server/src/services/events.js';
import { MachineWakeHub } from '../../apps/server/src/services/machine-wake-hub.js';

console.error('api helper started');

const [home, mode] = process.argv.slice(2);
const dataDir = join(home, 'server');
const opened = openDbWithHandle(join(dataDir, 'server.db'));
const seeded = seed(opened.db);
const app = createApp({
  db: opened.db,
  ...seeded,
  hub: new TeamStreamHub(),
  convHub: new ConversationStreamHub(),
  machineHub: new MachineWakeHub(),
  secretBox: createEphemeralSecretBox(),
  vapidKeys: null,
  pingIntervalMs: 3600000,
  claimHoldMs: 250,
  uploads: new Map(),
  enrollments: new Map(),
  oauthStates: new Map(),
  oauthClient: null,
  authToken: null,
  tailscaleUsers: [],
  reposDir: join(dataDir, 'repos'),
  attachmentsDir: join(dataDir, 'attachments'),
  skillsDir: join(home, 'skills'),
  skillSourcesPath: join(home, 'skill-sources.json'),
  mcpConfigPath: join(home, 'mcp.json'),
});

if (mode === '--in-process-fixture') {
  let count = 0;
  for (const row of opened.db.select().from(team).all()) {
    const response = await app.request(`/api/todos?teamId=${encodeURIComponent(row.id)}`);
    if (response.status !== 200) throw new Error('fixture API response failed');
    const rows: unknown = await response.json();
    if (!Array.isArray(rows)) throw new Error('fixture API response shape failed');
    count += rows.length;
  }
  if (count !== opened.db.select().from(todo).all().length) {
    throw new Error('fixture API count mismatch');
  }
  console.log(
    JSON.stringify({
      count,
      surface: 'fixture real Hono route, in-process transport',
      provider: 'not exercised',
    }),
  );
  opened.close();
} else {
  const server = createServer(async (request, response) => {
    if (request.method !== 'GET' || !request.url?.startsWith('/api/todos?')) {
      response.writeHead(404).end();
      return;
    }
    try {
      const result = await app.request(`http://127.0.0.1${request.url}`);
      response.writeHead(result.status, { 'content-type': 'application/json' });
      response.end(await result.text());
    } catch {
      response.writeHead(500).end();
    }
  });
  server.on('error', (error) => {
    console.log(
      JSON.stringify({
        error: 'api listen failed',
        code: 'code' in error ? error.code : 'unknown',
      }),
    );
    opened.close();
    process.exitCode = 1;
  });
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (address && typeof address !== 'string') {
      console.log(JSON.stringify({ port: address.port, dataDir }));
    }
  });
  process.on('SIGTERM', () => {
    server.close();
    opened.close();
    process.exit(0);
  });
}
