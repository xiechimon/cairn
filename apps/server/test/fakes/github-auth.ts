import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { FetchLike } from '../../src/lib/github.js';

export interface FakeAuthUser {
  id: number;
  login: string;
  name: string | null;
}

export interface FakeRepo {
  id: number;
  name: string;
  full_name: string;
  private?: boolean;
  owner: { login: string };
}

interface DeviceState {
  deviceCode: string;
  userCode: string;
  status: 'pending' | 'approved' | 'denied';
  userId: number;
  expiresAt: number;
  slowDownInterval: number | null;
}

interface GrantState {
  userId: number;
  refreshToken: string;
  revoked: boolean;
  accessRevoked: boolean;
  kind: 'ghu_' | 'gho_';
}

export interface AuthCall {
  url: string;
  method: string;
  form: URLSearchParams;
  auth: string | undefined;
}

export interface GithubAuthFakeOptions {
  user?: FakeAuthUser;
  repos?: FakeRepo[];
  installed?: boolean;
}

const DEFAULT_USER: FakeAuthUser = { id: 42, login: 'octo', name: 'Octo Cat' };

export function githubAuthFake(options: GithubAuthFakeOptions = {}) {
  const users = new Map<number, FakeAuthUser>();
  const defaultUser = options.user ?? DEFAULT_USER;
  users.set(defaultUser.id, defaultUser);
  const devices = new Map<string, DeviceState>();
  const grants = new Map<string, GrantState>();
  const pathFaults: { includes: string; status: number; body: unknown }[] = [];
  const calls: AuthCall[] = [];
  const repos: FakeRepo[] = options.repos ?? [
    {
      id: 1,
      name: 'demo',
      full_name: `${defaultUser.login}/demo`,
      owner: { login: defaultUser.login },
    },
  ];
  let installations = options.installed === false ? 0 : 1;
  let seq = 0;
  let fault: { status: number; body: unknown } | null = null;
  let onRequest: ((call: AuthCall) => void | Promise<void>) | null = null;

  const nextId = () => `fake_${++seq}_${Math.random().toString(36).slice(2, 10)}`;

  const userOf = (id: number): FakeAuthUser | null => users.get(id) ?? null;

  const approveDevice = (userCode: string, user?: FakeAuthUser): void => {
    const device = [...devices.values()].find((d) => d.userCode === userCode);
    if (device === undefined) throw new Error(`no fake device code for ${userCode}`);
    if (user !== undefined) {
      users.set(user.id, user);
      device.userId = user.id;
    }
    device.status = 'approved';
  };

  const denyDevice = (userCode: string): void => {
    const device = [...devices.values()].find((d) => d.userCode === userCode);
    if (device === undefined) throw new Error(`no fake device code for ${userCode}`);
    device.status = 'denied';
  };

  const slowDownDevice = (userCode: string, intervalSeconds: number): void => {
    const device = [...devices.values()].find((d) => d.userCode === userCode);
    if (device === undefined) throw new Error(`no fake device code for ${userCode}`);
    device.slowDownInterval = intervalSeconds;
  };

  const expireDevice = (userCode: string): void => {
    const device = [...devices.values()].find((d) => d.userCode === userCode);
    if (device === undefined) throw new Error(`no fake device code for ${userCode}`);
    device.expiresAt = 0;
  };

  const knowGrant = (
    accessToken: string,
    refreshToken: string,
    login = defaultUser.login,
  ): void => {
    const user = [...users.values()].find((u) => u.login === login);
    grants.set(accessToken, {
      userId: user?.id ?? defaultUser.id,
      refreshToken,
      revoked: false,
      accessRevoked: false,
      kind: accessToken.startsWith('ghu_') ? 'ghu_' : 'gho_',
    });
  };

  const authCodeState = new Map<string, { userId: number; expires: boolean; scope: string }>();

  const issueAuthCode = (
    userOrLogin: FakeAuthUser | string = defaultUser,
    opts: { expires?: boolean; scope?: string } = {},
  ): string => {
    const code = nextId();
    const user =
      typeof userOrLogin === 'object'
        ? userOrLogin
        : ([...users.values()].find((u) => u.login === userOrLogin) ?? defaultUser);
    users.set(user.id, user);
    authCodeState.set(code, {
      userId: user.id,
      expires: opts.expires ?? true,
      scope: opts.scope ?? '',
    });
    return code;
  };

  const revoke = (token: string): void => {
    const grant = grants.get(token);
    if (grant !== undefined) grant.revoked = true;
    for (const g of grants.values()) if (g.refreshToken === token) g.revoked = true;
  };

  const revokeAccess = (token: string): void => {
    const grant = grants.get(token);
    if (grant !== undefined) grant.accessRevoked = true;
  };

  function mintGrant(userId: number, kind: 'ghu_' | 'gho_') {
    const accessToken = `${kind}${nextId()}`;
    const refreshToken = `ghr_${nextId()}`;
    grants.set(accessToken, {
      userId,
      refreshToken,
      revoked: false,
      accessRevoked: false,
      kind,
    });
    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: 28_800,
      refresh_token_expires_in: 15_552_000,
      scope: '',
      token_type: 'bearer',
    };
  }

  function bearerUser(auth: string | undefined) {
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : undefined;
    const grant = token === undefined ? undefined : grants.get(token);
    if (grant === undefined || grant.revoked || grant.accessRevoked) return null;
    return userOf(grant.userId);
  }

  function tokenEndpoint(form: URLSearchParams) {
    const grantType = form.get('grant_type');
    if (grantType === 'urn:ietf:params:oauth:grant-type:device_code') {
      const device = devices.get(form.get('device_code') ?? '');
      if (device === undefined) return { status: 200, body: { error: 'expired_token' } };
      if (device.expiresAt <= Date.now()) return { status: 200, body: { error: 'expired_token' } };
      if (device.slowDownInterval !== null) {
        const interval = device.slowDownInterval;
        device.slowDownInterval = null;
        return { status: 200, body: { error: 'slow_down', interval } };
      }
      if (device.status === 'pending')
        return { status: 200, body: { error: 'authorization_pending' } };
      if (device.status === 'denied') return { status: 200, body: { error: 'access_denied' } };
      return { status: 200, body: mintGrant(device.userId, 'ghu_') };
    }
    if (grantType === 'refresh_token') {
      const refreshToken = form.get('refresh_token') ?? '';
      const entry = [...grants.entries()].find(
        ([, g]) => g.refreshToken !== '' && g.refreshToken === refreshToken,
      );
      if (entry === undefined || entry[1].revoked) {
        return { status: 200, body: { error: 'bad_refresh_token' } };
      }
      entry[1].revoked = true;
      return { status: 200, body: mintGrant(entry[1].userId, entry[1].kind) };
    }
    if (grantType === 'authorization_code' || (grantType === null && form.has('code'))) {
      const code = form.get('code') ?? '';
      const auth = authCodeState.get(code);
      if (auth === undefined) return { status: 200, body: { error: 'bad_verification_code' } };
      authCodeState.delete(code);
      const accessToken = `gho_${nextId()}`;
      const refreshToken = auth.expires ? `ghr_${nextId()}` : '';
      grants.set(accessToken, {
        userId: auth.userId,
        refreshToken,
        revoked: false,
        accessRevoked: false,
        kind: 'gho_',
      });
      return {
        status: 200,
        body: {
          access_token: accessToken,
          ...(auth.expires
            ? {
                expires_in: 28_800,
                refresh_token: refreshToken,
                refresh_token_expires_in: 15_552_000,
              }
            : {}),
          scope: auth.scope,
          token_type: 'bearer',
        },
      };
    }
    return { status: 400, body: { error: 'unsupported_grant_type' } };
  }

  const DEVICE_PAGE = (prefix: string) => `<!doctype html><html><body>
<form method="get" action="${prefix}/login/device/approve">
<label>Code <input name="user_code" autofocus></label>
<button type="submit">Authorize</button>
</form></body></html>`;

  function route(url: URL, form: URLSearchParams, method: string, auth: string | undefined) {
    const path = url.pathname;
    if (fault !== null) return { status: fault.status, body: fault.body, headers: {} };
    for (const f of pathFaults) {
      if (path.includes(f.includes)) return { status: f.status, body: f.body, headers: {} };
    }
    if (method === 'POST' && path.endsWith('/login/device/code')) {
      const prefix = path.slice(0, -'/login/device/code'.length);
      const deviceCode = nextId();
      const userCode = `FAKE-${String(devices.size + 1).padStart(4, '0')}`;
      devices.set(deviceCode, {
        deviceCode,
        userCode,
        status: 'pending',
        userId: defaultUser.id,
        expiresAt: Date.now() + 900_000,
        slowDownInterval: null,
      });
      return {
        status: 200,
        body: {
          device_code: deviceCode,
          user_code: userCode,
          verification_uri: `${url.origin}${prefix}/login/device`,
          interval: 5,
          expires_in: 900,
        },
        headers: {},
      };
    }
    if (method === 'GET' && path.endsWith('/login/device')) {
      const prefix = path.slice(0, -'/login/device'.length);
      return { status: 200, body: DEVICE_PAGE(prefix), headers: { 'content-type': 'text/html' } };
    }
    if (method === 'GET' && path.endsWith('/login/device/approve')) {
      const code = url.searchParams.get('user_code') ?? '';
      try {
        approveDevice(code);
        return { status: 200, body: 'authorized', headers: { 'content-type': 'text/html' } };
      } catch {
        return { status: 404, body: 'unknown code', headers: { 'content-type': 'text/html' } };
      }
    }
    if (method === 'POST' && path.endsWith('/login/oauth/access_token')) {
      return { ...tokenEndpoint(form), headers: {} };
    }
    if (method === 'GET' && path.endsWith('/login/oauth/authorize')) {
      const redirectUri = url.searchParams.get('redirect_uri') ?? '';
      const state = url.searchParams.get('state') ?? '';
      const code = issueAuthCode();
      const target = `${redirectUri}${redirectUri.includes('?') ? '&' : '?'}code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;
      return {
        status: 200,
        body: `<!doctype html><html><body><a href="${target}">Authorize</a></body></html>`,
        headers: { 'content-type': 'text/html' },
      };
    }
    if (method === 'GET' && path.endsWith('/user/installations')) {
      if (bearerUser(auth) === null)
        return { status: 401, body: { message: 'Bad credentials' }, headers: {} };
      return {
        status: 200,
        body: {
          total_count: installations,
          installations: installations > 0 ? [{ id: 1 }] : [],
        },
        headers: {},
      };
    }
    const installationRepos = path.match(/\/user\/installations\/(\d+)\/repositories$/);
    if (method === 'GET' && installationRepos) {
      if (bearerUser(auth) === null)
        return { status: 401, body: { message: 'Bad credentials' }, headers: {} };
      if (installations === 0) return { status: 404, body: { message: 'Not Found' }, headers: {} };
      const perPage = Math.max(1, Number(url.searchParams.get('per_page') ?? '30') || 30);
      const page = Math.max(1, Number(url.searchParams.get('page') ?? '1') || 1);
      return {
        status: 200,
        body: {
          total_count: repos.length,
          repository_selection: 'all',
          repositories: repos.slice((page - 1) * perPage, page * perPage),
        },
        headers: {},
      };
    }
    if (method === 'GET' && path.endsWith('/user/repos')) {
      if (bearerUser(auth) === null)
        return { status: 401, body: { message: 'Bad credentials' }, headers: {} };
      const bearer = auth?.startsWith('Bearer ') ? auth.slice(7) : '';
      const visible = bearer.startsWith('ghu_') ? repos.filter((r) => r.private !== true) : repos;
      return { status: 200, body: visible, headers: {} };
    }
    if (method === 'GET' && path.endsWith('/user')) {
      const user = bearerUser(auth);
      if (user === null) return { status: 401, body: { message: 'Bad credentials' }, headers: {} };
      return {
        status: 200,
        body: { login: user.login, id: user.id, name: user.name },
        headers: {},
      };
    }
    return { status: 404, body: { message: `no auth fake for ${method} ${path}` }, headers: {} };
  }

  const fetch: FetchLike = async (input, init) => {
    const url = new URL(String(input));
    const method = (init?.method ?? 'GET').toUpperCase();
    const form = new URLSearchParams(typeof init?.body === 'string' ? init.body : '');
    const call: AuthCall = {
      url: url.toString(),
      method,
      form,
      auth: init?.headers?.authorization,
    };
    calls.push(call);
    await onRequest?.(call);
    const res = route(url, form, method, call.auth);
    const headers = Object.fromEntries(
      Object.entries(res.headers).map(([k, v]) => [k.toLowerCase(), v]),
    );
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
      json: async () =>
        typeof res.body === 'string' ? (JSON.parse(res.body) as unknown) : res.body,
      text: async () => (typeof res.body === 'string' ? res.body : JSON.stringify(res.body)),
    };
  };

  async function serve(): Promise<{ url: string; close: () => Promise<void> }> {
    const server: Server = createServer((reqMsg, resMsg) => {
      void (async () => {
        const chunks: Buffer[] = [];
        for await (const chunk of reqMsg) chunks.push(chunk as Buffer);
        const url = new URL(reqMsg.url ?? '/', `http://${reqMsg.headers.host ?? '127.0.0.1'}`);
        const auth = reqMsg.headers.authorization;
        const form = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
        const call: AuthCall = {
          url: url.toString(),
          method: (reqMsg.method ?? 'GET').toUpperCase(),
          form,
          auth,
        };
        calls.push(call);
        await onRequest?.(call);
        const res = route(url, form, call.method, auth);
        resMsg.writeHead(res.status, res.headers);
        resMsg.end(typeof res.body === 'string' ? res.body : JSON.stringify(res.body));
      })();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    return {
      url: `http://127.0.0.1:${port}`,
      close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    };
  }

  return {
    fetch,
    calls,
    devices,
    grants,
    approveDevice,
    denyDevice,
    slowDownDevice,
    expireDevice,
    setInstallations: (count: number) => {
      installations = count;
    },
    knowGrant,
    issueAuthCode,
    revoke,
    revokeAccess,
    serve,
    setFault: (status: number | null, body: unknown = {}) => {
      fault = status === null ? null : { status, body };
    },
    setPathFault: (includes: string, status: number | null, body: unknown = {}) => {
      pathFaults.splice(
        0,
        pathFaults.length,
        ...(status === null ? [] : [{ includes, status, body }]),
      );
    },
    setOnRequest: (fn: ((call: AuthCall) => void | Promise<void>) | null) => {
      onRequest = fn;
    },
    latestDevice: () => [...devices.values()].at(-1),
    user: defaultUser,
  };
}

export type GithubAuthFake = ReturnType<typeof githubAuthFake>;
