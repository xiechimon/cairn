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
  envStr,
  loadConfig,
  logTokenAuthStartup,
  reposDirOf,
  warnIgnoredTailscaleUsers,
  warnInsecureBind,
} from './config.js';
import { warnTeamsWithoutCoordinatorRule } from './coordinator/boot-guard.js';
import { coordinatorStoreDir, startCoordinator } from './coordinator/index.js';
import { openDbWithHandle } from './db/client.js';
import { seed } from './db/seed.js';
import { createAccessVerifier } from './lib/cloudflare-access.js';
import { installEnvProxy } from './lib/env-proxy.js';
import { environmentIdPathOf, loadOrCreateEnvironmentId } from './lib/environment-id.js';
import { createServerLogger } from './lib/logger.js';
import { loopbackOwnerFor } from './lib/loopback-owner.js';
import { createKeyfileSecretBox } from './lib/secret-box.js';
import { localWorkspaceRoot } from './lib/workspace-root.js';
import { shutdownRuntimeOtel } from './runtime-otel.js';
import { runServerCommand } from './server-command.js';
import { loadApnsConfig } from './services/apns.js';
import { sweepComputerHandoffs } from './services/computer-handoff.js';
import { computerScreensOf } from './services/computer-screen.js';
import { setCoordinatorInServer, setCoordinatorWake } from './services/coordinator-context.js';
import { runDataMigrationOnce } from './services/data-migrations.js';
import { engineScreensOf } from './services/engine-screen.js';
import { ConversationStreamHub, TeamStreamHub } from './services/events.js';
import { drainEffects, effectRegistry, reconcileEffects } from './services/external-effects.js';
import { killInFlightPick } from './services/fs-pick.js';
import { refreshingGithubFetch } from './services/github-connection.js';
import { createImService } from './services/im/core.js';
import { liveImEnv } from './services/im/env.js';
import { setImRuntime } from './services/im/runtime.js';
import { createSlackAdapter } from './services/im/slack.js';
import { createTelegramAdapter } from './services/im/telegram.js';
import { wechatAdapter } from './services/im/wechat.js';
import { MachineWakeHub } from './services/machine-wake-hub.js';
import { backfillMachineConcurrency, seedLocalMachine } from './services/machines.js';
import { createMailConnector } from './services/mail-connector.js';
import { adoptGithubConnectorGrants } from './services/mcp-github-connector.js';
import { newMcpOAuthState } from './services/mcp-servers.js';
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
import { sharedAgentSkillRoots } from './services/skills.js';
import { prepareSkillsHome } from './services/skills-home.js';
import { fillSystemAvatar } from './services/system-avatar.js';
import { createTailscaleServe } from './services/tailscale-serve.js';
import { backfillTokenUsageCost } from './services/token-usage-cost.js';
import { startTsnetRemote, type TsnetRemote } from './services/tsnet-remote.js';
import { createHttpDrain } from './shutdown-http.js';
import { startupMessage } from './startup-log.js';

const commandExit = runServerCommand(process.argv.slice(2), {
  env: process.env,
  writeOut: (text) => process.stdout.write(text),
  writeErr: (text) => process.stderr.write(text),
});
if (commandExit !== null) process.exit(commandExit);

const loadedConfig = loadConfig();
const logSecrets = [loadedConfig.authToken ?? ''];
const logger = createServerLogger(logSecrets, {
  level: process.env.LOG_LEVEL ?? 'info',
  ...(process.env.NODE_ENV === 'production' || BUNDLED_FORM
    ? {}
    : { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } } }),
});

const envProxy = installEnvProxy();
if (envProxy.ignored)
  logger.warn('a proxy environment variable is not an http(s) URL and is ignored');
if (envProxy.proxy !== null)
  logger.info(
    { proxy: envProxy.proxy },
    'outbound requests go through the proxy from the environment',
  );

const refusal = authStartupRefusal(loadedConfig);
if (refusal !== null) {
  logger.fatal(refusal);
  process.exit(1);
}
const config = ensureAccessToken(loadedConfig);
logSecrets.push(config.authToken ?? '');

const opened = (() => {
  try {
    return openDbWithHandle(config.dbPath);
  } catch (error) {
    logger.fatal(
      { err: error },
      error instanceof Error ? error.message : 'database migration failed',
    );
    process.exit(1);
  }
})();
const { db, close } = opened;
const skillsHome = await prepareSkillsHome({
  db,
  skillsDir: config.skillsDir,
  pinned: envStr(ENV_VARS.skillsDir) !== null,
  legacyDir: sharedAgentSkillRoots()[0],
  skillSourcesPath: join(config.dataDir, 'skill-sources.json'),
}).catch((error: unknown) => {
  logger.fatal(
    { err: error, skillsDir: config.skillsDir },
    'could not prepare the Cairn skills directory',
  );
  process.exit(1);
});
if (skillsHome.kind === 'shared') {
  logger.warn(
    { skillsDir: config.skillsDir },
    'the skills directory overlaps one other agent tools share; Cairn reads it and refuses every write there',
  );
} else {
  logger.info({ skillsDir: config.skillsDir, ...skillsHome }, 'skills directory ready');
}
const secretBox = createKeyfileSecretBox(config.keyfilePath);
const vapidKeys = {
  ...loadOrCreateVapidKeys(config.vapidKeysPath, config.vapidSubject, config.webOrigin),
  apns: loadApnsConfig(config.apns),
};
const seeded = seed(db);
await fillSystemAvatar(seeded.user);
seedLocalMachine(db, seeded.team.id);
setCoordinatorInServer(config.coordinatorInServer);
logger.info(seedDefaultRouting(db), 'default routing rules and policies');
runDataMigrationOnce(db, 'token-usage-cost-backfill', () => backfillTokenUsageCost(db));
const concurrencyBackfilled = runDataMigrationOnce(db, 'machine-concurrency-backfill', () =>
  backfillMachineConcurrency(db),
);
if ((concurrencyBackfilled ?? 0) > 0) {
  logger.info(
    { machines: concurrencyBackfilled },
    'machine concurrency backfilled to recommendation',
  );
}
const ownersSeeded = runDataMigrationOnce(db, 'owner-checkpoints-seed', () =>
  seedOwnerCheckpoints(db),
);
if ((ownersSeeded ?? 0) > 0)
  logger.info({ tasks: ownersSeeded }, 'thread owner checkpoints seeded');
const hub = new TeamStreamHub();
const convHub = new ConversationStreamHub();
const machineHub = new MachineWakeHub();
const reposDir = reposDirOf(config);
mkdirSync(reposDir, { recursive: true });
const workspacesDirOf = () =>
  localWorkspaceRoot(
    config.homeDir,
    resolve(process.env[ENV_VARS.workspacesDir] ?? join(config.homeDir, 'workspaces')),
  );
const attachmentsDir = attachmentsDirOf(config);
mkdirSync(attachmentsDir, { recursive: true });
const githubFetch = refreshingGithubFetch(
  { db, box: secretBox, oauthClient: config.githubOauth },
  globalThis.fetch,
);
let tsnetRemote: TsnetRemote | null = null;
const environmentId = loadOrCreateEnvironmentId(environmentIdPathOf(config.dataDir));
const tailscale = createTailscaleServe({
  environmentId,
  listenPort: config.port,
  recordPath: join(config.dataDir, 'tailscale-serve.json'),
});
const im = createImService({
  db,
  hub,
  machineHub,
  convHub,
  box: secretBox,
  user: seeded.user,
  env: liveImEnv,
  adapters: {
    telegram: createTelegramAdapter(),
    wechat: wechatAdapter,
    slack: createSlackAdapter(),
  },
});
setImRuntime(im.runtime);
const mail = createMailConnector({
  secrets: { db, box: secretBox },
  mailDeps: { db, hub, machineHub, user: seeded.user, vapidKeys },
  log: logger,
});
const app = createApp(
  {
    remote: {
      environmentId,
      listenHost: config.host,
      listenPort: config.port,
      tailnetStatus: () => tsnetRemote?.status() ?? null,
      tailscale,
    },
    db,
    hub,
    machineHub,
    convHub,
    secretBox,
    vapidKeys,
    user: seeded.user,
    team: seeded.team,
    im,
    mail,
    pingIntervalMs: config.pingIntervalMs,
    claimHoldMs: config.claimHoldMs,
    uploads: new Map(),
    enrollments: new Map(),
    oauthStates: new Map(),
    xaiDeviceStates: new Map(),
    codexDeviceStates: new Map(),
    githubConnectionDeviceStates: new Map(),
    mcpOAuthState: newMcpOAuthState(),
    oauthClient: config.githubOauth,
    githubAppTokenSocket: config.githubAppTokenSocket,
    githubAppIdentity: config.githubAppIdentity,
    githubFetch,
    reposDir,
    get workspacesDir() {
      return workspacesDirOf();
    },
    attachmentsDir,
    backupStatusPath: backupStatusPathOf(config),
    deployRecordPath: deployRecordPathOf(config),
    skillsDir: config.skillsDir,
    skillSourcesPath: join(config.dataDir, 'skill-sources.json'),
    webDir: config.webDir,
    authToken: config.authToken,
    loopbackOwner: loopbackOwnerFor(config),
    accessVerifier:
      config.cloudflareAccess === null ? null : createAccessVerifier(config.cloudflareAccess),
    mcpConfigPath: config.mcpConfigPath,
    logger,
  },
  logger,
);

adoptGithubConnectorGrants({ db, box: secretBox });

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
          return workspacesDirOf();
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
mail.resume();
void im.resume().catch((error: unknown) => {
  logger.warn({ err: error }, 'im connections could not be resumed');
});

if (config.authToken === null) {
  await tailscale.withdraw().catch((error: unknown) => {
    logger.warn({ err: error }, 'tailscale serve mapping could not be withdrawn with auth off');
  });
}

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
void reconcileEffects(db, effectRegistry)
  .then(() => drainEffects(db, effectRegistry))
  .catch((error: unknown) => {
    logger.warn({ err: error }, 'external effects could not be reconciled');
  });
computerScreens.attach(server);
const engineScreens = engineScreensOf({ db, machineHub, secretBox, hub, attachmentsDir });
engineScreens.attach(server);

if (config.authToken !== null) {
  void tailscale.reapply().catch((error: unknown) => {
    logger.warn({ err: error }, 'tailscale serve could not be pointed at this server');
  });
}

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
const TAILSCALE_WITHDRAW_MS = 3_000;
let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  scheduler.stop();
  await Promise.race([
    tailscale.withdraw().catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, TAILSCALE_WITHDRAW_MS)),
  ]);
  await Promise.race([
    coordinator?.close(),
    new Promise((resolve) => setTimeout(resolve, COORDINATOR_CLOSE_MS)),
  ]);
  killInFlightPick();
  computerScreens.close();
  engineScreens.close();
  await im.shutdown().catch(() => {});
  await mail.shutdown().catch(() => {});
  setImRuntime(null);
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
