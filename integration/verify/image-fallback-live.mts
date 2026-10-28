import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  agentRecordSchema,
  chiefGetResponseSchema,
  formatAttachmentToken,
  projectRecordSchema,
  todoRecordSchema,
} from '@cairn/shared';
import { serve } from '@hono/node-server';
import { loadDaemonConfig } from '../../apps/daemon/src/config.js';
import { createDaemonLogger } from '../../apps/daemon/src/log.js';
import { runMachine } from '../../apps/daemon/src/machine-loop.js';
import { statePaths } from '../../apps/daemon/src/state.js';
import type { GrantOutput, UploadOutput } from '../../apps/server/src/services/attachments.js';
import { bootServer, issueApiKey, req } from '../../apps/server/test/helpers.js';

process.umask(0o077);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const checkpoint = '6091529dd1e38f5c7edaaeefb7e217718d05cef1';
const sourceHead = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: root,
  encoding: 'utf8',
}).trim();
const sourceManifest = JSON.parse(
  readFileSync(join(root, 'docs/verify/1671/reviewed-source-hashes.json'), 'utf8'),
) as { files: Record<string, string> };
for (const [path, expected] of Object.entries(sourceManifest.files)) {
  if (
    createHash('sha256')
      .update(readFileSync(join(root, path)))
      .digest('hex') !== expected
  ) {
    throw new Error(`Feature checkpoint source hash differs: ${path}`);
  }
}
const globalModels = JSON.parse(readFileSync(join(homedir(), '.pi/agent/models.json'), 'utf8'));
const globalAuth = JSON.parse(readFileSync(join(homedir(), '.pi/agent/auth.json'), 'utf8'));
const configured = globalModels.providers['domestic-proxy'];
const modelId = 'deepseek-v4.1-flash';
const declared = configured.models.find((model: { id: string }) => model.id === modelId);
if (!declared || declared.contextWindow < 1_000_000 || declared.input.includes('image')) {
  throw new Error(
    'Expected an explicitly text-only model with at least one million context tokens',
  );
}
const authorization = globalAuth['domestic-proxy']?.key ?? configured.apiKey;
if (typeof authorization !== 'string' || !authorization || authorization.startsWith('${')) {
  throw new Error('Restored provider credential is unavailable');
}
const upstream = new URL(`${configured.baseUrl.replace(/\/$/, '')}/chat/completions`);
if (upstream.username || upstream.password) throw new Error('Unexpected upstream URL credentials');
const runDir = mkdtempSync(join(tmpdir(), 'cairn-1671-live-'));
process.once('exit', () => rmSync(runDir, { recursive: true, force: true }));
for (const entry of ['home', 'repos', 'attachments', 'skills']) mkdirSync(join(runDir, entry));
const trial = bootServer({
  webDir: join(root, 'apps/web/dist'),
  reposDir: join(runDir, 'repos'),
  attachmentsDir: join(runDir, 'attachments'),
  skillsDir: join(runDir, 'skills'),
  skillSourcesPath: join(runDir, 'skill-sources.json'),
  mcpConfigPath: join(runDir, 'empty-mcp.json'),
  claimHoldMs: 1_000,
  githubFetch: async () => new Response('[]'),
});
const requests: {
  model: string;
  imageBlocks: number;
  status: number | string;
  usage: Record<string, number>;
}[] = [];
const controllers = new Set<AbortController>();
function imageBlocks(value: unknown): number {
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + imageBlocks(item), 0);
  if (!value || typeof value !== 'object') return 0;
  const item = value as Record<string, unknown>;
  return ['image', 'image_url', 'input_image'].includes(String(item.type))
    ? 1
    : Object.values(item).reduce<number>((sum, item) => sum + imageBlocks(item), 0);
}
const tap = createServer(async (incoming, outgoing) => {
  if (incoming.method !== 'POST' || incoming.url !== '/v1/chat/completions') {
    outgoing.writeHead(404).end();
    return;
  }
  const row = {
    model: '',
    imageBlocks: 0,
    status: 'receiving' as number | string,
    usage: {} as Record<string, number>,
  };
  const controller = new AbortController();
  controllers.add(controller);
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString('utf8');
    const parsed = JSON.parse(body);
    row.model = parsed.model;
    row.imageBlocks = imageBlocks(parsed.messages);
    if (row.model !== modelId) throw new Error('Unexpected model');
    requests.push(row);
    const response = await fetch(upstream, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${authorization}` },
      body,
      signal: controller.signal,
      redirect: 'error',
    });
    row.status = response.status;
    outgoing.writeHead(response.status, {
      'content-type': response.headers.get('content-type') ?? 'application/json',
    });
    let buffer = '';
    if (response.body) {
      for await (const chunk of response.body) {
        outgoing.write(chunk);
        buffer += new TextDecoder().decode(chunk);
        let newline = buffer.indexOf('\n');
        while (newline !== -1) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          if (line.startsWith('data: ')) {
            try {
              const usage = JSON.parse(line.slice(6)).usage;
              if (usage)
                row.usage = Object.fromEntries(
                  Object.entries(usage).filter(([, value]) => typeof value === 'number'),
                ) as Record<string, number>;
            } catch {}
          }
          newline = buffer.indexOf('\n');
        }
      }
    }
    outgoing.end();
  } catch {
    row.status = 'forwarding_error';
    if (!outgoing.headersSent) outgoing.writeHead(502, { 'content-type': 'application/json' });
    outgoing.end('{"error":{"message":"Acceptance forwarding failed"}}');
  } finally {
    controllers.delete(controller);
  }
});
await new Promise<void>((done) => tap.listen(0, '127.0.0.1', done));
const tapUrl = `http://127.0.0.1:${(tap.address() as AddressInfo).port}/v1`;
let stopping = false;
let ready: Record<string, unknown> = {};
const http = serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch: async (request) => {
    const path = new URL(request.url).pathname;
    if (path === '/__acceptance/status') return Response.json({ ...ready, requests });
    if (path === '/__acceptance/stop' && request.method === 'POST') {
      setImmediate(() => void stop());
      return Response.json({ stopping: true });
    }
    return trial.app.fetch(request);
  },
});
await new Promise<void>((done) => http.once('listening', done));
const appUrl = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
const bootstrapKey = await issueApiKey(trial);
const config = loadDaemonConfig(
  {
    serverUrl: appUrl,
    apiKey: bootstrapKey,
    teamId: trial.team.id,
    home: join(runDir, 'home'),
    name: 'image-fallback-1671-disposable',
    skillsDir: join(runDir, 'skills'),
    mcpConfigPath: join(runDir, 'empty-mcp.json'),
  },
  {},
);
const paths = statePaths(config.home, config.workspacesDir);
const daemon = await runMachine({
  config,
  paths,
  logger: createDaemonLogger({ logFile: paths.daemonLog }),
  idleSleepPrevention: false,
  proxyEnv: {},
  heartbeatIntervalMs: 1_000,
  claudeCodeAuthProbe: async () => ({ state: 'not-logged-in', provider: 'isolated-acceptance' }),
});
async function create(path: string, body: unknown) {
  const response = await req(trial.app, 'POST', path, body);
  if (!response.ok) throw new Error(`Seed failed: ${path} (${response.status})`);
  return response.json();
}
await create(`/api/teams/${trial.team.id}/providers`, {
  providerId: 'domestic-proxy',
  label: 'Isolated live text-only acceptance',
  baseUrl: tapUrl,
  api: configured.api ?? 'openai-completions',
  authHeader: true,
  compat: { supportsDeveloperRole: false, maxTokensField: 'max_tokens', supportsStore: false },
  models: [
    {
      id: modelId,
      name: modelId,
      input: ['text'],
      contextWindow: declared.contextWindow,
      maxTokens: 4096,
    },
  ],
  apiKey: 'local-forwarding-placeholder',
});
const agent = agentRecordSchema.pick({ id: true }).parse(
  await create(`/api/teams/${trial.team.id}/agents`, {
    displayName: 'Image fallback acceptance',
    description:
      'Perform this isolated information task. Write the requested report to the provided report path. Never claim to have seen an image that was not delivered. Do not access network resources or external accounts.',
    provider: 'domestic-proxy',
    modelId,
    machineId: daemon.machineId,
    tools: [],
    skillsAllowlist: [],
    defaultSkill: null,
    mcpServers: [],
    persona: 'implementer',
  }),
);
const chiefPatched = await req(trial.app, 'PATCH', `/api/teams/${trial.team.id}/chief`, {
  agent: { agentId: agent.id },
});
if (!chiefPatched.ok) throw new Error('Synthetic Chief binding failed');
const chiefResponse = await req(trial.app, 'GET', `/api/teams/${trial.team.id}/chief`);
const chiefEnvelope = chiefGetResponseSchema.parse(await chiefResponse.json());
if (chiefEnvelope.chief.agent?.agentId !== agent.id) {
  throw new Error('UI Start requires the synthetic Chief to be bound to the acceptance Agent');
}
const project = projectRecordSchema.pick({ id: true }).parse(
  await create('/api/projects', {
    name: 'image-fallback-1671-toy',
    teamId: trial.team.id,
    repoKind: 'hosted',
  }),
);
const bytes = readFileSync(join(root, 'docs/verify/1244/after-checkbox-dark.png'));
const grant = (await create('/api/uploads/grant', {
  kind: 'attachment',
  fileName: 'tiny-existing-screenshot.png',
  mimeType: 'image/png',
  size: bytes.length,
})) as GrantOutput;
const form = new FormData();
form.set('grant', grant.grant);
form.set(
  'file',
  new Blob([new Uint8Array(bytes)], { type: 'image/png' }),
  'tiny-existing-screenshot.png',
);
const uploadedResponse = await trial.app.request(`${grant.uploadUrl}/upload`, {
  method: 'POST',
  body: form,
});
if (!uploadedResponse.ok) throw new Error('PNG seed failed');
const uploaded = (await uploadedResponse.json()) as UploadOutput;
const token = formatAttachmentToken(
  'tiny-existing-screenshot.png',
  uploaded.key.replace(/^attachments\//, ''),
);
const task = todoRecordSchema.parse(
  await create(`/api/projects/${project.id}/todos`, {
    title: 'Live text-only image fallback acceptance',
    output: 'info',
    spec: `Write a short English report at the report.md location supplied by the runner. Include the marker IMAGE-FALLBACK-1671. State explicitly that the attached screenshot was not read by this text-only model. Do not invent its contents. No code or network access is needed.\n\n${token}`,
  }),
);
const assigned = await req(trial.app, 'PATCH', `/api/todos/${task.id}`, {
  assignment: { build: { agentId: agent.id }, plan: { agentId: agent.id } },
});
if (!assigned.ok || task.phase !== 'todo') throw new Error('Task is not ready');
ready = {
  checkpoint,
  sourceHead,
  pid: process.pid,
  appUrl,
  taskUrl: `${appUrl}/app/todo/${task.id}`,
  taskId: task.id,
  projectId: project.id,
  agentId: agent.id,
  machineId: daemon.machineId,
  attachmentId: uploaded.id,
  runDir,
  model: `domestic-proxy/${modelId}`,
  contextWindow: declared.contextWindow,
  initialPhase: task.phase,
  stopUrl: `${appUrl}/__acceptance/stop`,
};
writeFileSync(join(runDir, 'ready.json'), `${JSON.stringify(ready, null, 2)}\n`);
console.log(JSON.stringify({ ready, modelRequests: requests.length }));
async function stop() {
  if (stopping) return;
  stopping = true;
  for (const controller of controllers) controller.abort();
  await daemon.stop('isolated acceptance cleanup');
  if ('closeAllConnections' in http) http.closeAllConnections();
  tap.closeAllConnections();
  await Promise.all([
    daemon.done,
    new Promise<void>((done) => http.close(() => done())),
    new Promise<void>((done) => tap.close(() => done())),
  ]);
  trial.dispose();
  rmSync(runDir, { recursive: true, force: true });
  process.exit(0);
}
process.on('SIGTERM', () => void stop());
process.on('SIGINT', () => void stop());
