import { mkdirSync } from 'node:fs';
import { hostname } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as waitTimeout } from 'node:timers/promises';
import { ENV_VARS } from '@cairn/shared';
import { reapCredentialProfiles } from '@cairn/shared/credential-profile';
import { probeHostKey } from '@cairn/shared/host-identity';
import { parentPidFromEnv, watchParentProcess } from '@cairn/shared/parent-watch';
import { applyLoginShellEnv } from '@cairn/shared/shell-env';
import { serve } from '@hono/node-server';
import { and, eq } from 'drizzle-orm';
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
  warnInsecureBind,
} from './config.js';
import type { AppContext } from './context.js';
import { warnTeamsWithoutCoordinatorRule } from './coordinator/boot-guard.js';
import { coordinatorStoreDir, startCoordinator } from './coordinator/index.js';
import { openDbWithHandle } from './db/client.js';
import { todo } from './db/schema.js';
import { seed } from './db/seed.js';
import { createClerkVerifier } from './lib/clerk-auth.js';
import { createAccessVerifier } from './lib/cloudflare-access.js';
import { installEnvProxy } from './lib/env-proxy.js';
import { environmentIdPathOf, loadOrCreateEnvironmentId } from './lib/environment-id.js';
import { createServerLogger } from './lib/logger.js';
import { listenOwnerChannel, ownerChannelFromEnv } from './lib/owner-channel.js';
import { createKeyfileSecretBox } from './lib/secret-box.js';
import { closeUnclaimedUpgrades } from './lib/upgrade-claims.js';
import { localWorkspaceRoot } from './lib/workspace-root.js';
import { sealRuntimeOtel, spansDroppedBySeal } from './runtime-otel.js';
import { runServerCommand } from './server-command.js';
import { clearLaunchdServerOwner, writeLaunchdServerOwner } from './server-owner.js';
import {
  ANTIGRAVITY_QUOTA_POLL_MS,
  pollAllAntigravityQuotas,
} from './services/antigravity-subscriptions.js';
import { loadApnsConfig } from './services/apns.js';
import { createS3BackupStore, loadBackupS3Config } from './services/backup-s3.js';
import { applyPendingRestoreIfAny, createBackupService } from './services/backup-service.js';
import {
  createStreamTicketBook,
  revokeAllExternalBrowserSessions,
} from './services/browser-session.js';
import { sweepComputerHandoffs } from './services/computer-handoff.js';
import { computerScreensOf } from './services/computer-screen.js';
import { setCoordinatorInServer, setCoordinatorWake } from './services/coordinator-context.js';
import { setCoordinatorSignal } from './services/coordinator-signal.js';
import { runDataMigrationOnce } from './services/data-migrations.js';
import { ConversationStreamHub, TeamStreamHub } from './services/events.js';
import { drainEffects, effectRegistry, reconcileEffects } from './services/external-effects.js';
import { killInFlightPick } from './services/fs-pick.js';
import { refreshingGithubFetch } from './services/github-connection.js';
import { createImService } from './services/im/core.js';
import { liveImEnv } from './services/im/env.js';
import { createImBridge, createImessageAdapter } from './services/im/imessage.js';
import { setImRuntime } from './services/im/runtime.js';
import { createSlackAdapter } from './services/im/slack.js';
import { createTelegramAdapter } from './services/im/telegram.js';
import { createWechatAdapter } from './services/im/wechat.js';
import { backfillInfoReportVersions } from './services/info-handoff.js';
import { MachineWakeHub } from './services/machine-wake-hub.js';
import { demoteMigratedLocalMachines, seedLocalMachine } from './services/machines.js';
import { createMailConnector } from './services/mail-connector.js';
import { adoptGithubConnectorGrants } from './services/mcp-github-connector.js';
import {
  hydrateMissingConnectorTools,
  newMcpOAuthState,
  publicOAuthFetch,
} from './services/mcp-servers.js';
import { registerNotificationDelivery } from './services/notification-router.js';
import { seedOwnerCheckpoints } from './services/owner.js';
import { capturePageOver, createPageThumbnails, parentPortOf } from './services/page-thumbnails.js';
import { loadOrCreateVapidKeys } from './services/push.js';
import { createReleaseWatcher } from './services/release-watcher.js';
import { seedDefaultRouting } from './services/routing-migration.js';
import { createScheduler } from './services/scheduler.js';
import { maybeRetriggerIdleHostUpdate } from './services/server-version.js';
import { pathsOverlap, sharedAgentSkillRoots } from './services/skills.js';
import { prepareSkillsHome } from './services/skills-home.js';
import { drainThenReleaseStreams } from './services/stream-drain.js';
import { fillSystemAvatar } from './services/system-avatar.js';
import { createTailscaleServe } from './services/tailscale-serve.js';
import { attachTeamStreamSockets } from './services/team-stream-socket.js';
import { backfillTokenUsageCost } from './services/token-usage-cost.js';
import { backfillTranscriptOrigins } from './services/transcript-origin-backfill.js';
import { createTsnetRemote } from './services/tsnet-remote.js';
import { createHttpDrain } from './shutdown-http.js';
import { startupMessage } from './startup-log.js';

const commandExit = runServerCommand(process.argv.slice(2), {
  env: process.env,
  writeOut: (text) => process.stdout.write(text),
  writeErr: (text) => process.stderr.write(text),
});
if (commandExit !== null) process.exit(commandExit);

await applyLoginShellEnv({ onlyWhenNonTty: true });

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

const managedBackupSkillsDir = sharedAgentSkillRoots().some((root) =>
  pathsOverlap(config.skillsDir, root),
)
  ? undefined
  : config.skillsDir;

const opened = (() => {
  try {
    applyPendingRestoreIfAny(config.dataDir, config.dbPath, managedBackupSkillsDir, logger);
    return openDbWithHandle(config.dbPath);
  } catch (error) {
    logger.fatal(
      { err: error },
      error instanceof Error ? error.message : 'database migration failed',
    );
    process.exit(1);
  }
})();
const { db, sqlite, close } = opened;
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
const demotedLocalMachines = demoteMigratedLocalMachines(db, {
  name: hostname(),
  hostKey: probeHostKey(),
});
if (demotedLocalMachines > 0) {
  logger.info(
    { count: demotedLocalMachines, name: hostname() },
    'demoted migrated local machine record(s) from another host to remote',
  );
}
if (seedLocalMachine(db, seeded.team.id) === 'blocked') {
  logger.warn(
    { name: hostname() },
    'an enrolled machine holds the server hostname; the local-machine row stays unseeded until it is renamed or removed',
  );
}
setCoordinatorInServer(true);
logger.info(seedDefaultRouting(db), 'default routing rules and policies');
runDataMigrationOnce(db, 'token-usage-cost-backfill', () => backfillTokenUsageCost(db));
runDataMigrationOnce(db, 'token-usage-cost-catalog-backfill', () => backfillTokenUsageCost(db));
const originsStamped = runDataMigrationOnce(db, 'transcript-origin-backfill', () =>
  backfillTranscriptOrigins(db),
);
if (originsStamped !== undefined)
  logger.info(originsStamped, 'transcript user-row provenance backfilled');
const ownersSeeded = runDataMigrationOnce(db, 'owner-checkpoints-seed', () =>
  seedOwnerCheckpoints(db),
);
if ((ownersSeeded ?? 0) > 0)
  logger.info({ tasks: ownersSeeded }, 'thread owner checkpoints seeded');
const hub = new TeamStreamHub(
  (teamId, todoId) =>
    db
      .select({ projectId: todo.projectId })
      .from(todo)
      .where(and(eq(todo.id, todoId), eq(todo.teamId, teamId)))
      .get()?.projectId,
);
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
const infoReportsBackfilled = runDataMigrationOnce(db, 'info-report-design-version-backfill', () =>
  backfillInfoReportVersions(db, attachmentsDir),
);
if ((infoReportsBackfilled ?? 0) > 0)
  logger.info({ versions: infoReportsBackfilled }, 'legacy info report versions backfilled');
const githubFetch = refreshingGithubFetch(
  { db, box: secretBox, oauthClient: config.githubOauth },
  globalThis.fetch,
);
const environmentId = loadOrCreateEnvironmentId(environmentIdPathOf(config.dataDir));
try {
  reapCredentialProfiles(config.dataDir);
} catch (error) {
  logger.warn({ err: String(error) }, 'failed to reap leftover credential profiles');
}
const tailscale = createTailscaleServe({
  environmentId,
  listenPort: config.port,
  recordPath: join(config.dataDir, 'tailscale-serve.json'),
});
const imBridge = createImBridge(machineHub);
const im = createImService({
  db,
  hub,
  machineHub,
  convHub,
  box: secretBox,
  user: seeded.user,
  env: liveImEnv,
  attachmentsDir,
  reposDir,
  adapters: {
    telegram: createTelegramAdapter(),
    wechat: createWechatAdapter(),
    slack: createSlackAdapter(),
    imessage: createImessageAdapter({ db, bridge: imBridge }),
  },
});
setImRuntime(im.runtime, db);
registerNotificationDelivery(db, vapidKeys);
const mail = createMailConnector({
  secrets: { db, box: secretBox },
  mailDeps: { db, hub, machineHub, user: seeded.user, vapidKeys },
  log: logger,
});
const tailnet = createTsnetRemote({
  settings: config.tsnet,
  enabledAtBoot: envStr(ENV_VARS.tsnet) === null ? null : config.tsnet.enabled,
  recordPath: join(config.dataDir, 'tsnet-remote.json'),
  homeDir: config.homeDir,
  app: () => app,
  authToken: config.authToken,
  logger,
  attachSockets: (listener) => {
    const stopSockets = attachTeamStreamSockets(listener, ctx);
    const stopUnclaimed = closeUnclaimedUpgrades(listener);
    return () => {
      stopSockets();
      stopUnclaimed();
    };
  },
});
const ownerChannel = ownerChannelFromEnv(process.env);
listenOwnerChannel(ownerChannel);
const desktopPort = parentPortOf(process);
const pageThumbnails = createPageThumbnails({
  attachmentsDir,
  capture: desktopPort === undefined ? undefined : capturePageOver(desktopPort),
});
const backupS3Config = loadBackupS3Config();
logSecrets.push(backupS3Config?.secretAccessKey ?? '', envStr('CAIRN_BACKUP_ENCRYPTION_KEY') ?? '');
const backupService =
  process.env.CAIRN_BACKUP_DISABLED === '1' || config.dbPath === ':memory:'
    ? undefined
    : createBackupService({
        dataDir: config.dataDir,
        dbPath: config.dbPath,
        statusPath: backupStatusPathOf(config),
        skillsDir: managedBackupSkillsDir,
        sqlite,
        encryptionKeyEnv: envStr('CAIRN_BACKUP_ENCRYPTION_KEY'),
        objectStore: backupS3Config === null ? null : createS3BackupStore(backupS3Config),
        objectPrefix: backupS3Config?.prefix,
        onRestart: () => {
          void shutdown();
        },
        logger,
      });

const isTestMode = process.env.NODE_ENV === 'test' || process.env.VITEST !== undefined;
const releaseWatcher = createReleaseWatcher({
  db,
  homeDir: config.homeDir,
  deployRecordPath: deployRecordPathOf(config),
  logger,
  autoStart: !isTestMode,
});

const mcpOAuthState = newMcpOAuthState();
const ctx: AppContext = {
  remote: {
    environmentId,
    listenHost: config.host,
    listenPort: config.port,
    tailnetStatus: () => tailnet.status(),
    tailnet,
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
  imBridge,
  mail,
  pingIntervalMs: config.pingIntervalMs,
  claimHoldMs: config.claimHoldMs,
  uploads: new Map(),
  streamTickets: createStreamTicketBook(),
  enrollments: new Map(),
  oauthStates: new Map(),
  xaiDeviceStates: new Map(),
  codexDeviceStates: new Map(),
  githubConnectionDeviceStates: new Map(),
  mcpOAuthState,
  oauthClient: config.githubOauth,
  githubAppTokenSocket: config.githubAppTokenSocket,
  githubAppIdentity: config.githubAppIdentity,
  githubFetch,
  githubBaseFetch: globalThis.fetch,
  reposDir,
  get workspacesDir() {
    return workspacesDirOf();
  },
  attachmentsDir,
  pageThumbnails,
  backupStatusPath: backupStatusPathOf(config),
  backupService,
  deployRecordPath: deployRecordPathOf(config),
  releaseWatcher,
  skillsDir: config.skillsDir,
  skillSourcesPath: join(config.dataDir, 'skill-sources.json'),
  homeDir: config.homeDir,
  dataDir: config.dataDir,
  webDir: config.webDir,
  webOrigin: config.webOrigin,
  trustedProxies: new Set(config.trustedProxies),
  authToken: config.authToken,
  ownerChannel,
  accessVerifier:
    config.cloudflareAccess === null ? null : createAccessVerifier(config.cloudflareAccess),
  clerkAuth:
    config.clerkAuth === null
      ? null
      : {
          publishableKey: config.clerkAuth.publishableKey,
          issuer: config.clerkAuth.issuer,
          verify: createClerkVerifier(config.clerkAuth),
        },
  cloudUrl: config.cloudUrl,
  cloudPkceStates: new Map(),
  mcpConfigPath: config.mcpConfigPath,
  logger,
};
const app = createApp(ctx, logger);

adoptGithubConnectorGrants({ db, box: secretBox });
void hydrateMissingConnectorTools({
  db,
  box: secretBox,
  mcpConfigPath: config.mcpConfigPath,
  fetch: globalThis.fetch,
  oauthFetch: publicOAuthFetch,
  oauthState: mcpOAuthState,
  githubFetch,
  oauthClient: config.githubOauth,
}).catch((err) => {
  logger.warn(
    { error: err instanceof Error ? err.message : String(err) },
    'startup connector tool hydration failed',
  );
});

warnInsecureBind(logger, config);
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
    logger,
  },
  { attachmentsDir, logger },
  { githubFetch, logger },
);
warnTeamsWithoutCoordinatorRule(db, logger);
const coordinator = startCoordinator({
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
    mcpOAuthState,
    convHub,
    githubFetch,
    githubBaseFetch: globalThis.fetch,
    oauthClient: config.githubOauth,
    githubAppTokenSocket: config.githubAppTokenSocket,
    githubAppIdentity: config.githubAppIdentity,
  },
  storageDir: coordinatorStoreDir(config.dataDir),
  logger,
});
setCoordinatorWake((threadId) => coordinator.wake(threadId));
setCoordinatorSignal((threadId, kind) =>
  kind === 'steer' ? coordinator.signalSteer(threadId) : coordinator.signalStop(threadId),
);
if (config.disableExternalConnectors) {
  logger.warn(
    'CAIRN_DISABLE_EXTERNAL_CONNECTORS is set (migration staging only): IM polling, mail polling, and scheduled runs are paused so this instance does not conflict with the source server; remove it before cutover',
  );
} else {
  scheduler.start();
  mail.resume();
  void im.resume().catch((error: unknown) => {
    logger.warn({ err: error }, 'im connections could not be resumed');
  });
}

if (config.cloudflareAccess === null && config.clerkAuth === null) {
  revokeAllExternalBrowserSessions(db);
}
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
    writeLaunchdServerOwner(config.homeDir, info.port);
    logger.info(
      { host: info.address, port: info.port, dataDir: config.dataDir, teamId: seeded.team.id },
      startupMessage(),
    );
  },
);

backupService?.start();

const drainHttp = createHttpDrain(server);
const computerScreens = computerScreensOf({
  db,
  machineHub,
  secretBox,
  trustedProxies: new Set(config.trustedProxies),
});
computerScreens.recover();
sweepComputerHandoffs(db, Date.now());
void reconcileEffects(db, effectRegistry)
  .then(() => drainEffects(db, effectRegistry))
  .catch((error: unknown) => {
    logger.warn({ err: error }, 'external effects could not be reconciled');
  });
computerScreens.attach(server);
const stopTeamStreams = attachTeamStreamSockets(server, ctx);
const stopUnclaimedUpgrades = closeUnclaimedUpgrades(server);

if (config.authToken !== null) {
  void tailscale.reapply().catch((error: unknown) => {
    logger.warn({ err: error }, 'tailscale serve could not be pointed at this server');
  });
}

const tailnetReady = tailnet.resume().catch((error: unknown) => {
  logger.warn({ err: error }, 'tsnet remote access could not be resumed');
});

const hostUpdateIdleWatch = setInterval(() => {
  void maybeRetriggerIdleHostUpdate({ db, homeDir: config.homeDir }).catch((error: unknown) => {
    logger.warn({ err: error }, 'idle host update trigger failed');
  });
}, 15_000);
hostUpdateIdleWatch.unref();

const computerHandoffWatch = setInterval(() => {
  sweepComputerHandoffs(db, Date.now());
}, 15_000);
computerHandoffWatch.unref();
const antigravityQuotaDeps = {
  db,
  box: secretBox,
  dataDir: config.dataDir,
  machineHub,
};
const antigravityQuotaBootTimer = isTestMode
  ? null
  : setTimeout(() => {
      void pollAllAntigravityQuotas(antigravityQuotaDeps).catch((error: unknown) => {
        logger.warn({ err: error }, 'initial antigravity quota poll failed');
      });
    }, 15_000);
antigravityQuotaBootTimer?.unref();
const antigravityQuotaPollTimer = isTestMode
  ? null
  : setInterval(() => {
      void pollAllAntigravityQuotas(antigravityQuotaDeps).catch((error: unknown) => {
        logger.warn({ err: error }, 'periodic antigravity quota poll failed');
      });
    }, ANTIGRAVITY_QUOTA_POLL_MS);
antigravityQuotaPollTimer?.unref();

const COORDINATOR_CLOSE_MS = 5_000;
const TAILSCALE_WITHDRAW_MS = 3_000;
const SHUTDOWN_STEP_MS = 3_000;
const OTEL_SEAL_MS = 2_000;
let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  releaseWatcher.stop();
  clearInterval(hostUpdateIdleWatch);
  if (antigravityQuotaBootTimer !== null) clearTimeout(antigravityQuotaBootTimer);
  if (antigravityQuotaPollTimer !== null) clearInterval(antigravityQuotaPollTimer);
  backupService?.stop();
  scheduler.stop();
  killInFlightPick();
  const drained = drainThenReleaseStreams({
    drain: drainHttp,
    release: () => {
      computerScreens.close();
      stopTeamStreams();
      stopUnclaimedUpgrades();
    },
  });
  await Promise.race([
    tailscale.withdraw().catch(() => {}),
    waitTimeout(TAILSCALE_WITHDRAW_MS, undefined, { ref: false }),
  ]);
  await Promise.race([
    coordinator.close(),
    waitTimeout(COORDINATOR_CLOSE_MS, undefined, { ref: false }),
  ]);
  await drained;
  await Promise.race([
    Promise.allSettled([tailnetReady.then(() => tailnet.stop()), im.shutdown(), mail.shutdown()]),
    waitTimeout(SHUTDOWN_STEP_MS, undefined, { ref: false }),
  ]);
  setImRuntime(null);
  await Promise.race([
    sealRuntimeOtel().catch(() => {}),
    waitTimeout(OTEL_SEAL_MS, undefined, { ref: false }),
  ]);
  const dropped = spansDroppedBySeal();
  if (dropped > 0) {
    logger.warn({ spans: dropped }, 'spans dropped after the final tracing shutdown');
  }
  close();
  clearLaunchdServerOwner(config.homeDir);
  logger.info('cairn-server stopped');
  process.exit(0);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void shutdown();
  });
}

const parentPid = parentPidFromEnv(process.env);
if (parentPid !== null) {
  watchParentProcess({ pid: parentPid, onDead: () => void shutdown() });
}
