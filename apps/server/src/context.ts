import type { NetworkInterfaceInfo } from 'node:os';
import type { TeamRecord, UserRecord } from '@cairn/shared';
import type { Logger } from 'pino';
import type { Db } from './db/client.js';
import type { FetchLike } from './lib/github.js';
import type { KeySecretBox } from './lib/secret-box.js';
import type { SidecarStatus } from './lib/tsnet-sidecar.js';
import type { ConversationStreamHub, TeamStreamHub } from './services/events.js';
import type { PendingUpload } from './services/machine-uploads.js';
import type { MachineWakeHub } from './services/machine-wake-hub.js';
import type { OAuthClientConfig, OAuthStateEntry } from './services/oauth.js';
import type { VapidKeys } from './services/push.js';
import type { SkillImportFetch } from './services/skill-import.js';

export interface RemoteAccessContext {
  environmentId: string;
  listenHost: string;
  listenPort: number;
  tailnetStatus: () => SidecarStatus | null;
  networkInterfaces?: () => NodeJS.Dict<NetworkInterfaceInfo[]>;
}

export interface AppContext {
  remote?: RemoteAccessContext;
  intakeAgentAllowlist?: readonly string[];
  db: Db;
  hub: TeamStreamHub;
  machineHub: MachineWakeHub;
  convHub?: ConversationStreamHub;
  secretBox: KeySecretBox;
  vapidKeys?: VapidKeys | null;
  pushEndpointHosts?: ReadonlySet<string>;
  user: UserRecord;
  team: TeamRecord;
  pingIntervalMs: number;
  claimHoldMs: number;
  uploads: Map<string, PendingUpload>;
  enrollments: Map<
    string,
    {
      teamId: string;
      name?: string;
      createdAt: number;
      machine?: { machineId: string; token: string; teamId: string; serverUrl: string };
    }
  >;
  reposDir: string;
  attachmentsDir: string;
  backupStatusPath?: string;
  deployRecordPath?: string;
  skillsDir: string;
  skillSourcesPath: string;
  skillImportFetch?: SkillImportFetch;
  skillImportTimeoutMs?: number;
  webDir?: string | null;
  githubFetch?: FetchLike;
  oauthStates: Map<string, OAuthStateEntry>;
  oauthFetch?: FetchLike;
  oauthClient: OAuthClientConfig | null;
  authToken: string | null;
  mcpConfigPath: string;
  logger?: Logger;
}
