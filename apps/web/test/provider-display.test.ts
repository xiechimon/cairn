import type { ModelSourceModel, ProviderFailure, ProviderRecord, ProviderTestResult, RoutingConnection } from '@cairn/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ComponentProps, createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import type { QuotaWindow, SubscriptionAccount, SubscriptionModel } from '../src/api/claude-accounts.js';
import { api } from '../src/api/client.js';
import { MODEL_ROUTING_KEY } from '../src/api/model-routing.js';
import * as liveData from '../src/api/provider.js';
import { PROVIDER_STATUS, ProviderInstanceRow } from '../src/components/providers/provider-panel.js';
import { TooltipProvider } from '../src/components/ui/tooltip.js';
import { AccountsSection } from '../src/design/product-accounts.js';
import { resolveScenario } from '../src/fixtures/scenario.js';
import { I18nProvider } from '../src/i18n/provider.js';
import { ProvidersSection } from '../src/resources/providers-page.js';
import { providerRowStatus, teamProviderStatusView } from '../src/resources/subscription-detail.js';

vi.mock('../src/fixtures/scenario.js', { spy: true });
afterEach(() => vi.restoreAllMocks());

const NOW = Date.UTC(2026, 10, 16, 16);
const HOUR = 3_600_000;
const CLAUDE: SubscriptionAccount = {
  id: 'claude-work',
  vendor: 'claude',
  label: 'Claude subscription — International Design and Engineering Workspace',
  expiresAt: null,
  createdAt: NOW - 30 * HOUR,
  plan: 'Max',
  state: 'ok',
  cooldownUntil: null,
  windows: [],
  lastUsedAt: NOW - 6 * HOUR,
  stepsLast24h: 5,
};
const CLAUDE_MODELS: ModelSourceModel[] = ['opus', 'sonnet', 'haiku'].map((family) => ({
  id: `claude-${family}-5-5`,
  name: `Claude ${family} 5.5`,
  updateRequired: { runtime: 'claude-code', current: '2.0.0', required: '2.1.0' },
}));

function windowOf(name: string, utilization: number, resetsAt: number | null): QuotaWindow {
  return { name, utilization, resetsAt, observedAt: NOW };
}

function renderAccount(
  account: SubscriptionAccount | null,
  models: ModelSourceModel[] = [],
  providers: ProviderRecord[] = [],
  connections: RoutingConnection[] = providers.map((record) => ({
    id: record.id,
    vendor: 'anthropic',
    kind: 'api-key',
    models: record.models.map((model) => model.id),
    available: true,
  })),
) {
  vi.mocked(resolveScenario).mockReturnValue({
    todos: [],
    now: NOW,
    resources: {
      skills: [],
      mcpServers: [],
      machines: [],
      providers,
      providerSources: [
        {
          runtime: account === null ? 'pi' : account.vendor === 'devin' ? 'devin' : account.vendor === 'antigravity' ? 'antigravity' : 'claude-code',
          installed: true,
          hostname: 'runner',
          ...(providers[0] === undefined ? {} : { provider: providers[0].providerId }),
          models,
        },
      ],
      accounts: {
        subscriptions: account?.vendor === 'claude' ? [account] : [],
        devinSubscriptions: account?.vendor === 'devin' ? [account] : [],
        antigravitySubscriptions: account?.vendor === 'antigravity' ? [account] : [],
        otherAccounts: [],
        machines: [],
        providers: [],
        routing: { edges: [], connections, quota: [] },
      },
    },
  });
  const html = renderProviderPage(new QueryClient());
  return {
    row: html.slice(
      html.lastIndexOf('<', html.indexOf('data-testid="provider-instance"')),
      html.lastIndexOf('<', html.indexOf('data-testid="provider-editor"')),
    ),
    detail: html.slice(html.indexOf('data-testid="provider-editor"')),
  };
}

function renderProviderPage(client: QueryClient) {
  return renderToStaticMarkup(
    createElement(I18nProvider, {
      initialLocale: 'zh',
      children: createElement(QueryClientProvider, {
        client,
        children: createElement(MemoryRouter, {
          children: createElement(TooltipProvider, null, createElement(ProvidersSection)),
        }),
      }),
    }),
  );
}

it.each([false, true].flatMap((metadata) =>
  (['pending', 'error', 'success'] as const).map((connectionState) => ({ metadata, connectionState })),
))('renders provider data with metadata=$metadata when connection state is $connectionState', async ({ metadata, connectionState }) => {
  const teamId = 'provider-display-team';
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  vi.spyOn(liveData, 'useLiveData').mockReturnValue({
    live: true, teamId, userName: 'Test user',
    user: { displayName: 'Test user', avatarUrl: null }, teamsQuery: undefined,
  });
  for (const key of ['claude-subscriptions', 'devin-subscriptions', 'antigravity-subscriptions']) {
    client.setQueryData([key, teamId], []);
  }
  client.setQueryData(['model-sources', teamId], { sources: [] });
  client.setQueryData(['providers', teamId], { providers: [], presets: [], order: null });
  const record = {
    id: 'provider-a', providerId: 'anthropic', label: 'Engineering provider', kind: 'custom',
    baseUrl: 'https://models.example.test/v1', api: 'anthropic-messages', authHeader: true,
    models: [{ id: 'current', name: 'Current' }],
    configurationFingerprint: 'a'.repeat(32),
    ...(metadata ? { createdBy: 'test-user', createdAt: NOW, updatedAt: NOW } : {}),
  };
  const queryKey = [MODEL_ROUTING_KEY, teamId];
  const get = vi.spyOn(api, 'get');
  try {
    renderProviderPage(client);
    const routingQuery = client.getQueryCache().find({ queryKey });
    if (routingQuery === undefined) throw new Error('Connection query was not registered');
    if (connectionState === 'error') {
      const error = new Error('Connection state request failed');
      get.mockRejectedValueOnce(error);
      await expect(routingQuery.fetch()).rejects.toBe(error);
    } else if (connectionState === 'success') {
      get.mockResolvedValueOnce({
        edges: [], quota: [],
        connections: [{ id: record.id, vendor: 'anthropic', kind: 'api-key', models: ['current'], available: true }],
      });
      await routingQuery.fetch();
    }
    expect(client.getQueryState(queryKey)?.status).toBe(connectionState);
    if (connectionState === 'pending') expect(get).not.toHaveBeenCalled();
    else expect(get).toHaveBeenCalledExactlyOnceWith(`/api/teams/${teamId}/model-routing`);
    client.setQueryData(['providers', teamId], { providers: [record], presets: [], order: null });
    const html = renderProviderPage(client);
    expect(html.match(/data-testid="provider-instance"/g)).toHaveLength(1);
    expect(html).toContain('data-instance-id="provider:provider-a"');
    expect(html).toContain('aria-label="Engineering provider API key · 1 个模型 未检查"');
    expect(html).toContain('data-testid="provider-editor"');
    expect(html).toContain('data-model-id="current"');
    expect(html).not.toMatch(/data-testid="query-(loading|error)"/);
  } finally {
    client.clear();
  }
});

it('keeps update and last-use text out of the row and shows each fact once in the pane', () => {
  const { row, detail } = renderAccount(CLAUDE, CLAUDE_MODELS);
  expect(row).toContain(CLAUDE.label);
  expect(row).not.toContain('最近使用');
  const subtitle = row.match(/data-testid="provider-subtitle"[^>]*>([^<]*)<\/span>/)?.[1];
  expect(subtitle).toBe('订阅 · 3 个模型');
  expect(subtitle).not.toMatch(/更新 Cairn|需要新版 Cairn|最近使用/);
  expect(row).toContain('data-tone="warn"');
  expect(detail.match(/最近使用/g)).toHaveLength(1);
  expect(detail.match(/3 个模型需要新版 Cairn/g)).toHaveLength(1);
  expect(detail).not.toContain('需要更新 Cairn');
});

it('keeps retired models needing an update in the single notice', () => {
  const models: ModelSourceModel[] = [
    { id: 'claude-opus-5-5', name: 'Claude Opus 5.5' },
    {
      id: 'claude-sonnet-5-5',
      name: 'Claude Sonnet 5.5',
      updateRequired: { runtime: 'claude-code', current: '2.0.0', required: '2.1.0' },
    },
    {
      id: 'claude-haiku-5-5',
      name: 'Claude Haiku 5.5',
      liveness: 'dead',
      updateRequired: { runtime: 'claude-code', current: '2.0.0', required: '2.1.0' },
    },
  ];
  const { row, detail } = renderAccount(CLAUDE, models);
  const notices = [...detail.matchAll(/<p[^>]*>[^<]*需要新版 Cairn[^<]*<\/p>/g)];
  expect(notices).toHaveLength(1);
  expect(notices[0]?.[0]).toContain('2 个模型需要新版 Cairn');
  expect(notices[0]?.[0]).toContain('claude-sonnet-5-5');
  expect(notices[0]?.[0]).toContain('claude-haiku-5-5');
  expect(notices[0]?.[0]).not.toContain('claude-opus');
  expect(detail).toContain('data-model-id="claude-haiku-5-5" data-liveness="dead"');
  expect(detail).toContain('已下架');
  const subtitle = row.match(/data-testid="provider-subtitle"[^>]*>([^<]*)<\/span>/)?.[1];
  expect(subtitle).toBe('订阅 · 3 个模型');
  expect(subtitle).not.toMatch(/需要新版 Cairn|最近使用/);
});

it.each([null, 'Max', 'InternationalDesignAndEngineeringWorkspaceAnnualSubscriptionPlan'])(
  'lets detail metadata wrap without clipping last use beside Verify for plan %s',
  (plan) => {
    const { detail } = renderAccount({ ...CLAUDE, plan });
    const metadata = detail.match(
      /<span[^>]*class="([^"]+)"[^>]*>订阅[^<]*最近使用[^<]*<\/span>/,
    );
    expect(metadata).not.toBeNull();
    expect(metadata?.[1]?.split(' ')).not.toContain('truncate');
    expect(metadata?.[1]?.split(' ')).toContain('wrap-anywhere');
    expect(detail.match(/最近使用/g)).toHaveLength(1);
    expect(detail).toContain('data-testid="subscription-verify"');
  },
);

it.each(['Claude', CLAUDE.label])(
  'lets the name and subtitle block grow beside the fixed quota badge for %s',
  (label) => {
    const { row } = renderAccount({
      ...CLAUDE,
      label,
      windows: [windowOf('seven_day', 0.7, null)],
    });
    const select = row.match(/<button[^>]*class="([^"]+)"/)?.[1];
    expect(select?.split(' ')).toEqual(expect.arrayContaining(['min-w-0', 'flex-1']));
    const content = row.match(
      /<span class="([^"]+)"><span class="flex min-w-0 items-center gap-2">/,
    )?.[1];
    expect(content?.split(' ')).toEqual(
      expect.arrayContaining(['min-w-0', 'flex-1', 'flex-col']),
    );
    const badge = row.match(/data-testid="subscription-quota-mini"[^>]*class="([^"]+)"/)?.[1];
    expect(badge?.split(' ')).toContain('flex-none');
  },
);

it('shares quota columns so equal percentages keep equal tracks with and without resets', () => {
  const windows = [windowOf('five_hour', 0.7, NOW + 2 * HOUR), windowOf('seven_day', 0.7, null)];
  const { detail } = renderAccount({ ...CLAUDE, windows });
  expect(detail).toContain('grid-cols-[minmax(0,1fr)_minmax(0,1fr)_max-content_max-content]');
  const rows = [...detail.matchAll(/data-testid="subscription-quota-window"[^>]*class="([^"]+)"/g)];
  expect(rows).toHaveLength(windows.length);
  for (const row of rows) {
    expect(row[1]?.split(' ')).toEqual(expect.arrayContaining(['grid', 'col-span-full', 'grid-cols-subgrid']));
  }
  const bars = [...detail.matchAll(/role="progressbar"[^>]*aria-valuenow="(\d+)"[^>]*class="([^"]+)"/g)];
  expect(bars).toHaveLength(windows.length);
  expect(bars.map((bar) => bar[1])).toEqual(['30', '30']);
  expect(bars.map((bar) => bar[2])).toEqual([bars[0]?.[2], bars[0]?.[2]]);
  expect(detail.match(/data-testid="subscription-quota-reset"/g)).toHaveLength(1);
});

it('isolates a long quota name from the untruncated remaining value and reset time', () => {
  const name =
    'seven_day_enterprise_international_design_and_engineering_workspace_sonnet_limit';
  const label =
    'Seven day enterprise international design and engineering workspace sonnet limit';
  const { detail } = renderAccount({
    ...CLAUDE,
    windows: [windowOf(name, 0.93, NOW + 73 * HOUR)],
  });
  const quotaRow = detail.match(/data-testid="subscription-quota-window"[^>]*class="([^"]+)"/);
  expect(quotaRow?.[1]?.split(' ')).toEqual(
    expect.arrayContaining(['grid', 'grid-cols-subgrid', 'items-center']),
  );
  expect(quotaRow?.[1]?.split(' ')).not.toContain('flex-col');
  const heading = detail.match(
    /data-testid="subscription-quota-name"[^>]*title="([^"]+)"[^>]*class="([^"]+)"[^>]*>([^<]+)<\/span>/,
  );
  expect(heading?.[1]).toBe(label);
  expect(heading?.[2]?.split(' ')).toEqual(
    expect.arrayContaining(['min-w-0', 'truncate']),
  );
  expect(heading?.[3]).toBe(label);
  const remaining = detail.match(
    /data-testid="subscription-quota-remaining"[^>]*aria-label="([^"]+)"[^>]*class="([^"]+)"[^>]*>([^<]+)<\/span>/,
  );
  expect(remaining?.[1]).toBe(`${label} 剩 7%`);
  expect(remaining?.[2]?.split(' ')).toEqual(
    expect.arrayContaining(['flex-none', 'whitespace-nowrap']),
  );
  expect(remaining?.[3]).toBe('剩 7%');
  const reset = detail.match(/data-testid="subscription-quota-reset"[^>]*class="([^"]+)"/);
  expect(reset?.[1]?.split(' ')).toEqual(
    expect.arrayContaining(['flex-none', 'whitespace-nowrap']),
  );
  expect(reset?.[1]?.split(' ')).not.toContain('truncate');
});

it.each([
  { utilization: 0.61, percent: '39%', other: [] },
  { utilization: 0.7, percent: '30%', other: [] },
  { utilization: 0.93, percent: '7%', other: [windowOf('five_hour', 0.2, null)] },
].flatMap((reading) => [
  { ...reading, modelState: 'current', models: [{ id: 'current', name: 'Current' }] },
  { ...reading, modelState: 'update required', models: CLAUDE_MODELS },
]).flatMap((scenario) => [CLAUDE.lastUsedAt, null].map((lastUsedAt) => ({ ...scenario, lastUsedAt }))))(
  'C1: matches the $percent quota reading with $modelState model picks and lastUsedAt=$lastUsedAt without adding subtitle metadata',
  ({ utilization, percent, other, models, lastUsedAt }) => {
    const { row, detail } = renderAccount({
      ...CLAUDE,
      lastUsedAt,
      windows: [...other, windowOf('seven_day', utilization, NOW + 73 * HOUR)],
    }, models);
    const subtitle = row.match(/data-testid="provider-subtitle"[^>]*>([^<]*)<\/span>/)?.[1];
    expect(subtitle).toBe(`订阅 · ${models.length} 个模型`);
    expect(subtitle).not.toMatch(/更新|新版|最近使用|尚未使用/);
    const badge = row.match(
      /data-testid="subscription-quota-mini"[^>]*>([^<]+)<\/span>/,
    )?.[1];
    const remaining = detail.match(
      /data-testid="subscription-quota-remaining"[^>]*aria-label="每周 剩 [^"]+"[^>]*>([^<]+)<\/span>/,
    )?.[1];
    expect(badge).toBe(remaining);
    expect(remaining).toBe(`剩 ${percent}`);
    expect(row.replace(/<[^>]*>/g, '')).toBe(`${CLAUDE.label}订阅 · ${models.length} 个模型${badge}`);
    expect(row).not.toMatch(/>5h \d+%/);
    expect(row).toContain('data-window="seven_day"');
    expect(row).toContain(`aria-label="每周 剩 ${percent}"`);
    expect(detail).toMatch(/· [^<>]+ 重置<\/span>/);
  },
);

it.each(['five_hour', 'seven_day', 'billing_period', 'monthly_limit'])(
  'uses warning text ink for low %s quota in both the row and detail',
  (name) => {
    const { row, detail } = renderAccount({
      ...CLAUDE,
      windows: [windowOf(name, 0.93, null)],
    });
    for (const [html, testId] of [
      [row, 'subscription-quota-mini'],
      [detail, 'subscription-quota-remaining'],
    ]) {
      const classes = html?.match(new RegExp(`data-testid="${testId}"[^>]*class="([^"]+)"`))?.[1];
      expect(classes?.split(' ')).toContain('text-tint-wait-ink');
      expect(classes?.split(' ')).not.toContain('text-(--card-button)');
    }
  },
);

it('shows billing-period quota even when neither a five-hour nor weekly window is reported', () => {
  const { row, detail } = renderAccount({
    ...CLAUDE,
    windows: [windowOf('billing_period', 0.4, null)],
  });
  expect(row).toContain('>剩 60%<');
  expect(row).toContain('aria-label="计费周期 剩 60%"');
  expect(detail).toContain('>计费周期</span>');
  expect(detail).toContain('aria-label="计费周期 剩 60%"');
  expect(detail).toContain('>剩 60%</span>');
  expect(detail).not.toContain('data-testid="subscription-quota-reset"');
});

it.each([
  { name: 'seven_day_sonnet', label: 'Seven day sonnet' },
  { name: 'seven-day-opus', label: 'Seven day opus' },
  { name: 'sevenDayHaiku', label: 'Seven day haiku' },
  {
    name: 'seven_day_enterprise_international_design_and_engineering_workspace_sonnet_limit',
    label: 'Seven day enterprise international design and engineering workspace sonnet limit',
  },
])('keeps the upstream window $name distinct at the same percentage', ({ name, label }) => {
  const { row, detail } = renderAccount({
    ...CLAUDE,
    windows: [windowOf(name, 0.93, null), windowOf('monthly_limit', 0.93, null)],
  });
  const remaining = `${label} 剩 7%`;
  expect(detail).toContain(`title="${label}"`);
  expect(detail).toContain(`>${label}</span>`);
  expect(detail).toContain('>Monthly limit</span>');
  expect(detail).toContain('aria-label="Monthly limit 剩 7%"');
  expect(detail).toContain(`aria-label="${label} 剩余"`);
  expect(detail).toContain('aria-label="Monthly limit 剩余"');
  expect(row).toContain(`data-window="${name}"`);
  const badge = row.match(/data-testid="subscription-quota-mini"[^>]*>([^<]+)<\/span>/)?.[1];
  expect(badge).toBe('剩 7%');
  const values = [...detail.matchAll(
    /data-testid="subscription-quota-remaining"[^>]*>(剩 \d+%)<\/span>/g,
  )];
  expect(values).toHaveLength(2);
  expect(values.map((value) => value[1])).toEqual([badge, badge]);
  expect(detail).toContain(`aria-label="${remaining}"`);
  expect(row).toContain(`aria-label="${remaining}"`);
  expect(row).toContain(`title="${remaining}"`);
  const subtitle = row.match(/data-testid="provider-subtitle"[^>]*>([^<]*)<\/span>/)?.[1];
  expect(subtitle).not.toMatch(/需要新版 Cairn|最近使用/);
});

it.each((['claude', 'antigravity', 'devin'] as const).flatMap((vendor) => [
  { vendor, state: 'cooling', cooldownUntil: null, status: '冷却中' },
  { vendor, state: 'cooling', cooldownUntil: NOW + HOUR, status: '冷却至' },
  { vendor, state: 'exhausted', cooldownUntil: null, status: '额度用尽' },
  { vendor, state: 'exhausted', cooldownUntil: NOW + HOUR, status: '额度用尽' },
  { vendor, state: 'expired', cooldownUntil: null, status: '已过期' },
] as const))(
  'keeps $vendor $state in the row button name without changing its subtitle',
  ({ vendor, state, cooldownUntil, status }) => {
    const { row, detail } = renderAccount({ ...CLAUDE, vendor, state, cooldownUntil }, CLAUDE_MODELS);
    const detailStatus = detail.match(
      /data-testid="subscription-status"[^>]*><span[^>]*><\/span>([^<]+)<\/span>/,
    )?.[1];
    expect(detailStatus).toContain(status);
    if (state === 'exhausted' && cooldownUntil !== null) expect(detail).toContain('1 小时后恢复');
    if (state === 'expired') expect(detail).toContain('这个订阅已过期');
    const label = row.match(/<button\b[^>]*aria-label="([^"]*)"/)?.[1];
    expect(label).toContain(detailStatus);
    const subtitle = row.match(/data-testid="provider-subtitle"[^>]*>([^<]*)<\/span>/)?.[1];
    expect(subtitle).toBe('订阅 · 3 个模型');
    expect(subtitle).not.toMatch(/需要新版 Cairn|最近使用|冷却|额度用尽|已过期/);
  },
);

it.each((['claude', 'antigravity', 'devin'] as const).flatMap((vendor) => [
  { vendor, state: 'cooling', icon: 'clock-3' },
  { vendor, state: 'exhausted', icon: 'circle-minus' },
  { vendor, state: 'expired', icon: 'circle-x' },
] as const))('distinguishes $vendor $state without color or visible status words', ({ vendor, state, icon }) => {
  for (const models of [[], CLAUDE_MODELS]) {
    const { row } = renderAccount({ ...CLAUDE, vendor, state }, models);
    expect(row).toMatch(new RegExp(`<svg(?=[^>]*aria-hidden="true")[^>]*class="[^"]*lucide-${icon}[^"]*"`));
    expect(row.replace(/<[^>]*>/g, '')).toBe(`${CLAUDE.label}订阅 · ${models.length} 个模型`);
  }
});

it('uses existing readable ink only inside provider rows and details', () => {
  const { row, detail } = renderAccount({ ...CLAUDE, windows: [windowOf('seven_day', 0.4, null)] });
  for (const testId of ['provider-subtitle', 'subscription-quota-mini']) {
    const classes = row.match(new RegExp(`data-testid="${testId}"[^>]*class="([^"]+)"`))?.[1];
    expect(classes?.split(' ')).toContain('text-content-secondary');
  }
  expect(detail).toContain('[&amp;_.text-content-tertiary]:text-content-secondary');
  expect(detail).toContain('[&amp;_[data-variant=destructive]]:text-foreground');
});

it.each(['claude', 'antigravity', 'devin'] as const)(
  'preserves every base subscription field for %s',
  (vendor) => {
    const models: (ModelSourceModel & SubscriptionModel)[] = [
      { id: 'current-model', name: 'Current model', costTier: 'standard', contextTokens: 200_000 },
      { id: 'retired-model', name: 'Retired model', liveness: 'dead' },
      { id: 'new-model', name: 'New model', updateRequired: { runtime: 'claude-code', current: '2.0', required: '2.1' } },
    ];
    const { row, detail } = renderAccount({
      ...CLAUDE,
      vendor,
      models,
      windows: [windowOf('five_hour', 0.2, NOW + HOUR), windowOf('seven_day', 0.7, NOW + 73 * HOUR), windowOf('billing_period', 0.4, null)],
    }, models);
    expect(row).toContain(CLAUDE.label);
    expect(row).toContain('订阅 · 3 个模型');
    for (const field of ['Max', '最近使用', '5 小时', '每周', '计费周期', '剩 80%', '剩 30%', '剩 60%', '重置', 'current-model', 'retired-model', 'new-model', '已下架', '1 个模型需要新版 Cairn', '200K', '移除订阅']) {
      expect(detail, `${vendor}: ${field}`).toContain(field);
    }
    expect(detail).toContain('data-liveness="dead"');
    expect(detail).toMatch(/data-testid="subscription-models-summary"[^>]*>3 个 · 已下架 · 1 个模型<\/span>/);
  },
);

it.each(['claude', 'antigravity', 'devin'] as const)(
  'preserves the 24-hour count for every %s quota-window combination',
  (vendor) => {
    for (const windows of [[], [windowOf('seven_day_sonnet', 0.4, null)], [windowOf('seven_day', 0.4, null)], [windowOf('seven_day', 0.4, null), windowOf('seven_day_sonnet', 0.7, null)]]) {
      const { detail } = renderAccount({ ...CLAUDE, vendor, windows, stepsLast24h: 17 });
      expect(detail, `${vendor}: ${windows.map((window) => window.name).join(',')}`).toContain('近 24 小时');
      expect(detail).toContain('17 次运行');
      expect(detail.match(/17 次运行/g)).toHaveLength(1);
    }
  },
);

it.each(['claude', 'antigravity', 'devin'] as const)(
  'names every model warning and healthy status for %s without changing the subtitle',
  (vendor) => {
    const cases: { models: ModelSourceModel[]; labels: string[]; tone: string }[] = [
      { models: [], labels: ['需要处理'], tone: 'warn' },
      { models: [{ id: 'current', name: 'Current' }], labels: ['可用'], tone: 'ok' },
      { models: [{ id: 'retired', name: 'Retired', liveness: 'dead' }], labels: ['已下架', '1 个模型'], tone: 'warn' },
      { models: CLAUDE_MODELS, labels: ['3 个模型需要新版 Cairn'], tone: 'warn' },
      { models: [{ ...CLAUDE_MODELS[0]!, liveness: 'dead' }], labels: ['已下架', '1 个模型', '1 个模型需要新版 Cairn'], tone: 'warn' },
    ];
    for (const { models, labels, tone } of cases) {
      const { row } = renderAccount({ ...CLAUDE, vendor }, models);
      expect(row).toContain(`data-tone="${tone}"`);
      const label = row.match(/<button\b[^>]*aria-label="([^"]*)"/)?.[1];
      expect(label).toBeDefined();
      expect(label).not.toContain('没有模型');
      for (const reason of labels) expect(label).toContain(reason);
      const subtitle = row.match(/data-testid="provider-subtitle"[^>]*>([^<]*)<\/span>/)?.[1];
      expect(subtitle).toBe(`订阅 · ${models.length} 个模型`);
      expect(subtitle).not.toMatch(/更新|新版|最近使用|已下架|可用/);
    }
  },
);

it.each(['anthropic', 'custom-endpoint'])(
  'preserves every base field and names each status for provider %s',
  (providerId) => {
    for (const status of ['healthy', 'retired', 'empty'] as const) {
      const models: ModelSourceModel[] = status === 'empty' ? [] : [{ id: 'model-id', name: 'Model', ...(status === 'retired' ? { liveness: 'dead' as const } : {}) }];
      const record: ProviderRecord = {
        kind: 'custom', providerId, id: 'provider-test', label: 'Engineering provider',
        baseUrl: 'https://models.example.test/v1', api: 'anthropic-messages', authHeader: true,
        compat: {}, configurationFingerprint: 'a'.repeat(32),
        models: models.map(({ id, name }) => ({ id, name })),
        createdBy: 'owner-test', createdAt: NOW, updatedAt: NOW,
      };
      const { row, detail } = renderAccount(null, models, [record]);
      const kind = providerId === 'anthropic' ? 'API key' : '自定义端点';
      const subtitle = row.match(/data-testid="provider-subtitle"[^>]*>([^<]*)<\/span>/)?.[1];
      expect(subtitle).toBe(`${kind} · ${models.length} 个模型`);
      expect(row).toContain(`data-tone="${status === 'healthy' ? 'off' : 'warn'}"`);
      const label = row.match(/<button\b[^>]*aria-label="([^"]*)"/)?.[1];
      expect(label).toBeDefined();
      if (status === 'empty') {
        const glyph = row.match(/data-testid="provider-status-mark"[^>]*aria-label="([^"]*)"/)?.[1];
        expect(glyph).toBe('未检查 · 需要处理');
        expect(label).toBe(`${record.label} ${kind} · 0 个模型 ${glyph}`);
      } else expect(label).toContain(status === 'healthy' ? '未检查' : '已下架');
      if (status === 'retired') expect(label).toContain('1 个模型');
      for (const field of [record.label, kind, '名称', '协议', 'Anthropic Messages', '地址', record.baseUrl, 'API key', '已加密保存', '从上游选择', '全部测试', '移除服务商']) expect(detail).toContain(field);
      if (status !== 'empty') expect(detail).toContain('model-id');
      if (status === 'retired') expect(detail).toMatch(/data-testid="provider-models-summary"[^>]*>1 个 · 已下架 · 1 个模型<\/span>/);
    }
  },
);

it.each((['claude', 'antigravity', 'devin'] as const).flatMap((vendor) => [
  { vendor, state: 'ok', status: ' 需要处理' },
  { vendor, state: 'cooling', status: ' 冷却中' },
  { vendor, state: 'exhausted', status: ' 额度用尽' },
  { vendor, state: 'expired', status: ' 已过期' },
] as const))('does not repeat zero models in the $vendor $state row name', ({ vendor, state, status }) => {
  const { row } = renderAccount({ ...CLAUDE, vendor, state, label: 'Claude' });
  const label = row.match(/<button\b[^>]*aria-label="([^"]*)"/)?.[1];
  expect(label).toBe(`Claude 订阅 · 0 个模型${status}`);
  expect(row.replace(/<[^>]*>/g, '')).toBe('Claude订阅 · 0 个模型');
});

it.each(['claude', 'antigravity', 'devin'] as const)(
  'C1 A3: the zero-model %s warning and row button share one status without repeating the count',
  (vendor) => {
    const { row } = renderAccount({ ...CLAUDE, vendor, label: 'Work subscription' });
    const name = row.match(/<button\b[^>]*aria-label="([^"]*)"/)?.[1];
    const status = row.match(/data-testid="provider-status-mark"[^>]*aria-label="([^"]*)"/)?.[1];
    expect(status).toBe('需要处理');
    expect(name).toBe(`Work subscription 订阅 · 0 个模型 ${status}`);
    expect(name?.match(/0 个模型/g)).toHaveLength(1);
    expect(row).toContain('data-status="warn"');
    expect(row.replace(/<[^>]*>/g, '')).toBe('Work subscription订阅 · 0 个模型');
  },
);

it.each(['claude', 'antigravity', 'devin'] as const)(
  'C1: the %s model update warning uses the same wording in the glyph and button',
  (vendor) => {
    const { row } = renderAccount({ ...CLAUDE, vendor }, CLAUDE_MODELS);
    const name = row.match(/<button\b[^>]*aria-label="([^"]*)"/)?.[1];
    const status = row.match(/data-testid="provider-status-mark"[^>]*aria-label="([^"]*)"/)?.[1];
    expect(status).toBe('3 个模型需要新版 Cairn');
    expect(name).toContain(status);
  },
);

function renderRow(props: ComponentProps<typeof ProviderInstanceRow>) {
  return renderToStaticMarkup(createElement(I18nProvider, {
    initialLocale: 'zh',
    children: createElement(ProviderInstanceRow, props),
  }));
}

it('keeps the visible version in the accessible row name without adding status text nodes', () => {
  const row = renderRow({
    item: { id: 'versioned', name: 'Versioned provider', Mark: () => null, version: '1.2.3', status: 'API key · 1 model', statusLabel: 'Available', tone: 'ok', statusGlyph: 'ok' },
    selected: false,
    onSelect: () => undefined,
  });
  expect(row).toContain('aria-label="Versioned provider v1.2.3 API key · 1 model Available"');
  expect(row.replace(/<[^>]*>/g, '')).toBe('Versioned providerv1.2.3API key · 1 model');
});

it.each([false, true])('keeps off row text at full opacity when selected=%s', (selected) => {
  const row = renderRow({
    item: { id: 'cooling', name: 'Cooling subscription', Mark: () => null, status: 'Subscription · 1 model', statusLabel: 'Cooling', tone: 'off', statusGlyph: 'cooling' },
    selected,
    onSelect: () => undefined,
  });
  const classes = row.match(/<button\b[^>]*class="([^"]+)"/)?.[1]?.split(' ');
  expect(classes?.filter((token) => /^opacity-/.test(token))).toEqual([]);
});

it.each([
  { providerId: 'anthropic', authHeader: true, available: false, label: '填写 API key', tone: 'warn' },
  { providerId: 'github-copilot', authHeader: true, available: false, label: '未登录', tone: 'warn' },
  { providerId: 'openai-codex', authHeader: true, available: false, label: '未登录', tone: 'warn' },
  { providerId: 'anthropic', authHeader: true, available: true, label: '未检查', tone: 'off' },
  { providerId: 'custom-endpoint', authHeader: false, available: undefined, label: '未检查', tone: 'off' },
  { providerId: 'anthropic', authHeader: false, available: undefined, label: '未检查', tone: 'off' },
  { providerId: 'anthropic', authHeader: false, available: true, label: '未检查', tone: 'off' },
  { providerId: 'anthropic', authHeader: true, available: undefined, label: '未检查', tone: 'off' },
])('announces $label for $providerId with connection availability $available', ({ providerId, authHeader, available, label, tone }) => {
  const record: ProviderRecord = {
    kind: 'custom', providerId, id: 'connection-state', label: 'Engineering provider',
    baseUrl: 'https://models.example.test/v1', api: 'anthropic-messages', authHeader,
    compat: {}, configurationFingerprint: 'a'.repeat(32),
    models: [{ id: 'current-model', name: 'Current model' }],
    createdBy: 'owner-test', createdAt: NOW, updatedAt: NOW,
  };
  const connections: RoutingConnection[] = available === undefined ? [] : [{
    id: record.id, vendor: 'anthropic', kind: 'api-key', models: ['current-model'], available,
  }];
  const { row } = renderAccount(null, record.models, [record], connections);
  const name = row.match(/<button\b[^>]*aria-label="([^"]*)"/)?.[1];
  expect(name).toContain(label);
  if (tone !== 'ok') expect(name).not.toContain('可用');
  expect(row).toContain(`data-tone="${tone}"`);
  const subtitle = row.match(/data-testid="provider-subtitle"[^>]*>([^<]*)<\/span>/)?.[1];
  expect(subtitle).not.toMatch(/更新|新版|最近使用|填写|未登录|可用|未检查/);
});

it.each([
  { failure: 'auth', label: 'API key 无效' },
  { failure: 'network', label: '无法连接' },
  { failure: 'timeout', label: '超时' },
  { failure: 'rate-limit', label: '限流' },
  { failure: 'not-found', label: '模型不存在' },
  { failure: 'upstream', label: '上游出错' },
  { failure: 'invalid', label: '响应异常' },
  { failure: 'no-model', label: '没有模型' },
  { failure: null, label: '无法连接服务商' },
] satisfies { failure: ProviderFailure | null; label: string }[])(
  'does not announce availability after a $failure connection test',
  ({ failure, label }) => {
    const record = {
      kind: 'custom', providerId: 'anthropic', id: 'tested-provider', label: 'Engineering provider',
      baseUrl: 'https://models.example.test/v1', api: 'anthropic-messages', authHeader: true,
      compat: {}, configurationFingerprint: 'a'.repeat(32),
      models: [{ id: 'current', name: 'Current' }],
      createdBy: 'owner-test', createdAt: NOW, updatedAt: NOW,
    } satisfies ProviderRecord;
    const result: ProviderTestResult = {
      status: 'failed', failure, reason: 'Internal diagnostic', detail: null, httpStatus: null, latencyMs: null,
    };
    const t = (key: string) => key;
    const connections: RoutingConnection[] = [{
      id: record.id, vendor: 'anthropic', kind: 'api-key', models: ['current'], available: true,
    }];
    const fingerprint = record.configurationFingerprint;
    const check = { [fingerprint]: { current: result } };
    const passed = { ...result, status: 'ok' as const, failure: null };
    const passedCheck = { [fingerprint]: { current: passed } };
    const { configurationFingerprint: _, ...legacy } = record;
    expect(teamProviderStatusView(legacy, connections, {
      ...passedCheck,
      undefined: { current: passed },
    }, t)).toMatchObject({ tone: 'off', label: '未检查' });
    const status = providerRowStatus(teamProviderStatusView(record, connections, check, t), record.models, t);
    expect(status).toMatchObject({ tone: 'fail', statusLabel: label });
    expect(status.statusLabel).not.toMatch(/可用|Internal diagnostic/);
    const oauth = teamProviderStatusView({ ...record, providerId: 'openai-codex' }, connections, check, t);
    expect(oauth.label).toBe(failure === 'auth' ? '未登录' : label);
    const staleRouting = teamProviderStatusView(record, [{ ...connections[0]!, available: false }], passedCheck, t);
    expect(staleRouting.tone).toBe('ok');
    const passedView = teamProviderStatusView(record, connections, passedCheck, t);
    expect(providerRowStatus(passedView, record.models, t)).toMatchObject({ tone: 'ok', statusLabel: '可用' });
    expect(providerRowStatus(passedView, [], t).statusLabel).toBe('需要处理');
    expect(teamProviderStatusView(record, [], passedCheck, t).tone).toBe('ok');
    expect(teamProviderStatusView(record, connections, { ['b'.repeat(32)]: { current: result } }, t).tone).toBe('off');
    expect(teamProviderStatusView(record, connections, { [fingerprint]: { removed: result } }, t).tone).toBe('off');
    expect(teamProviderStatusView(record, [{ ...connections[0]!, id: 'unrelated' }], undefined, t)).toMatchObject({ tone: 'off', label: '未检查' });
    const mixed = { ...record, models: [...record.models, { id: 'second', name: 'Second model' }] };
    expect(teamProviderStatusView(mixed, connections, {
      [fingerprint]: { current: result, second: passed },
    }, t)).toMatchObject({ tone: 'fail', label });
  },
);

it('does not announce availability for a subscription without a token', () => {
  const { row, detail } = renderAccount({ ...CLAUDE, vendor: 'antigravity', hasToken: false }, [{ id: 'current', name: 'Current' }]);
  expect(row).toContain('data-tone="warn"');
  expect(row.match(/<button\b[^>]*aria-label="([^"]*)"/)?.[1]).toContain('未登录');
  expect(row.match(/<button\b[^>]*aria-label="([^"]*)"/)?.[1]).not.toContain('可用');
  expect(detail).toMatch(/data-testid="subscription-status"[^>]*><span[^>]*><\/span>未登录/);
});

it.each([
  { label: 'Work', state: 'cooling', icon: 'clock-3' },
  { label: 'Old laptop', state: 'expired', icon: 'circle-x' },
] as const)('shares the $state glyph between the specimen and live list', ({ label, state, icon }) => {
  const specimen = renderToStaticMarkup(createElement(I18nProvider, {
    initialLocale: 'zh',
    children: createElement(TooltipProvider, null, createElement(AccountsSection)),
  }));
  const row = specimen.match(new RegExp(`<div[^>]*data-testid="provider-instance"[^>]*>[\\s\\S]*?title="${label}"[\\s\\S]*?data-testid="provider-status-mark"[\\s\\S]*?</svg>`))?.[0];
  expect(row).toBeDefined();
  const start = row?.lastIndexOf('data-testid="provider-instance"') ?? 0;
  expect(row?.slice(start)).toContain(`lucide-${icon}`);
  expect(renderAccount({ ...CLAUDE, state }).row).toContain(`lucide-${icon}`);
});

it('A3: the status table assigns every status a unique glyph and accessible name', () => {
  const entries = Object.values(PROVIDER_STATUS);
  expect(Object.keys(PROVIDER_STATUS).sort()).toEqual(['cooling', 'exhausted', 'expired', 'fail', 'off', 'ok', 'warn']);
  expect(new Set(entries.map(({ Icon }) => Icon)).size).toBe(entries.length);
  expect(new Set(entries.map(({ label }) => label)).size).toBe(entries.length);
});

it('A3: gives every row status a unique glyph without relying on color', () => {
  const rows = [
    ...(['ok', 'warn', 'fail', 'off'] as const).map((tone) => renderRow({
      item: { id: tone, name: tone, Mark: () => null, status: 'API key', statusLabel: tone, tone, statusGlyph: tone },
      selected: false,
      onSelect: () => undefined,
    })),

    ...(['cooling', 'exhausted', 'expired'] as const).map((state) =>
      renderAccount({ ...CLAUDE, state }, [{ id: 'current', name: 'Current' }]).row),
  ];
  const glyphs = rows.map((row) => row.match(/data-testid="provider-status-mark"[\s\S]*?<svg[^>]*class="([^"]+)"/)?.[1]
    ?.split(' ').find((name) => name.startsWith('lucide-')));
  expect(glyphs).not.toContain(undefined);
  expect(new Set(glyphs).size, JSON.stringify(glyphs)).toBe(rows.length);
});

it('leaves Devin without a badge and keeps its usage note in the detail', () => {
  const { row, detail } = renderAccount({
    ...CLAUDE,
    id: 'devin-work',
    vendor: 'devin',
    label: 'Devin',
  });
  expect(row).toContain('>订阅 · 0 个模型<');
  expect(row).not.toContain('subscription-quota-mini');
  expect(detail).toContain('Devin 不提供剩余用量');
  expect(detail).not.toContain('role="progressbar"');
});
