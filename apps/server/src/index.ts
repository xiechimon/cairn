import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import pino from 'pino';
import { createApp } from './app.js';
import { BUNDLED_FORM } from './bundle-form.js';
import {
  attachmentsDirOf,
  authStartupRefusal,
  backupStatusPathOf,
  deployRecordPathOf,
  ensureAccessToken,
  loadConfig,
  logTokenAuthStartup,
  reposDirOf,
  warnIgnoredTailscaleUsers,
  warnInsecureBind,
} from './config.js';
import { openDbWithHandle } from './db/client.js';
import { seed } from './db/seed.js';
import { environmentIdPathOf, loadOrCreateEnvironmentId } from './lib/environment-id.js';
import { createKeyfileSecretBox } from './lib/secret-box.js';
import { computerScreensOf } from './services/computer-screen.js';
import {
  setCoordinatorMachineId,
  setCoordinatorServerContextEnabled,
} from './services/coordinator-context.js';
import { setCoordinatorRouteLog } from './services/coordinator-route.js';
import { ConversationStreamHub, TeamStreamHub } from './services/events.js';
import { killInFlightPick } from './services/fs-pick.js';
import { refreshingGithubFetch } from './services/github-connection.js';
import { MachineWakeHub } from './services/machine-wake-hub.js';
import { backfillMachineConcurrency, seedLocalMachine } from './services/machines.js';
import { loadOrCreateVapidKeys } from './services/push.js';
import { runRoutingMigration } from './services/routing-migration.js';
import { setRoutingRulesEnabled } from './services/routing-rules.js';
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
import { startTsnetRemote, type TsnetRemote } from './services/tsnet-remote.js';
import { startupMessage } from './startup-log.js';

const loadedConfig = loadConfig();
const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  // pino-pretty cannot load its transport worker from a single-file bundle.
  ...(process.env.NODE_ENV === 'production' || BUNDLED_FORM
    ? {}
    : { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } } }),
});

const refusal = authStartupRefusal(loadedConfig);
if (refusal !== null) {
  logger.fatal(refusal);
  process.exit(1);
}
const config = ensureAccessToken(loadedConfig);

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
setRoutingRulesEnabled(config.routingRules);
setCoordinatorServerContextEnabled(config.coordinatorServerContext);
setCoordinatorMachineId(config.coordinatorMachineId);
setCoordinatorRouteLog((teamId, reason) =>
  logger.warn({ teamId, reason }, 'coordinator route: falling back to the bound chief agent'),
);
if (config.routingRules) {
  const { withheldSecrets, ...inserted } = runRoutingMigration(db);
  logger.info(inserted, 'routing rules migration');
  for (const row of withheldSecrets) {
    logger.warn(row, 'routing rules migration: agent secrets not granted to the session policy');
  }
}
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
let tsnetRemote: TsnetRemote | null = null;
const app = createApp(
  {
    remote: {
      environmentId: loadOrCreateEnvironmentId(environmentIdPathOf(config.dataDir)),
      listenHost: config.host,
      listenPort: config.port,
      tailnetStatus: () => tsnetRemote?.status() ?? null,
    },
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
    deployRecordPath: deployRecordPathOf(config),
    skillsDir: config.skillsDir,
    skillSourcesPath: join(config.dataDir, 'skill-sources.json'),
    webDir: config.webDir,
    authToken: config.authToken,
    mcpConfigPath: config.mcpConfigPath,
    intakeAgentAllowlist: config.intakeAgentAllowlist,
    logger,
  },
  logger,
);

warnInsecureBind(logger, config);
warnIgnoredTailscaleUsers(logger);
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
    intakeAgentAllowlist: config.intakeAgentAllowlist,
    reposDir,
    githubFetch,
    oauthClient: config.githubOauth,
  },
  {
    tickMs: config.schedulerTickMs,
    pushDigestTimes: config.pushDigestTimes,
    researchIntakeProjectId: config.researchIntakeProjectId,
  },
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
scheduler.start();

const server = serve(
  {
    fetch: app.fetch,
    port: config.port,
    hostname: config.host,
  },
  (info) => {
    logger.info(
      { host: info.address, port: info.port, dataDir: config.dataDir, teamId: seeded.team.id },
      startupMessage(),
    );
  },
);

const computerScreens = computerScreensOf({ db, machineHub, secretBox });
computerScreens.recover();
computerScreens.attach(server);

const tsnetStarting = startTsnetRemote({
  settings: config.tsnet,
  homeDir: config.homeDir,
  app,
  authToken: config.authToken,
  logger,
}).then((started) => {
  tsnetRemote = started;
  return started;
});

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  scheduler.stop();
  killInFlightPick();
  computerScreens.close();
  server.close();
  await (await tsnetStarting)?.stop();
  close();
  process.exit(0);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void shutdown();
  });
}
