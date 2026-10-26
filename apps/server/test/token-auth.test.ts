import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ACCESS_TOKEN_FILE_NAME,
  ENV_VARS,
  formatAccessTokenFile,
  MCP_TOOL_REGISTRY,
} from '@cairn/shared';
import { afterAll, describe, expect, test, vi } from 'vitest';
import {
  insecureBindWarning,
  loadConfig,
  logTokenAuthStartup,
  tokenAuthStartupLines,
  warnInsecureBind,
} from '../src/config.js';
import { bootServer, insertGitApiKey, req, type TestServer } from './helpers.js';

const TOKEN = 'cairn-test-token-0123456789abcdef';
const authHeaders = { authorization: `Bearer ${TOKEN}` };

function reqWith(
  s: TestServer,
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: unknown,
): Promise<Response> {
  return Promise.resolve(
    s.app.request(path, {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json', ...headers } : headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  );
}

const tmpDirs: string[] = [];
afterAll(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('token auth: the protected surface (failure modes 1/2/6)', () => {
  test('on + no token -> /api/* 401 {error} same shape', async () => {
    const s = bootServer({ authToken: TOKEN });
    const res = await req(s.app, 'GET', '/api/teams');
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: unknown };
    expect(typeof body.error).toBe('string');
  });

  test('on + a wrong Bearer token -> 401', async () => {
    const s = bootServer({ authToken: TOKEN });
    const res = await reqWith(s, 'GET', '/api/teams', { authorization: 'Bearer wrong-token' });
    expect(res.status).toBe(401);
  });

  test('on + the correct Bearer token -> 200 as usual (control group)', async () => {
    const s = bootServer({ authToken: TOKEN });
    const res = await reqWith(s, 'GET', '/api/teams', authHeaders);
    expect(res.status).toBe(200);
  });

  test('on + a non-stream endpoint with ?token= (correct value) -> 401 -- the query surface is only for the two streams', async () => {
    const s = bootServer({ authToken: TOKEN });
    const res = await req(s.app, 'GET', `/api/teams?token=${TOKEN}`);
    expect(res.status).toBe(401);
    const post = await reqWith(
      s,
      'POST',
      `/api/projects?token=${TOKEN}`,
      { 'content-type': 'application/json' },
      { name: 'query-token-probe' },
    );
    expect(post.status).toBe(401);
  });
});

describe('token auth: the four exempt surfaces (failure modes 3/4/5/8)', () => {
  test('on + /api/machine/* with a machine credential (enroll Bearer apiKey) -> works as usual, no CAIRN_TOKEN needed', async () => {
    const s = bootServer({ authToken: TOKEN });
    const issued = await reqWith(s, 'POST', `/api/teams/${s.team.id}/api-keys`, authHeaders, {
      name: 'machine-bootstrap',
      gitAccess: false,
      mcpAccess: false,
      toolGrants: { read: [], write: [] },
    });
    expect(issued.status).toBe(201);
    const { plaintext } = (await issued.json()) as { plaintext: string };
    const res = await reqWith(
      s,
      'POST',
      '/api/machine/enroll',
      { authorization: `Bearer ${plaintext}` },
      { teamId: s.team.id, name: 'lane-machine' },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token?: string };
    expect(typeof body.token).toBe('string');
    const me = await reqWith(s, 'GET', '/api/machine/me', {
      authorization: `Bearer ${body.token}`,
    });
    expect(me.status).toBe(200);
  });

  test('on + /git/* -> the new gate passes through to the git-own Basic surface (no credential = git 401; api_key = as usual)', async () => {
    const s = bootServer({ authToken: TOKEN });
    const created = await reqWith(s, 'POST', '/api/projects', authHeaders, {
      name: 'git-exempt',
      repoKind: 'hosted',
    });
    expect(created.status).toBe(201);
    const record = (await created.json()) as { repoName: string };
    const gitPath = `/git/${s.team.id}/${record.repoName}/info/refs?service=git-upload-pack`;

    const anon = await req(s.app, 'GET', gitPath);
    expect(anon.status).toBe(401);
    expect(anon.headers.get('www-authenticate')?.startsWith('Basic')).toBe(true);

    const GIT_KEY = 'cairn_e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0';
    insertGitApiKey(s, GIT_KEY);
    const basic = Buffer.from(`git:${GIT_KEY}`).toString('base64');
    const authed = await reqWith(s, 'GET', gitPath, { authorization: `Basic ${basic}` });
    expect(authed.status).toBe(200);
  });

  test('on + the OAuth callback without a token -> reachable (bad state still goes through the existing 302 error surface)', async () => {
    const s = bootServer({ authToken: TOKEN });
    const res = await req(s.app, 'GET', '/api/oauth/callback?code=x&state=bogus-state');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('oauth=error&reason=state');
  });

  test('on + /_mp/* and the static SPA shell -> exempt (the 204 no-op and the non-secret UI)', async () => {
    const webDir = mkdtempSync(join(tmpdir(), 'cairn-token-spa-'));
    tmpDirs.push(webDir);
    writeFileSync(join(webDir, 'index.html'), '<!doctype html><title>shell</title>');
    const s = bootServer({ authToken: TOKEN, webDir });

    const track = await req(s.app, 'POST', '/_mp/api/track');
    expect(track.status).toBe(204);

    const shell = await req(s.app, 'GET', '/');
    expect(shell.status).toBe(200);
    expect(shell.headers.get('content-type')).toContain('text/html');
    const deep = await req(s.app, 'GET', '/app/resources/providers');
    expect(deep.status).toBe(200);
  });
});

describe('token auth: the /api/mcp exempt surface (failure modes 11/12, the XMON-49 five exemptions)', () => {
  const ALL_READ = MCP_TOOL_REGISTRY.filter((t) => t.kind === 'read').map((t) => t.grant);
  const ALL_WRITE = MCP_TOOL_REGISTRY.filter((t) => t.kind === 'write').map((t) => t.grant);

  async function issueMcpKey(s: TestServer): Promise<string> {
    const issued = await reqWith(s, 'POST', `/api/teams/${s.team.id}/api-keys`, authHeaders, {
      name: 'mcp-gate-probe',
      gitAccess: false,
      mcpAccess: true,
      toolGrants: { read: ALL_READ, write: ALL_WRITE },
    });
    expect(issued.status).toBe(201);
    const { plaintext } = (await issued.json()) as { plaintext: string };
    return plaintext;
  }

  function mcpInitialize(s: TestServer, bearer: string): Promise<Response> {
    return Promise.resolve(
      s.app.request('/api/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          authorization: `Bearer ${bearer}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'token-auth-test', version: '0' },
          },
        }),
      }),
    );
  }

  test('on + /api/mcp with a valid apiKey (no CAIRN_TOKEN) -> through the gate to the mcp-own surface (initialize 200)', async () => {
    const s = bootServer({ authToken: TOKEN });
    const key = await issueMcpKey(s);
    const res = await mcpInitialize(s, key);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result?: { serverInfo?: { name?: string } } };
    expect(body.result?.serverInfo?.name).toBeTruthy();
  });

  test('on + /api/mcp without a credential -> the mcp-own 401 (the error copy differs from the gate shape, pinning the source surface)', async () => {
    const s = bootServer({ authToken: TOKEN });
    const res = await Promise.resolve(
      s.app.request('/api/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      }),
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('mcp authentication required');
  });

  test('on + /api/mcp with CAIRN_TOKEN posing as an apiKey -> the mcp surface 401 (the token is not promoted to an MCP credential)', async () => {
    const s = bootServer({ authToken: TOKEN });
    const res = await mcpInitialize(s, TOKEN);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('invalid api key');
  });
});

describe('token auth: the SSE stream ?token= exception (failure mode 7)', () => {
  test('on + the team stream with the correct ?token= -> the stream is established (SSE surface)', async () => {
    const s = bootServer({ authToken: TOKEN, pingIntervalMs: 50 });
    const res = await Promise.resolve(
      s.app.request(`/api/teams/${s.team.id}/stream?token=${TOKEN}`),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    void res.body?.cancel().catch(() => {});
  });

  test('on + the conversation stream with the correct ?token= -> the stream is established', async () => {
    const s = bootServer({ authToken: TOKEN, pingIntervalMs: 50 });
    const res = await Promise.resolve(
      s.app.request(`/api/conversations/conv-probe/stream?token=${TOKEN}`),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    void res.body?.cancel().catch(() => {});
  });

  test('on + a stream endpoint with a wrong ?token= -> 401; a correct Bearer header -> admitted too', async () => {
    const s = bootServer({ authToken: TOKEN, pingIntervalMs: 50 });
    const bad = await req(s.app, 'GET', `/api/teams/${s.team.id}/stream?token=wrong`);
    expect(bad.status).toBe(401);
    const viaHeader = await reqWith(s, 'GET', `/api/teams/${s.team.id}/stream`, authHeaders);
    expect(viaHeader.status).toBe(200);
    void viaHeader.body?.cancel().catch(() => {});
  });
});

describe('protected-surface guard: path variants do not bypass (review hardening, Spec#4/5 + the encoded-prefix bypass family)', () => {
  test('on + case / double-slash variants without a token -> never reach the protected surface (404, not 200 data)', async () => {
    const s = bootServer({ authToken: TOKEN });
    for (const path of ['/API/teams', '//api/teams', '/api/../api/teams/']) {
      const res = await req(s.app, 'GET', path);
      expect(res.status, path).not.toBe(200);
    }
  });

  test('on + the encoded prefix /%61pi/teams without a token -> 401 (Hono getPath decodes with decodeURI and hits the protected route, the exemption check must not miss it)', async () => {
    const s = bootServer({ authToken: TOKEN });
    const res = await req(s.app, 'GET', '/%61pi/teams');
    expect(res.status).toBe(401);
  });

  test('on + encoded-bypass family variants without a token -> 401 across the board (double encoding / mixed case / encoded suffix / encoded exempt surface)', async () => {
    const s = bootServer({ authToken: TOKEN });
    for (const path of [
      '/%2561pi/teams',
      '/%61PI/teams',
      '/api/%74eams',
      '/api/%6Fauth/callback?code=x&state=bogus',
      '/%61pi/mcp',
    ]) {
      const res = await req(s.app, 'GET', path);
      expect(res.status, path).toBe(401);
    }
  });

  test('on + an /api/mcp segment-boundary variant (/api/mcpfoo) without a token -> 401 (exemption = exact match, not prefix)', async () => {
    const s = bootServer({ authToken: TOKEN });
    const res = await req(s.app, 'POST', '/api/mcpfoo');
    expect(res.status).toBe(401);
  });

  test('on + an encoded-prefix path with the correct Bearer -> the gate admits it, the Hono decoded route is reachable as usual (200)', async () => {
    const s = bootServer({ authToken: TOKEN });
    const res = await reqWith(s, 'GET', '/%61pi/teams', authHeaders);
    expect(res.status).toBe(200);
  });
});

const FILE_TOKEN = 'cairn-file-token-0123456789abcdef';

function writeTokenFile(home: string, token: string): void {
  writeFileSync(join(home, ACCESS_TOKEN_FILE_NAME), formatAccessTokenFile(token));
}

describe('#1708 token file fallback ($CAIRN_HOME/token, env wins)', () => {
  test('env unset + file present -> authToken = file value (same store `cairn token` prints)', () => {
    const home = mkdtempSync(join(tmpdir(), 'cairn-token-file-'));
    tmpDirs.push(home);
    writeTokenFile(home, FILE_TOKEN);
    vi.stubEnv(ENV_VARS.home, home);
    vi.stubEnv(ENV_VARS.token, '');
    expect(loadConfig().authToken).toBe(FILE_TOKEN);
    vi.unstubAllEnvs();
  });

  test('env set + file present -> env wins (precedence unchanged)', () => {
    const home = mkdtempSync(join(tmpdir(), 'cairn-token-file-'));
    tmpDirs.push(home);
    writeTokenFile(home, FILE_TOKEN);
    vi.stubEnv(ENV_VARS.home, home);
    vi.stubEnv(ENV_VARS.token, TOKEN);
    expect(loadConfig().authToken).toBe(TOKEN);
    vi.unstubAllEnvs();
  });

  test('file missing -> authToken null (auth off, same as today)', () => {
    const home = mkdtempSync(join(tmpdir(), 'cairn-token-file-'));
    tmpDirs.push(home);
    vi.stubEnv(ENV_VARS.home, home);
    vi.stubEnv(ENV_VARS.token, '');
    expect(loadConfig().authToken).toBeNull();
    vi.unstubAllEnvs();
  });

  test('file present but malformed -> startup fails fail-closed (never silently opens the API)', () => {
    const home = mkdtempSync(join(tmpdir(), 'cairn-token-file-'));
    tmpDirs.push(home);
    writeFileSync(join(home, ACCESS_TOKEN_FILE_NAME), 'OTHER_KEY=x\n');
    vi.stubEnv(ENV_VARS.home, home);
    vi.stubEnv(ENV_VARS.token, '');
    expect(() => loadConfig()).toThrow(/token file/i);
    vi.unstubAllEnvs();
  });
});

describe('#1708 startup lines (token location + one-time login link)', () => {
  test('auth off -> zero lines (no behavior change)', () => {
    expect(tokenAuthStartupLines(loadConfig({ authToken: null }))).toEqual([]);
  });

  test('env source -> names the env var, the `cairn token` command, and the login link', () => {
    vi.stubEnv(ENV_VARS.token, TOKEN);
    const lines = tokenAuthStartupLines(loadConfig({ host: '127.0.0.1' }));
    vi.unstubAllEnvs();
    const text = lines.join('\n');
    expect(lines.length).toBeGreaterThan(0);
    expect(text).toContain(ENV_VARS.token);
    expect(text).toContain('cairn token');
    expect(text).toContain(`http://127.0.0.1:8787/app#token=${TOKEN}`);
  });

  test('local mode (requireToken off) -> the login link carries the token value', () => {
    vi.stubEnv(ENV_VARS.token, TOKEN);
    const text = tokenAuthStartupLines(loadConfig({ requireToken: false })).join('\n');
    vi.unstubAllEnvs();
    expect(text).toContain(`http://localhost:8787/app#token=${TOKEN}`);
  });

  test('container mode (requireToken on) -> names the token source but never the value or the login link', () => {
    vi.stubEnv(ENV_VARS.token, TOKEN);
    const lines = tokenAuthStartupLines(loadConfig({ requireToken: true }));
    vi.unstubAllEnvs();
    const text = lines.join('\n');
    expect(text).toContain(ENV_VARS.token);
    expect(text).toContain('cairn token');
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain('/app#token=');
  });

  test('container mode + file source -> still no token value, no login link', () => {
    const home = mkdtempSync(join(tmpdir(), 'cairn-token-file-'));
    tmpDirs.push(home);
    writeTokenFile(home, FILE_TOKEN);
    vi.stubEnv(ENV_VARS.home, home);
    vi.stubEnv(ENV_VARS.token, '');
    const text = tokenAuthStartupLines(loadConfig({ requireToken: true })).join('\n');
    vi.unstubAllEnvs();
    expect(text).toContain(ACCESS_TOKEN_FILE_NAME);
    expect(text).not.toContain(FILE_TOKEN);
    expect(text).not.toContain('/app#token=');
  });

  test('file source -> names the absolute token file path', () => {
    const home = mkdtempSync(join(tmpdir(), 'cairn-token-file-'));
    tmpDirs.push(home);
    writeTokenFile(home, FILE_TOKEN);
    vi.stubEnv(ENV_VARS.home, home);
    vi.stubEnv(ENV_VARS.token, '');
    const lines = tokenAuthStartupLines(loadConfig());
    vi.unstubAllEnvs();
    expect(lines.join('\n')).toContain(join(home, ACCESS_TOKEN_FILE_NAME));
  });

  test('link host: default bind and any-interface -> localhost; ::1 bracketed; explicit host verbatim', () => {
    vi.stubEnv(ENV_VARS.token, TOKEN);
    expect(tokenAuthStartupLines(loadConfig({ host: null })).join('\n')).toContain(
      'http://localhost:8787/app#token=',
    );
    expect(tokenAuthStartupLines(loadConfig({ host: '0.0.0.0' })).join('\n')).toContain(
      'http://localhost:8787/app#token=',
    );
    expect(tokenAuthStartupLines(loadConfig({ host: '::1' })).join('\n')).toContain(
      'http://[::1]:8787/app#token=',
    );
    expect(tokenAuthStartupLines(loadConfig({ host: 'example.com' })).join('\n')).toContain(
      'http://example.com:8787/app#token=',
    );
    vi.unstubAllEnvs();
  });

  test('logTokenAuthStartup emits exactly the lines; auth off emits nothing', () => {
    const calls: string[] = [];
    const stubLogger = {
      info: (msg: string) => {
        calls.push(msg);
      },
    };
    vi.stubEnv(ENV_VARS.token, TOKEN);
    logTokenAuthStartup(stubLogger, loadConfig());
    const expected = tokenAuthStartupLines(loadConfig());
    vi.unstubAllEnvs();
    expect(calls).toEqual(expected);
    calls.length = 0;
    logTokenAuthStartup(stubLogger, loadConfig({ authToken: null }));
    expect(calls).toEqual([]);
  });
});

describe('the 0.0.0.0 bare-bind WARN (failure modes 9/10)', () => {
  test('an explicit 0.0.0.0 + auth off -> the WARN copy; default bind / loopback / auth on -> no WARN', () => {
    const warn = insecureBindWarning(loadConfig({ host: '0.0.0.0', authToken: null }));
    expect(warn).toMatch(/0\.0\.0\.0/);
    expect(warn).toMatch(/CAIRN_TOKEN/);
    expect(insecureBindWarning(loadConfig({ host: null, authToken: null }))).toBeNull();
    expect(insecureBindWarning(loadConfig({ host: '127.0.0.1', authToken: null }))).toBeNull();
    expect(insecureBindWarning(loadConfig({ host: '0.0.0.0', authToken: TOKEN }))).toBeNull();
  });

  test('entry wiring: warnInsecureBind -> logger.warn fires exactly one line (a stub pin, guarding against wiring regression)', () => {
    const calls: string[] = [];
    const stubLogger = {
      warn: (msg: string) => {
        calls.push(msg);
      },
    };
    warnInsecureBind(stubLogger, loadConfig({ host: '0.0.0.0', authToken: null }));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/0\.0\.0\.0/);
    warnInsecureBind(stubLogger, loadConfig({ host: null, authToken: null }));
    warnInsecureBind(stubLogger, loadConfig({ host: '0.0.0.0', authToken: TOKEN }));
    expect(calls).toHaveLength(1);
  });

  test('env mapping: CAIRN_TOKEN -> authToken (empty string = off); HOST -> host', () => {
    const home = mkdtempSync(join(tmpdir(), 'cairn-token-env-'));
    tmpDirs.push(home);
    vi.stubEnv(ENV_VARS.home, home);
    vi.stubEnv(ENV_VARS.token, TOKEN);
    vi.stubEnv('HOST', '0.0.0.0');
    expect(loadConfig().authToken).toBe(TOKEN);
    expect(loadConfig().host).toBe('0.0.0.0');
    vi.stubEnv(ENV_VARS.token, '');
    expect(loadConfig().authToken).toBeNull();
    vi.unstubAllEnvs();
    vi.stubEnv(ENV_VARS.home, home);
    expect(loadConfig().authToken).toBeNull();
    expect(loadConfig().host).toBeNull();
    vi.unstubAllEnvs();
  });
});
