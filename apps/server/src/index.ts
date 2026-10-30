import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import pino from 'pino';
import { createApp } from './app.js';
import { BUNDLED_FORM } from './bundle-form.js';
import {
  attachmentsDirOf,
  backupStatusPathOf,
  loadConfig,
  logTokenAuthStartup,
  missingRequiredTokenError,
  reposDirOf,
  warnInsecureBind,
  warnTailscaleBind,
} from './config.js';
import { openDbWithHandle } from './db/client.js';
import { seed } from './db/seed.js';
import { createKeyfileSecretBox } from './lib/secret-box.js';
import { listenTailscaleSocket } from './lib/tailscale-socket.js';
import { ConversationStreamHub, TeamStreamHub } from './services/events.js';
import { killInFlightPick } from './services/fs-pick.js';
import { refreshingGithubFetch } from './services/github-connection.js';
import { MachineWakeHub } from './services/machine-wake-hub.js';
import { backfillMachineConcurrency, seedLocalMachine } from './services/machines.js';
import { backfillPersonas } from './services/personas.js';
import { loadOrCreateVapidKeys } from './services/push.js';
import {
  createScheduler,
  issueIntakeRunOf,
  schedulingRunOf,
  trajectoryExportRunOf,
  trajectoryOutcomeRunOf,
  trajectoryReflectCurateRunOf,
} from './services/scheduler.js';
import { backfillFixedTags } from './services/tags.js';
import { backfillTokenUsageCost } from './services/token-usage-cost.js';
import { startupMessage } from './startup-log.js';

const config = loadConfig();
const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  // pino-pretty cannot load its transport worker from a single-file bundle.
  ...(process.env.NODE_ENV === 'production' || BUNDLED_FORM
    ? {}
    : { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } } }),
});

const refusal = missingRequiredTokenError(config);
if (refusal !== null) {
  logger.fatal(refusal);
  process.exit(1);
}

const { db, close } = openDbWithHandle(config.dbPath, { legacyExportDir: config.homeDir });
const secretBox = createKeyfileSecretBox(config.keyfilePath);
const vapidKeys = loadOrCreateVapidKeys(
  config.vapidKeysPath,
  config.vapidSubject,
  config.webOrigin,
);
const seeded = seed(db);
seedLocalMachine(db, seeded.team.id);
backfillFixedTags(db);
backfillPersonas(db);
backfillTokenUsageCost(db);
const concurrencyBackfilled = backfillMachineConcurrency(db);
if (concurrencyBackfilled > 0) {
  logger.info(
    { machines: concurrencyBackfilled },
    'machine concurrency backfilled to recommendation',
  );
}
const hub = new TeamStreamHub();
const convHub = new ConversationStreamHub();
const machineHub = new MachineWakeHub();
const reposDir = reposDirOf(config);
mkdirSync(reposDir, { recursive: true });
const attachmentsDir = attachmentsDirOf(config);
mkdirSync(attachmentsDir, { recursive: true });
const githubFetch = refreshingGithubFetch(
  { db, box: secretBox, oauthClient: config.githubOauth },
  globalThis.fetch,
);
const app = createApp(
  {
    db,
    hub,
    machineHub,
    convHub,
    secretBox,
    vapidKeys,
    user: seeded.user,
    team: seeded.team,
    pingIntervalMs: config.pingIntervalMs,
    claimHoldMs: config.claimHoldMs,
    uploads: new Map(),
    enrollments: new Map(),
    oauthStates: new Map(),
    oauthClient: config.githubOauth,
    githubFetch,
    reposDir,
    attachmentsDir,
    backupStatusPath: backupStatusPathOf(config),
    skillsDir: config.skillsDir,
    skillSourcesPath: join(config.dataDir, 'skill-sources.json'),
    webDir: config.webDir,
    authToken: config.authToken,
    tailscaleUsers: config.tailscaleUsers,
    mcpConfigPath: config.mcpConfigPath,
    logger,
  },
  logger,
);

warnInsecureBind(logger, config);
warnTailscaleBind(logger, config);
logTokenAuthStartup(logger, config);

const scheduler = createScheduler(
  {
    db,
    hub,
    machineHub,
    user: seeded.user,
    vapidKeys,
    convHub,
    box: secretBox,
    reposDir,
    githubFetch,
    oauthClient: config.githubOauth,
  },
  { tickMs: config.schedulerTickMs, pushDigestTimes: config.pushDigestTimes },
  { attachmentsDir, logger },
  { githubFetch, logger },
  issueIntakeRunOf(config, { githubFetch, logger }),
  trajectoryOutcomeRunOf(config, { logger }),
  trajectoryExportRunOf(config, { logger }),
  trajectoryReflectCurateRunOf(config, {
    logger,
    config,
    model: process.env.CAIRN_REFLECTOR_MODEL ?? '',
    endpoint: {
      baseUrl: process.env.CAIRN_REFLECTOR_BASE_URL ?? '',
      apiKey: process.env.CAIRN_REFLECTOR_API_KEY ?? '',
    },
  }),
  schedulingRunOf(config, { githubFetch, logger }),
);
const tailscaleServer =
  config.tailscaleSocket === null ? null : await listenTailscaleSocket(app, config.tailscaleSocket);
scheduler.start();

const server = serve(
  {
    fetch: app.fetch,
    port: config.port,
    ...(config.host !== null ? { hostname: config.host } : {}),
  },
  (info) => {
    logger.info(
      { port: info.port, dataDir: config.dataDir, teamId: seeded.team.id },
      startupMessage(),
    );
  },
);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    scheduler.stop();
    killInFlightPick();
    server.close();
    tailscaleServer?.close();
    close();
    process.exit(0);
  });
}
