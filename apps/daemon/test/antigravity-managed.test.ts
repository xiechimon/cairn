import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_ANTIGRAVITY_MODELS } from '@cairn/shared';
import { ANTIGRAVITY_ACP_ARGS } from '@cairn/shared/antigravity-install';
import { afterEach, describe, expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { createAntigravityManaged } from '../src/backend/antigravity-managed.js';

const tempDirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = makeTestTempDir(prefix);
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) releaseTestTempDir(dir);
});

const MANIFEST_BASE = 'https://manifests.example.test/manifests';
const ARCHIVE_PREFIX = 'https://storage.example.test/antigravity-cli/';

function shQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function fakeCliSource(
  version: string,
  opts: {
    acpVersion?: string;
    authenticated?: boolean;
    failAcp?: boolean;
    models?: { value: string; name: string }[];
  } = {},
): string {
  const acpVersion = opts.acpVersion ?? version;
  const authenticated = opts.authenticated ?? true;
  const models = opts.models ?? [
    { value: 'gemini-4-carbon', name: 'Gemini 4 Carbon' },
    { value: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
  ];
  const body = [
    "import { createInterface } from 'node:readline';",
    'if (process.argv[2] === "--version") {',
    `  process.stdout.write(${JSON.stringify(`${version}\n`)});`,
    '  process.exit(0);',
    '}',
    'if (process.argv[2] !== "acp" || process.argv[3] !== "--app-data-dir" || process.argv[4] !== "antigravity-acp") {',
    '  process.stderr.write("unexpected args: " + JSON.stringify(process.argv.slice(2)) + "\\n");',
    '  process.exit(2);',
    '}',
    ...(opts.failAcp ? ['process.exit(1);'] : []),
    'const send = (obj) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...obj }) + "\\n");',
    'for await (const line of createInterface({ input: process.stdin })) {',
    '  const msg = JSON.parse(line);',
    '  if (msg.method === "initialize") {',
    `    send({ id: msg.id, result: { protocolVersion: msg.params.protocolVersion, agentInfo: { name: "Antigravity ACP Server", version: ${JSON.stringify(acpVersion)} }, agentCapabilities: { loadSession: true, sessionCapabilities: { resume: {} } } } });`,
    '  } else if (msg.method === "session/new") {',
    ...(authenticated
      ? [
          `    send({ id: msg.id, result: { sessionId: "probe-1", configOptions: [{ id: "model", name: "Model", category: "model", type: "select", currentValue: ${JSON.stringify(models[0]?.value ?? 'gemini-4-carbon')}, options: ${JSON.stringify(models)} }] } });`,
        ]
      : ['    send({ id: msg.id, error: { code: -32000, message: "Authentication required" } });']),
    '  } else if (msg.method === "session/set_config_option") {',
    '    const thought = msg.params.value === "gemini-4-carbon" ? [{ id: "thought_level", name: "Thinking", category: "thought_level", type: "select", currentValue: "high", options: [{ value: "low", name: "Low" }, { value: "high", name: "High" }] }] : [];',
    '    send({ id: msg.id, result: { configOptions: thought } });',
    '  }',
    '}',
  ].join('\n');
  return `#!/bin/sh\nexec ${shQuote(process.execPath)} --input-type=module -e ${shQuote(body)} -- "$0" "$@"\n`;
}

function makeCliArchive(
  dir: string,
  version: string,
  opts?: Parameters<typeof fakeCliSource>[1],
): { bytes: Buffer; sha512: string; url: string } {
  const src = join(dir, `src-${version}`);
  mkdirSync(src, { recursive: true });
  const bin = join(src, 'antigravity');
  writeFileSync(bin, fakeCliSource(version, opts));
  chmodSync(bin, 0o755);
  const archivePath = join(dir, `cli-${version}.tar.gz`);
  execFileSync('tar', ['-czf', archivePath, '-C', src, 'antigravity']);
  const bytes = readFileSync(archivePath);
  return {
    bytes,
    sha512: createHash('sha512').update(bytes).digest('hex'),
    url: `${ARCHIVE_PREFIX}${version}-999/darwin-arm/cli_mac_arm64.tar.gz`,
  };
}

function writeManagedCliInstall(root: string, version: string, binSource: string): string {
  const versionDir = join(root, 'versions', version);
  mkdirSync(versionDir, { recursive: true });
  const bin = join(versionDir, 'antigravity');
  writeFileSync(bin, binSource);
  chmodSync(bin, 0o755);
  writeFileSync(
    join(versionDir, '.install-complete'),
    JSON.stringify({
      runtime: 'agy-cli',
      version,
      url: `${ARCHIVE_PREFIX}${version}-1/darwin-arm/cli_mac_arm64.tar.gz`,
      archiveSha512: 'a'.repeat(128),
      binRelPath: 'antigravity',
      binSha256: createHash('sha256').update(readFileSync(bin)).digest('hex'),
      args: [...ANTIGRAVITY_ACP_ARGS],
      installedAt: Date.now(),
    }),
  );
  writeFileSync(join(root, 'current.json'), JSON.stringify({ version }));
  return bin;
}

describe('antigravity managed binary resolution', () => {
  test('ignores a local agy binary on ~/.local/bin — managed copy or nothing', async () => {
    const dir = tempDir('ag-local-');
    const home = join(dir, 'home');
    const binDir = join(home, '.local', 'bin');
    mkdirSync(binDir, { recursive: true });
    const agy = join(binDir, 'agy');
    writeFileSync(agy, '#!/bin/sh\nexit 0\n');
    chmodSync(agy, 0o755);

    const fetched: string[] = [];
    const managed = createAntigravityManaged({
      root: join(dir, 'managed'),
      platform: 'darwin',
      arch: 'arm64',
      manifestBaseUrl: MANIFEST_BASE,
      archiveUrlPrefix: ARCHIVE_PREFIX,
      fetchImpl: async (url) => {
        fetched.push(String(url));
        return new Response('{}', { status: 500 });
      },
    });

    expect(managed.current()).toBeNull();
    expect(await managed.ensure()).toBeNull();
    expect(fetched).toEqual([`${MANIFEST_BASE}/darwin_arm64.json`]);
  });

  test('downloads full CLI from Google release channel, validates version + ACP initialize, and discovers models', async () => {
    const dir = tempDir('ag-cli-');
    const archive = makeCliArchive(dir, '1.5.16');
    const seen: string[] = [];
    const managed = createAntigravityManaged({
      root: join(dir, 'managed'),
      platform: 'darwin',
      arch: 'arm64',
      manifestBaseUrl: MANIFEST_BASE,
      archiveUrlPrefix: ARCHIVE_PREFIX,
      fetchImpl: async (url) => {
        const text = String(url);
        seen.push(text);
        if (text.endsWith('.json')) {
          return new Response(
            JSON.stringify({ version: '1.5.16', url: archive.url, sha512: archive.sha512 }),
            { status: 200 },
          );
        }
        return new Response(new Uint8Array(archive.bytes), { status: 200 });
      },
    });

    const install = await managed.ensure();
    expect(seen).toEqual([`${MANIFEST_BASE}/darwin_arm64.json`, archive.url]);
    expect(install).toMatchObject({
      version: '1.5.16',
      args: ANTIGRAVITY_ACP_ARGS,
      source: 'managed',
      authenticated: true,
      models: [
        {
          id: 'gemini-4-carbon',
          name: 'Gemini 4 Carbon',
          thinkingLevels: ['low', 'high'],
          thinkingDefault: 'high',
        },
        { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', thinkingLevels: [] },
      ],
    });
  });

  test('keeps the previous runtime active when a newer release fails ACP initialize validation', async () => {
    const dir = tempDir('ag-rollback-');
    const root = join(dir, 'managed');
    const v1 = makeCliArchive(dir, '1.5.15');
    const v2Broken = makeCliArchive(dir, '1.5.16', { failAcp: true });
    let activeArchive = { version: '1.5.15', ...v1 };

    const managed = createAntigravityManaged({
      root,
      platform: 'darwin',
      arch: 'arm64',
      manifestBaseUrl: MANIFEST_BASE,
      archiveUrlPrefix: ARCHIVE_PREFIX,
      fetchImpl: async (url) => {
        if (String(url).endsWith('.json')) {
          return new Response(
            JSON.stringify({
              version: activeArchive.version,
              url: activeArchive.url,
              sha512: activeArchive.sha512,
            }),
            { status: 200 },
          );
        }
        return new Response(new Uint8Array(activeArchive.bytes), { status: 200 });
      },
    });

    const first = await managed.ensure();
    expect(first?.version).toBe('1.5.15');

    activeArchive = { version: '1.5.16', ...v2Broken };
    const afterFailedUpdate = await managed.ensure();
    expect(afterFailedUpdate?.version).toBe('1.5.15');
    expect(managed.current()?.version).toBe('1.5.15');
    expect(JSON.parse(readFileSync(join(root, 'current.json'), 'utf8'))).toEqual({
      version: '1.5.15',
    });
    expect(existsSync(join(root, 'versions', '1.5.16'))).toBe(false);
    expect(existsSync(join(root, 'versions', '1.5.15', 'antigravity'))).toBe(true);
  });

  test('a cached install is dropped once its binary disappears from disk', async () => {
    const dir = tempDir('ag-stale-');
    const root = join(dir, 'managed');
    const bin = writeManagedCliInstall(root, '1.5.15', fakeCliSource('1.5.15'));

    const managed = createAntigravityManaged({
      root,
      platform: 'darwin',
      arch: 'arm64',
      manifestBaseUrl: MANIFEST_BASE,
      archiveUrlPrefix: ARCHIVE_PREFIX,
      fetchImpl: async () => new Response('{}', { status: 500 }),
      probeBinary: async (binPath, args, source) => ({
        version: '1.5.15',
        binPath,
        args,
        source,
        authenticated: true,
        models: DEFAULT_ANTIGRAVITY_MODELS.map(({ id, name }) => ({ id, name })),
      }),
    });

    expect((await managed.probe())?.binPath).toBe(bin);
    rmSync(bin, { force: true });
    expect(managed.current()).toBeNull();
  });

  test('rejects off-prefix archive URLs, bad checksums, and releases below 1.5.0', async () => {
    const dir = tempDir('ag-untrusted-');
    const valid = makeCliArchive(dir, '1.5.16');
    const cases = [
      {
        name: 'off-prefix archive',
        manifest: {
          version: '1.5.16',
          url: 'https://evil.example/cli_mac_arm64.tar.gz',
          sha512: valid.sha512,
        },
        expectDownload: false,
      },
      {
        name: 'bad sha512',
        manifest: { version: '1.5.16', url: valid.url, sha512: '0'.repeat(128) },
        expectDownload: true,
      },
      {
        name: 'below 1.5.0',
        manifest: {
          version: '1.4.9',
          url: `${ARCHIVE_PREFIX}1.4.9-1/darwin-arm/cli_mac_arm64.tar.gz`,
          sha512: valid.sha512,
        },
        expectDownload: false,
      },
    ];
    for (const entry of cases) {
      const downloaded: string[] = [];
      const managed = createAntigravityManaged({
        root: join(dir, `managed-${entry.name.replaceAll(' ', '-')}`),
        platform: 'darwin',
        arch: 'arm64',
        manifestBaseUrl: MANIFEST_BASE,
        archiveUrlPrefix: ARCHIVE_PREFIX,
        fetchImpl: async (url) => {
          const text = String(url);
          if (text.endsWith('.json')) {
            return new Response(JSON.stringify(entry.manifest), { status: 200 });
          }
          downloaded.push(text);
          return new Response(new Uint8Array(valid.bytes), { status: 200 });
        },
      });
      expect(await managed.ensure(), entry.name).toBeNull();
      expect(downloaded.length > 0, entry.name).toBe(entry.expectDownload);
    }
  });

  test('ignores a legacy registry-pack install and replaces it with the full CLI', async () => {
    const dir = tempDir('ag-legacy-');
    const root = join(dir, 'managed');
    const legacyDir = join(root, 'versions', '1.5.2');
    mkdirSync(legacyDir, { recursive: true });
    const par = join(legacyDir, 'agy_acp_server.par');
    writeFileSync(par, 'legacy-par');
    writeFileSync(
      join(legacyDir, '.install-complete'),
      JSON.stringify({
        version: '1.5.2',
        url: 'https://dl.google.com/agy.zip',
        archiveSha256: 'a'.repeat(64),
        binRelPath: 'agy_acp_server.par',
        binSha256: createHash('sha256').update(readFileSync(par)).digest('hex'),
        args: [],
        installedAt: 1,
      }),
    );
    writeFileSync(join(root, 'current.json'), JSON.stringify({ version: '1.5.2' }));

    const archive = makeCliArchive(dir, '1.5.16', { authenticated: false });
    const managed = createAntigravityManaged({
      root,
      platform: 'darwin',
      arch: 'arm64',
      manifestBaseUrl: MANIFEST_BASE,
      archiveUrlPrefix: ARCHIVE_PREFIX,
      fetchImpl: async (url) =>
        String(url).endsWith('.json')
          ? new Response(
              JSON.stringify({ version: '1.5.16', url: archive.url, sha512: archive.sha512 }),
              { status: 200 },
            )
          : new Response(new Uint8Array(archive.bytes), { status: 200 }),
    });

    expect(managed.current()).toBeNull();
    const install = await managed.ensure();
    expect(install).toMatchObject({
      version: '1.5.16',
      args: ANTIGRAVITY_ACP_ARGS,
      source: 'managed',
      authenticated: false,
    });
    expect(existsSync(legacyDir)).toBe(false);
  });

  test('rejects an archive whose binary escapes through a symlinked directory', async () => {
    const dir = tempDir('ag-escape-');
    const outside = join(dir, 'outside');
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, 'antigravity'), fakeCliSource('1.5.16'));
    const src = join(dir, 'src');
    mkdirSync(src);
    symlinkSync(outside, join(src, 'bin'));
    const archivePath = join(dir, 'ag.tar.gz');
    execFileSync('tar', ['-czf', archivePath, '-C', src, '.']);
    const archiveBytes = readFileSync(archivePath);
    const sha512 = createHash('sha512').update(archiveBytes).digest('hex');
    const url = `${ARCHIVE_PREFIX}1.5.16-1/darwin-arm/cli_mac_arm64.tar.gz`;
    const managed = createAntigravityManaged({
      root: join(dir, 'managed'),
      platform: 'darwin',
      arch: 'arm64',
      manifestBaseUrl: MANIFEST_BASE,
      archiveUrlPrefix: ARCHIVE_PREFIX,
      fetchImpl: async (reqUrl) =>
        String(reqUrl).endsWith('.json')
          ? new Response(JSON.stringify({ version: '1.5.16', url, sha512 }), { status: 200 })
          : new Response(new Uint8Array(archiveBytes), { status: 200 }),
    });
    expect(await managed.ensure()).toBeNull();
  });

  test('adopts late config_option_update with the full CLI model catalog instead of freezing on a single initial model', async () => {
    const dir = tempDir('ag-late-models-');
    const root = join(dir, 'managed');
    const fullCliModels = [
      { value: 'gemini-4-neon', name: 'Gemini 4 Neon' },
      { value: 'gemini-4-carbon', name: 'Gemini 4 Carbon' },
      { value: 'gemini-4-argon', name: 'Gemini 4 Argon' },
      { value: 'gemini-4-hydrogen', name: 'Gemini 4 Hydrogen' },
      { value: 'gemini-pro-orchestrator-neon', name: 'Orchestrator (Neon)' },
      { value: 'gemini-pro-orchestrator', name: 'Orchestrator (Carbon)' },
      { value: 'gemini-pro-orchestrator-argon', name: 'Orchestrator (Argon)' },
      { value: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash' },
      { value: 'claude-opus-5-5', name: 'Claude Opus 5.5' },
      { value: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5' },
      { value: 'gpt-oss-120b-medium', name: 'GPT-OSS 120B (Medium)' },
    ];
    const body = [
      "import { createInterface } from 'node:readline';",
      'const send = (obj) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...obj }) + "\\n");',
      'for await (const line of createInterface({ input: process.stdin })) {',
      '  const msg = JSON.parse(line);',
      '  if (msg.method === "initialize") {',
      '    send({ id: msg.id, result: { protocolVersion: msg.params.protocolVersion, agentInfo: { name: "Antigravity ACP Server", version: "1.5.16" }, agentCapabilities: { loadSession: true } } });',
      '  } else if (msg.method === "session/new") {',
      '    send({ id: msg.id, result: { sessionId: "probe-1", configOptions: [{ id: "model", name: "Model", category: "model", type: "select", currentValue: "gemini-3.8-flash", options: [{ value: "gemini-3.8-flash", name: "Gemini 3.8 Flash" }] }] } });',
      '    setTimeout(() => {',
      '      send({ method: "session/update", params: { sessionId: "foreign-session", update: { sessionUpdate: "config_option_update", configOptions: [{ id: "model", name: "Model", category: "model", type: "select", currentValue: "foreign-only", options: [{ value: "foreign-only", name: "Foreign" }] }] } } });',
      `      send({ method: "session/update", params: { sessionId: "probe-1", update: { sessionUpdate: "config_option_update", configOptions: [{ id: "model", name: "Model", category: "model", type: "select", currentValue: "gemini-4-neon", options: ${JSON.stringify(fullCliModels)} }] } } });`,
      '    }, 25);',
      '  } else if (msg.method === "session/set_config_option") {',
      '    const thought = msg.params.value === "gemini-4-neon" ? [{ id: "thought_level", name: "Thinking", category: "thought_level", type: "select", currentValue: "high", options: [{ value: "low", name: "Low" }, { value: "medium", name: "Medium" }, { value: "high", name: "High" }, { value: "xhigh", name: "XHigh" }] }] : [];',
      '    send({ id: msg.id, result: { configOptions: thought } });',
      '  }',
      '}',
    ].join('\n');
    const source = `#!/bin/sh\nexec ${shQuote(process.execPath)} --input-type=module -e ${shQuote(body)} -- "$0" "$@"\n`;
    writeManagedCliInstall(root, '1.5.16', source);

    const managed = createAntigravityManaged({
      root,
      platform: 'darwin',
      arch: 'arm64',
      fetchImpl: async () => new Response('{}', { status: 500 }),
    });
    const install = await managed.probe();
    expect(install?.authenticated).toBe(true);
    expect(install?.models.map((m) => m.id)).toEqual(fullCliModels.map((m) => m.value));
    expect(install?.models.find((m) => m.id === 'gemini-4-neon')).toMatchObject({
      id: 'gemini-4-neon',
      name: 'Gemini 4 Neon',
      thinkingLevels: ['low', 'medium', 'high', 'xhigh'],
      thinkingDefault: 'high',
    });
  });

  test('probe clears stale cached authentication when a subsequent probe fails', async () => {
    const dir = tempDir('ag-stale-probe-');
    const root = join(dir, 'managed');
    writeManagedCliInstall(root, '1.5.15', fakeCliSource('1.5.15'));

    let pass = true;
    const managed = createAntigravityManaged({
      root,
      platform: 'darwin',
      arch: 'arm64',
      manifestBaseUrl: MANIFEST_BASE,
      archiveUrlPrefix: ARCHIVE_PREFIX,
      fetchImpl: async () => new Response('{}', { status: 500 }),
      probeBinary: async (binPath, args, source) =>
        pass
          ? {
              version: '1.5.15',
              binPath,
              args,
              source,
              authenticated: true,
              models: DEFAULT_ANTIGRAVITY_MODELS.map(({ id, name }) => ({ id, name })),
            }
          : null,
    });

    expect((await managed.probe())?.authenticated).toBe(true);
    pass = false;
    expect(await managed.probe()).toBeNull();
    expect(managed.current()?.authenticated).toBe(false);
  });

  test('a session/new timeout reports timeout instead of signed-out and preserves cached login', async () => {
    const dir = tempDir('ag-timeout-probe-');
    const root = join(dir, 'managed');
    const flagFile = join(dir, 'hang-session');
    const switchableCli = [
      '#!/bin/sh',
      `exec ${shQuote(process.execPath)} --input-type=module -e ${shQuote(
        [
          "import { existsSync } from 'node:fs';",
          "import { createInterface } from 'node:readline';",
          'const send = (obj) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...obj }) + "\\n");',
          'for await (const line of createInterface({ input: process.stdin })) {',
          '  const msg = JSON.parse(line);',
          '  if (msg.method === "initialize") {',
          '    send({ id: msg.id, result: { protocolVersion: msg.params.protocolVersion, agentInfo: { name: "Antigravity ACP Server", version: "1.5.15" }, agentCapabilities: { loadSession: true } } });',
          '  } else if (msg.method === "session/new") {',
          `    if (!existsSync(${JSON.stringify(flagFile)})) {`,
          '      send({ id: msg.id, result: { sessionId: "s-1", configOptions: [{ id: "model", category: "model", type: "select", currentValue: "gemini-4-carbon", options: [{ value: "gemini-4-carbon", name: "Gemini 4 Carbon" }] }] } });',
          '    }',
          '  } else if (msg.method === "session/set_config_option") {',
          '    send({ id: msg.id, result: { configOptions: [] } });',
          '  }',
          '}',
        ].join('\n'),
      )} -- "$0" "$@"`,
      '',
    ].join('\n');
    writeManagedCliInstall(root, '1.5.15', switchableCli);

    const managed = createAntigravityManaged({
      root,
      platform: 'darwin',
      arch: 'arm64',
      manifestBaseUrl: MANIFEST_BASE,
      archiveUrlPrefix: ARCHIVE_PREFIX,
      probeSessionTimeoutMs: 300,
      probeOverallTimeoutMs: 2_500,
    });

    const initial = await managed.probeDetailed();
    expect(initial.kind).toBe('ok');
    expect(managed.current()?.authenticated).toBe(true);

    writeFileSync(flagFile, '1');
    const outcome = await managed.probeDetailed();
    expect(outcome).toEqual({ kind: 'timeout' });
    expect(managed.current()?.authenticated).toBe(true);
    expect(managed.current()?.models.map((m) => m.id)).toEqual(['gemini-4-carbon']);
  });

  test('reads thinking levels when ACP reports option id effort without category thought_level', async () => {
    const dir = tempDir('ag-effort-id-');
    const root = join(dir, 'managed');
    const body = [
      "import { createInterface } from 'node:readline';",
      'const send = (obj) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...obj }) + "\\n");',
      'for await (const line of createInterface({ input: process.stdin })) {',
      '  const msg = JSON.parse(line);',
      '  if (msg.method === "initialize") {',
      '    send({ id: msg.id, result: { protocolVersion: msg.params.protocolVersion, agentInfo: { name: "Antigravity ACP Server", version: "1.5.17" }, agentCapabilities: { loadSession: true } } });',
      '  } else if (msg.method === "session/new") {',
      '    send({ id: msg.id, result: { sessionId: "probe-effort", configOptions: [{ id: "model", name: "Model", category: "model", type: "select", currentValue: "claude-opus-5-5", options: [{ value: "claude-opus-5-5", name: "Claude Opus 5.5" }] }] } });',
      '  } else if (msg.method === "session/set_config_option") {',
      '    send({ id: msg.id, result: { configOptions: [{ id: "effort", name: "Effort", type: "select", currentValue: "medium", options: [{ value: "low", name: "Low" }, { value: "medium", name: "Medium" }, { value: "high", name: "High" }] }] } });',
      '  }',
      '}',
    ].join('\n');
    const source = `#!/bin/sh\nexec ${shQuote(process.execPath)} --input-type=module -e ${shQuote(body)} -- "$0" "$@"\n`;
    writeManagedCliInstall(root, '1.5.17', source);
    const managed = createAntigravityManaged({
      root,
      platform: 'darwin',
      arch: 'arm64',
      fetchImpl: async () => new Response('{}', { status: 500 }),
    });
    const install = await managed.probe();
    expect(install?.models).toEqual([
      {
        id: 'claude-opus-5-5',
        name: 'Claude Opus 5.5',
        thinkingLevels: ['low', 'medium', 'high'],
        thinkingDefault: 'medium',
      },
    ]);
  });
});
