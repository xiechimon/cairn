export interface MachineEndpoint {
  readonly path: string;
  readonly note?: string;
}

export const MACHINE_ENDPOINTS: readonly MachineEndpoint[] = [
  { path: '/api/machine/enroll', note: '注册（02 §5.2）' },
  { path: '/api/machine/enroll/start', note: '浏览器授权流（02 §5.2 路径一）' },
  { path: '/api/machine/enroll/poll' },
  { path: '/api/machine/me', note: '机器自述' },
  { path: '/api/machine/presence', note: '心跳（断网时并行失败，进程不退出，r3 §1.5）' },
  {
    path: '/api/machine/rate-limit',
    note: 'Claude rate-limit report (per machine and subscription)',
  },
  { path: '/api/machine/recover', note: '步 journal 恢复（细节 [推断]，02 §5.4/§11）' },
  { path: '/api/machine/tasks/claim', note: '长轮询领取（~75–76s 节奏，r3 §1.5）' },
  { path: '/api/machine/stream', note: 'wake SSE 低延迟派发（02 §1.2/§5.4）' },
  { path: '/api/machine/heartbeat/{stepId}', note: '步骤 journal 续活（02 §5.4）' },
  { path: '/api/machine/tool/{stepId}', note: '工具调用回传；remoteTools relay 同径（r5 §3.1）' },
  {
    path: '/api/machine/token/{stepId}',
    note: 'per-step 凭证下发（模型 key + 托管 repo git 凭证），不落盘常驻 [推断]（02 §5.4/§8）',
  },
  { path: '/api/machine/upload-urls/{stepId}', note: '预签名产物上传：transcript/产物（r3 §1.6）' },
  { path: '/api/machine/done/{stepId}', note: '步骤收尾' },
];

export const CLAIM_POLL_INTERVAL_MS = 75_000;

export const CLAIM_BACKOFF_CAP_MS = 30_000;

export const REMOTE_TOOL_RETRY_DELAYS_MS = [500, 2000] as const;
export const REMOTE_TOOL_TIMEOUT_MS = 10_000;

export const ENROLL_PATHS = ['browser', 'api-key'] as const;

export const ONLINE_SEQUENCE_CANON = [
  'Loading pi runtime…',
  'Online (machineId=…); polling <url>',
  'Idle-sleep prevention active (caffeinate)',
  '[recover] no pending steps found',
  '[wake] push channel connected',
] as const;
