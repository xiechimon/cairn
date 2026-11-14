import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ENV_VARS } from '@cairn/shared';
import { serve } from '@hono/node-server';
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
import { warnTeamsWithoutCoordinatorRule } from './coordinator/boot-guard.js';
import { migrateSidecarState } from './coordinator/boot-migration.js';
import { coordinatorStoreDir, startCoordinator } from './coordinator/index.js';
import { openDbWithHandle } from './db/client.js';
import { seed } from './db/seed.js';
import { environmentIdPathOf, loadOrCreateEnvironmentId } from './lib/environment-id.js';
import { createServerLogger } from './lib/logger.js';
import { loopbackOwnerFor } from './lib/loopback-owner.js';
import { createKeyfileSecretBox } from './lib/secret-box.js';
import { localWorkspaceRoot } from './lib/workspace-root.js';
import { shutdownRuntimeOtel } from './runtime-otel.js';
import { loadApnsConfig } from './services/apns.js';
import { installBuiltinSkills } from './services/builtin-skills.js';
import { sweepComputerHandoffs } from './services/computer-handoff.js';
import { computerScreensOf } from './services/computer-screen.js';
import {
  setCoordinatorInServer,
  setCoordinatorServerContextEnabled,
  setCoordinatorWake,
} from './services/coordinator-context.js';
import { ConversationStreamHub, TeamStreamHub } from './services/events.js';
import { killInFlightPick } from './services/fs-pick.js';
import { refreshingGithubFetch } from './services/github-connection.js';
import { MachineWakeHub } from './services/machine-wake-hub.js';
import { backfillMachineConcurrency, seedLocalMachine } from './services/machines.js';
import { seedOwnerCheckpoints } from './services/owner.js';
import { loadOrCreateVapidKeys } from './services/push.js';
import { seedDefaultRouting } from './services/routing-migration.js';
import {
  createScheduler,
  issueIntakeRunOf,
  schedulingRunOf,
  trajectoryExportRunOf,
  trajectoryOutcomeRunOf,
  trajectoryReflectCurateRunOf,
} from './services/scheduler.js';
import { backfillTokenUsageCost } from './services/token-usage-cost.js';
import { startTsnetRemote, type TsnetRemote } from './services/tsnet-remote.js';
import { createHttpDrain } from './shutdown-http.js';
import { startupMessage } from './startup-log.js';

const loadedConfig = loadConfig();
const logSecrets = [loadedConfig.authToken ?? ''];
const logger = createServerLogger(logSecrets, {
  level: process.env.LOG_LEVEL ?? 'info',
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
logSecrets.push(config.authToken ?? '');
try {
  installBuiltinSkills(join(config.dataDir, 'builtin-skills'));
} catch (error) {
  logger.warn({ err: error }, 'built-in skills were not installed; running without them');
}

const opened = (() => {
  try {
    return openDbWithHandle(config.dbPath, {
      legacyExportDir: config.homeDir,
      migrationLogger: logger,
    });
  } catch (error) {
    logger.fatal(
      { err: error },
      error instanceof Error ? error.message : 'database migration failed',
    );
    process.exit(1);
  }
})();
const { db, close } = opened;
const secretBox = createKeyfileSecretBox(config.keyfilePath);
const vapidKeys = {
  ...loadOrCreateVapidKeys(config.vapidKeysPath, config.vapidSubject, config.webOrigin),
  apns: loadApnsConfig(config.apns),
};
const seeded = seed(db);
seedLocalMachine(db, seeded.team.id);
setCoordinatorServerContextEnabled(config.coordinatorServerContext || config.coordinatorInServer);
setCoordinatorInServer(config.coordinatorInServer);
logger.info(seedDefaultRouting(db), 'default routing rules and policies');
backfillTokenUsageCost(db);
const concurrencyBackfilled = backfillMachineConcurrency(db);
if (concurrencyBackfilled > 0) {
  logger.info(
    { machines: concurrencyBackfilled },
    'machine concurrency backfilled to recommendation',
  );
}
const ownersSeeded = seedOwnerCheckpoints(db);
if (ownersSeeded > 0) logger.info({ tasks: ownersSeeded }, 'thread owner checkpoints seeded');
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
    xaiDeviceStates: new Map(),
    oauthClient: config.githubOauth,
    githubAppTokenSocket: config.githubAppTokenSocket,
    githubAppIdentity: config.githubAppIdentity,
    githubFetch,
    reposDir,
    attachmentsDir,
    backupStatusPath: backupStatusPathOf(config),
    deployRecordPath: deployRecordPathOf(config),
    skillsDir: config.skillsDir,
    skillSourcesPath: join(config.dataDir, 'skill-sources.json'),
    webDir: config.webDir,
    authToken: config.authToken,
    loopbackOwner: loopbackOwnerFor(config),
    mcpConfigPath: config.mcpConfigPath,
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
    reposDir,
    attachmentsDir,
    githubFetch,
    oauthClient: config.githubOauth,
    githubAppTokenSocket: config.githubAppTokenSocket,
    githubAppIdentity: config.githubAppIdentity,
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
if (config.coordinatorInServer) {
  migrateSidecarState({
    machine: { db, hub, machineHub },
    homeDir: config.homeDir,
    storageDir: coordinatorStoreDir(config.dataDir),
    sidecarMachineId: config.coordinatorMachineId,
    logger,
  });
  warnTeamsWithoutCoordinatorRule(db, logger);
}
const coordinator = config.coordinatorInServer
  ? startCoordinator({
      machine: {
        db,
        hub,
        machineHub,
        box: secretBox,
        user: seeded.user,
        vapidKeys,
        reposDir,
        get workspacesDir() {
          return localWorkspaceRoot(
            config.homeDir,
            resolve(process.env[ENV_VARS.workspacesDir] ?? join(config.homeDir, 'workspaces')),
          );
        },
        attachmentsDir,
        skillsDir: config.skillsDir,
        mcpConfigPath: config.mcpConfigPath,
        convHub,
        githubFetch,
        oauthClient: config.githubOauth,
        githubAppTokenSocket: config.githubAppTokenSocket,
        githubAppIdentity: config.githubAppIdentity,
      },
      storageDir: coordinatorStoreDir(config.dataDir),
      logger,
    })
  : null;
if (coordinator !== null) setCoordinatorWake((threadId) => coordinator.wake(threadId));
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

const drainHttp = createHttpDrain(server);
const computerScreens = computerScreensOf({ db, machineHub, secretBox });
computerScreens.recover();
sweepComputerHandoffs(db, Date.now());
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

const COORDINATOR_CLOSE_MS = 5_000;
let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  scheduler.stop();
  await Promise.race([
    coordinator?.close(),
    new Promise((resolve) => setTimeout(resolve, COORDINATOR_CLOSE_MS)),
  ]);
  killInFlightPick();
  computerScreens.close();
  await drainHttp(shutdownRuntimeOtel);
  await (await tsnetStarting)?.stop();
  close();
  process.exit(0);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void shutdown();
  });
}
