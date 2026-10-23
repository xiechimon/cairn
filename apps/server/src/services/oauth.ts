// OAuth 握手业务面（#231：一族打通 = github-copilot；族表 = shared
// OAUTH_FAMILIES）。authorize = state 签发 + 授权 URL 拼装；callback =
// state 核销 + token 交换（lib/github.ts OAuth 面——GitHub 出站唯一缝，#223 先例并入）+ token 密封落 provider 行
// apiKeyCipher 槽（只写不读，02 §8——GET 投影永不带值）。
// state 纪律：随机 32 字符、TTL 30min（#243 人环余量：10min 在 M6 联调被
// handoff 间隔撞穿一次——登录/2FA/停顿都算人环）、单次核销（入册即删后交换，
// 防并发双消费）；returnOrigin 取自 authorize 请求的 Origin 头并随 state
// 绑定——callback 302 只回该 origin，token 永不出现在 redirect 参数里。
// #361（spec 12 G2-T4）连接认证族：同 callback 路由，state 条目以 kind
// 判别——provider 族落 provider 行（#231 原语义），github-connection 族
// （shared GITHUB_CONNECTION_OAUTH，scope 加 repo 供 picker 读私仓）交换后
// GET /user 取 login、token+granted scope 落 github_connection 行（重认证
// = 覆盖，DAO 单点）；回跳落点按族分支（routes 层，kind 不可判时默认
// providers 页 = #243 既有律）。

import { GITHUB_CONNECTION_OAUTH, OAUTH_FAMILIES, type SecretBox } from '@cairn/shared';
import type { Db } from '../db/client.js';
import {
  exchangeOAuthCode,
  type FetchLike,
  githubUserLogin,
  type OAuthTokenExchange,
} from '../lib/github.js';
import { newRecordId } from '../lib/ids.js';
import { upsertGithubConnection } from './github-connection.js';
import { createProvider, openProviderKey, updateProvider } from './providers.js';

/** state 在册有效期 [设计]：人环余量——真人走 GitHub 授权页可能叠加登录、
 * 二次验证与中途停顿（#243：M6 联调实测 handoff 间隔 >10min 撞穿旧窗）。 */
export const OAUTH_STATE_TTL_MS = 30 * 60 * 1000;

/** state 在册条目族判别（#361）：provider = #231 订阅族（presetId 定族表
 * 行）；github-connection = 连接认证族（族描述符单点，无 preset 位）。 */
export type OAuthStateKind = 'provider' | 'github-connection';

export type OAuthStateEntry =
  | {
      kind: 'provider';
      teamId: string;
      presetId: string;
      /** authorize 请求的 Origin 头（= web 面 origin；callback 302 回跳根）。 */
      origin: string;
      createdAt: number;
    }
  | {
      kind: 'github-connection';
      teamId: string;
      origin: string;
      createdAt: number;
    };

/** OAuth App client 凭证对（config env 读位；null = 未配置）。四处消费
 * （config/context/helpers/service）共此单源。 */
export interface OAuthClientConfig {
  clientId: string;
  clientSecret: string;
}

export interface OAuthDeps {
  db: Db;
  box: SecretBox;
  states: Map<string, OAuthStateEntry>;
  /** 出站注入位（lib/github.ts OAuth 面；routes 缺省填 globalThis.fetch）。 */
  fetch: FetchLike;
  client: OAuthClientConfig | null;
}

/** 握手失败四族：unknown-family = 族表外 preset（authorize 404）；
 * not-configured = client 凭证未配（authorize 400）；bad-state = state
 * 缺/过期（callback 302 reason=state——过期时 entry 在册故带可信 origin，
 * 不在册时缺、routes 走相对回跳，#243）；exchange-failed = 上游交换败
 * （origin 已知，callback 302 error 回跳；#361 connection 族的 GET /user
 * 失败同归此族——#243 三译词汇表不扩）。 */
export class OAuthFlowError extends Error {
  constructor(
    readonly reason: 'unknown-family' | 'not-configured' | 'bad-state' | 'exchange-failed',
    message: string,
    /** 已知可信回跳根（bad-state 仅过期形携带；不在册形缺）。 */
    readonly origin?: string,
    /** state 在册条目族（bad-state 过期形随 origin 携带；routes 据此选
     * 着陆页，缺 = kind 不可判、默认 providers 落点既有律，#361）。 */
    readonly kind?: OAuthStateKind,
  ) {
    super(message);
    this.name = 'OAuthFlowError';
  }
}

function familyOf(presetId: string) {
  return OAUTH_FAMILIES.find((f) => f.presetId === presetId);
}

/** 惰性清扫过期 state（签发时顺手，无定时器）。 */
function sweep(states: Map<string, OAuthStateEntry>): void {
  const now = Date.now();
  for (const [state, entry] of states) {
    if (now - entry.createdAt > OAUTH_STATE_TTL_MS) states.delete(state);
  }
}

function notConfigured(): OAuthFlowError {
  return new OAuthFlowError(
    'not-configured',
    'oauth client not configured (set CAIRN_GITHUB_OAUTH_CLIENT_ID/CAIRN_GITHUB_OAUTH_CLIENT_SECRET)',
  );
}

/** state 入册 + 授权 URL 拼装（两族共；client 判空归调用方——
 * not-configured 语义在各自公开面抛）。 */
function issueAuthorize(
  deps: OAuthDeps,
  client: OAuthClientConfig,
  entry: OAuthStateEntry,
  target: { authorizeUrl: string; scope: string },
): { authorizationUrl: string } {
  sweep(deps.states);
  const state = newRecordId(32);
  deps.states.set(state, entry);
  const url = new URL(target.authorizeUrl);
  url.searchParams.set('client_id', client.clientId);
  url.searchParams.set('redirect_uri', `${entry.origin}/api/oauth/callback`);
  url.searchParams.set('scope', target.scope);
  url.searchParams.set('state', state);
  return { authorizationUrl: url.toString() };
}

/** authorize 签发（provider 族，#231）：入册 state + 拼授权 URL（web 同页签跳转目标）。 */
export function startOAuthAuthorize(
  deps: OAuthDeps,
  input: { teamId: string; presetId: string; origin: string },
): { authorizationUrl: string } {
  const family = familyOf(input.presetId);
  if (!family) {
    throw new OAuthFlowError('unknown-family', `oauth family ${input.presetId} not found`);
  }
  if (!deps.client) throw notConfigured();
  return issueAuthorize(
    deps,
    deps.client,
    {
      kind: 'provider',
      teamId: input.teamId,
      presetId: input.presetId,
      origin: input.origin,
      createdAt: Date.now(),
    },
    family,
  );
}

/** authorize 签发（github-connection 族，#361）：同 state 纪律，kind 判别
 * 供 callback 分支；scope = read:user repo（GITHUB_CONNECTION_OAUTH 单源）。 */
export function startGithubConnectionAuthorize(
  deps: OAuthDeps,
  input: { teamId: string; origin: string },
): { authorizationUrl: string } {
  if (!deps.client) throw notConfigured();
  return issueAuthorize(
    deps,
    deps.client,
    {
      kind: 'github-connection',
      teamId: input.teamId,
      origin: input.origin,
      createdAt: Date.now(),
    },
    GITHUB_CONNECTION_OAUTH,
  );
}

/** 取 state 并入册核销（单次）；缺/过期 → bad-state（过期形带 entry.origin
 * 供 302 回跳——entry 在册即 origin 可信，#243）。 */
function consumeState(deps: OAuthDeps, state: string): OAuthStateEntry {
  const entry = deps.states.get(state);
  if (!entry) throw new OAuthFlowError('bad-state', `oauth state ${state} not found`);
  deps.states.delete(state);
  if (Date.now() - entry.createdAt > OAUTH_STATE_TTL_MS) {
    throw new OAuthFlowError('bad-state', `oauth state ${state} expired`, entry.origin, entry.kind);
  }
  return entry;
}

/** 回跳参照（#361）：可信 origin + 族判别结伴——routes 落点按 kind 分支、
 * 302 根取 origin。 */
export interface OAuthReturnRef {
  origin: string;
  kind: OAuthStateKind;
}

/** 用户在 provider 站拒绝授权（callback 带 error 无 code）：核销 state，
 * 回 origin + 族判别供 302 error=denied（落点按 kind 分支，#361）。 */
export function abortOAuthCallback(deps: OAuthDeps, state: string): OAuthReturnRef {
  const entry = consumeState(deps, state);
  return { origin: entry.origin, kind: entry.kind };
}

/** token 交换单点（两族共）：502 族一律转译 exchange-failed 回跳（origin/kind
 * 随带——routes 落点按族分支，#361）。 */
async function exchangeToken(
  deps: OAuthDeps,
  client: OAuthClientConfig,
  tokenUrl: string,
  entry: OAuthReturnRef,
  code: string,
): Promise<OAuthTokenExchange> {
  try {
    return await exchangeOAuthCode(deps.fetch, {
      tokenUrl,
      clientId: client.clientId,
      clientSecret: client.clientSecret,
      code,
      redirectUri: `${entry.origin}/api/oauth/callback`,
    });
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    throw new OAuthFlowError('exchange-failed', why, entry.origin, entry.kind);
  }
}

/** callback 完成式（判别 = state 条目 kind，#361）：provider 族带 presetId
 * （着陆 query `provider=` 位）；github-connection 族落新建项目页（着陆
 * query `github=connection` 位，routes 层拼装）。 */
export type OAuthCallbackOutcome =
  | { kind: 'provider'; origin: string; presetId: string }
  | { kind: 'github-connection'; origin: string };

/** callback 收码：核销 state → 按族分支完成。provider 族 = 密封落 provider
 * 行（建行或重密封既有行——重连语义 = 覆盖，不增行）；createdBy = seed 用户
 * id（与表单建行同主语）。github-connection 族 = GET /user 取 login +
 * token/granted scope 落 github_connection 行（重认证 = 覆盖，DAO 单点）。 */
export async function completeOAuthCallback(
  deps: OAuthDeps,
  input: { code: string; state: string; createdBy: string },
): Promise<OAuthCallbackOutcome> {
  const entry = consumeState(deps, input.state);
  if (!deps.client) {
    // 签发后配置被撤：state 已核销，按交换失败回跳。
    throw new OAuthFlowError('exchange-failed', 'oauth client missing', entry.origin, entry.kind);
  }
  if (entry.kind === 'github-connection') {
    const { accessToken, scope } = await exchangeToken(
      deps,
      deps.client,
      GITHUB_CONNECTION_OAUTH.tokenUrl,
      entry,
      input.code,
    );
    let login: string;
    try {
      login = await githubUserLogin(deps.fetch, accessToken);
    } catch (err) {
      // 交换成而 login 读败：归 exchange-failed（三译词汇表不扩，#243）。
      const why = err instanceof Error ? err.message : String(err);
      throw new OAuthFlowError(
        'exchange-failed',
        `github user login fetch failed: ${why}`,
        entry.origin,
        entry.kind,
      );
    }
    upsertGithubConnection(
      { db: deps.db, box: deps.box },
      { teamId: entry.teamId, login, accessToken, scope },
    );
    return { kind: 'github-connection', origin: entry.origin };
  }
  const family = familyOf(entry.presetId);
  if (!family) {
    // 签发后族表收窄：state 已核销，按交换失败回跳。
    throw new OAuthFlowError('exchange-failed', 'oauth family missing', entry.origin, entry.kind);
  }
  const { accessToken } = await exchangeToken(
    deps,
    deps.client,
    family.tokenUrl,
    entry,
    input.code,
  );
  const keyDeps = { db: deps.db, box: deps.box };
  const existing = openProviderKey(keyDeps, entry.teamId, family.presetId);
  if (existing) {
    // 重连 = 重密封（02 §8 只写位三态之 string 覆盖）。
    updateProvider(keyDeps, entry.teamId, existing.row.id, { apiKey: accessToken });
  } else {
    createProvider(keyDeps, {
      teamId: entry.teamId,
      createdBy: input.createdBy,
      body: {
        providerId: family.presetId,
        label: family.providerLabel,
        baseUrl: family.providerBaseUrl,
        api: family.providerApi,
        authHeader: true,
        models: [],
        apiKey: accessToken,
      },
    });
  }
  return { kind: 'provider', origin: entry.origin, presetId: entry.presetId };
}
