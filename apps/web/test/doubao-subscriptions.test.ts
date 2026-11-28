import type {
  BuildRecord,
  DoubaoLoginSession,
  DoubaoSubscriptionListEntry,
  ModelSource,
  ProviderRecord,
  RoutingConnection,
} from '@cairn/shared';
import { todo as makeTodo } from './helpers.js';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Verification } from '../src/api/account-verification.js';
import type { SubscriptionAccount } from '../src/api/claude-accounts.js';
import { toDoubaoAccount } from '../src/api/doubao-subscriptions.js';
import { mapTranscript } from '../src/api/mappers.js';
import { routingTargets } from '../src/api/model-routing.js';
import { ProviderRow } from '../src/components/accounts/account-parts.js';
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerProvider,
} from '../src/components/ui/message-scroller.js';
import { TooltipProvider } from '../src/components/ui/tooltip.js';
import { Transcript } from '../src/detail/transcript.js';
import { resolveScenario } from '../src/fixtures/scenario.js';
import { I18nProvider } from '../src/i18n/provider.js';
import { type TFunc, translate } from '../src/i18n/translate.js';
import { DoubaoQrLoginCard } from '../src/resources/doubao-qr-login.js';
import { AddDoubaoSubscriptionForm } from '../src/resources/doubao-subscriptions.js';
import { ProvidersSection } from '../src/resources/providers-page.js';
import { SubscriptionDetail, subscriptionStatusView } from '../src/resources/subscription-detail.js';
import { groupDoubaoUpstream } from '../src/resources/upstream-model-groups.js';

vi.mock('../src/fixtures/scenario.js', { spy: true });
afterEach(() => vi.restoreAllMocks());

const NOW = Date.UTC(2026, 10, 28, 8);
const t: TFunc = (source, vars) => translate('zh', {}, source, vars);
const clock = () => '12:00';
const PNG_1X1_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function makeWire(over: Partial<DoubaoSubscriptionListEntry> = {}): DoubaoSubscriptionListEntry {
  return {
    id: 'doubao-sub-1',
    kind: 'doubao-subscription',
    label: 'MacBook 豆包',
    runnerId: null,
    runnerName: 'ian-mbp',
    runnerLogin: 'ok',
    runnerOffline: false,
    runnerModels: [
      { id: '4', name: 'Doubao 2.1 Turbo' },
      { id: 'seed-2-lite', name: 'Seed 2 Lite' },
    ],
    runnerLogins: [
      { runnerId: 'runner-mbp', name: 'ian-mbp', online: true, installed: true, platformSupported: true, status: 'ok' },
      { runnerId: 'runner-mini', name: 'mac-mini', online: true, installed: false, platformSupported: true, status: 'not_installed' },
    ],
    enabled: true,
    enabledAt: NOW - 86_400_000,
    createdAt: NOW - 86_400_000,
    lastUsedAt: NOW - 3_600_000,
    stepsLast24h: 3,
    models: [],
    ...over,
  };
}

function renderWithProviders(element: ReturnType<typeof createElement>) {
  return renderToStaticMarkup(
    createElement(I18nProvider, {
      initialLocale: 'zh',
      children: createElement(QueryClientProvider, {
        client: new QueryClient(),
        children: createElement(MemoryRouter, {
          children: createElement(TooltipProvider, null, element),
        }),
      }),
    }),
  );
}

function renderProviders(opts: {
  doubaoSubscriptions?: SubscriptionAccount[];
  providers?: ProviderRecord[];
  providerSources?: ModelSource[];
  connections?: RoutingConnection[];
}) {
  vi.mocked(resolveScenario).mockReturnValue({
    todos: [],
    now: NOW,
    resources: {
      skills: [],
      mcpServers: [],
      machines: [],
      providers: opts.providers ?? [],
      providerSources: opts.providerSources ?? [],
      accounts: {
        subscriptions: [],
        devinSubscriptions: [],
        antigravitySubscriptions: [],
        doubaoSubscriptions: opts.doubaoSubscriptions ?? [],
        otherAccounts: [],
        machines: [],
        providers: [],
        routing: { edges: [], connections: opts.connections ?? [], quota: [] },
      },
    },
  });
  return renderWithProviders(createElement(ProvidersSection));
}

function makeLoginSession(over: Partial<DoubaoLoginSession>): DoubaoLoginSession {
  return {
    loginId: 'login-1',
    machineId: 'runner-mini',
    machineName: 'mac-mini',
    status: 'qr',
    qrPngBase64: PNG_1X1_B64,
    revision: 1,
    startedAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

describe('doubao subscriptions UI and QR login flow', () => {
  it('renders Doubao subscription dialog/detail states, per-computer QR card states, non-owner read-only notice, usage row, model picker, and inline QR login card on waiting task', () => {
    const account = toDoubaoAccount(makeWire());
    expect(account.vendor).toBe('doubao');
    expect(account.runnerId).toBeNull();
    expect(account.doubaoRunnerLogins).toHaveLength(2);

    expect(subscriptionStatusView(account, NOW, t, clock).tone).toBe('ok');
    expect(subscriptionStatusView({ ...account, enabled: false }, NOW, t, clock)).toEqual({
      tone: 'off',
      label: '已停用',
      reason: null,
    });
    const missingLogin = subscriptionStatusView(
      toDoubaoAccount(makeWire({ runnerLogin: 'missing_local_login', runnerName: 'mac-mini' })),
      NOW,
      t,
      clock,
    );
    expect(missingLogin.tone).toBe('warn');
    expect(missingLogin.reason).toContain('mac-mini');
    expect(missingLogin.reason).not.toContain('doubao login');

    const html = renderProviders({
      doubaoSubscriptions: [account],
      providerSources: [
        {
          runtime: 'doubao',
          hostname: 'ian-mbp',
          installed: true,
          models: [
            { id: '4', name: 'Doubao 2.1 Turbo', liveness: 'alive' },
            { id: 'seed-2-lite', name: 'Seed 2 Lite', liveness: 'alive' },
          ],
        },
      ],
    });
    expect(html).toContain('MacBook 豆包');
    expect(html).toContain('各电脑登录状态');
    expect(html).toContain('ian-mbp');
    expect(html).toContain('mac-mini');
    expect(html).toContain('切换账号');
    expect(html).toContain('扫码登录');
    expect(html).toContain('近 24 小时');
    expect(html).toContain('3 次运行');
    expect(html).toContain('Cairn 记录');
    expect(html).toContain('停用');
    expect(html).not.toContain('doubao login');

    const verifyMissingHtml = renderWithProviders(
      createElement(SubscriptionDetail, {
        account: toDoubaoAccount(makeWire({ runnerLogin: 'missing_local_login', runnerName: 'mac-mini' })),
        models: [],
        now: NOW,
        view: missingLogin,
        verification: {
          phase: 'failed',
          reason: 'missing_local_login',
          runnerName: 'mac-mini',
        } satisfies Verification,
        actions: {
          onRemove: () => undefined,
          onVerify: () => undefined,
        },
      }),
    );
    expect(verifyMissingHtml).toContain('扫码登录');
    expect(verifyMissingHtml).not.toContain('doubao login');
    expect(verifyMissingHtml).not.toContain('antigravity');

    const nonOwnerDetailHtml = renderWithProviders(
      createElement(SubscriptionDetail, {
        account,
        models: [],
        now: NOW,
        view: subscriptionStatusView(account, NOW, t, clock),
        verification: undefined,
        actions: { onRemove: () => undefined },
      }),
    );
    expect(nonOwnerDetailHtml).not.toContain('data-testid="subscription-toggle-enabled"');

    vi.mocked(resolveScenario).mockReturnValue({
      todos: [],
      now: NOW,
      resources: {
        skills: [],
        mcpServers: [],
        machines: [],
        providers: [],
        providerSources: [],
        accounts: {
          subscriptions: [],
          devinSubscriptions: [],
          antigravitySubscriptions: [],
          doubaoSubscriptions: [],
          otherAccounts: [],
          machines: [],
          providers: [],
          routing: { edges: [], connections: [], quota: [] },
        },
      },
    });
    const addFormHtml = renderWithProviders(
      createElement(AddDoubaoSubscriptionForm, {
        anyLoggedIn: false,
        selectedQrRunnerName: 'mac-mini',
        label: '豆包订阅',
        onLabelChange: () => undefined,
        supportedOnlineRunners: [{ id: 'runner-mini', name: 'mac-mini' }],
        qrRunnerId: 'runner-mini',
        onQrRunnerChange: () => undefined,
        error: false,
      }),
    );
    expect(addFormHtml).toContain('保存后直接在下方展示 mac-mini 的登录二维码');
    expect(addFormHtml).not.toContain('doubao login');

    const addMultiRunnerHtml = renderWithProviders(
      createElement(AddDoubaoSubscriptionForm, {
        anyLoggedIn: false,
        selectedQrRunnerName: 'mac-mini',
        label: '豆包订阅',
        onLabelChange: () => undefined,
        supportedOnlineRunners: [
          { id: 'runner-mini', name: 'mac-mini' },
          { id: 'runner-mbp', name: 'ian-mbp' },
        ],
        qrRunnerId: 'runner-mini',
        onQrRunnerChange: () => undefined,
        error: false,
      }),
    );
    expect(addMultiRunnerHtml).toContain('扫码电脑');
    expect(addMultiRunnerHtml).toContain('保存后直接在下方展示 mac-mini 的登录二维码');

    const installingHtml = renderWithProviders(
      createElement(DoubaoQrLoginCard, {
        teamId: 't1',
        machineId: 'runner-mini',
        machineName: 'mac-mini',
        fixtureSession: makeLoginSession({ status: 'installing', qrPngBase64: undefined }),
      }),
    );
    expect(installingHtml).toContain('正在 mac-mini 自动安装豆包组件');

    const qrHtml = renderWithProviders(
      createElement(DoubaoQrLoginCard, {
        teamId: 't1',
        machineId: 'runner-mini',
        machineName: 'mac-mini',
        fixtureSession: makeLoginSession({ status: 'qr', qrPngBase64: PNG_1X1_B64 }),
      }),
    );
    expect(qrHtml).toContain('doubao-qr-frame');
    expect(qrHtml).toContain(`data:image/png;base64,${PNG_1X1_B64}`);
    expect(qrHtml).toContain('刷新二维码');

    const expiredHtml = renderWithProviders(
      createElement(DoubaoQrLoginCard, {
        teamId: 't1',
        machineId: 'runner-mini',
        machineName: 'mac-mini',
        fixtureSession: makeLoginSession({ status: 'expired', qrPngBase64: undefined }),
      }),
    );
    expect(expiredHtml).toContain('二维码已过期');
    expect(expiredHtml).toContain('刷新二维码');

    const refusedHtml = renderWithProviders(
      createElement(DoubaoQrLoginCard, {
        teamId: 't1',
        machineId: 'runner-mini',
        machineName: 'mac-mini',
        fixtureSession: makeLoginSession({ status: 'refused', qrPngBase64: undefined }),
      }),
    );
    expect(refusedHtml).toContain('手机端已拒绝本次登录');
    expect(refusedHtml).toContain('重新扫码');

    const offlineHtml = renderWithProviders(
      createElement(DoubaoQrLoginCard, {
        teamId: 't1',
        machineId: 'runner-mini',
        machineName: 'mac-mini',
        fixtureSession: makeLoginSession({ status: 'failed', reason: 'offline', qrPngBase64: undefined }),
      }),
    );
    expect(offlineHtml).toContain('执行机 mac-mini 已离线');

    const keychainHtml = renderWithProviders(
      createElement(DoubaoQrLoginCard, {
        teamId: 't1',
        machineId: 'runner-mini',
        machineName: 'mac-mini',
        fixtureSession: makeLoginSession({ status: 'failed', reason: 'keychain_locked', qrPngBase64: undefined }),
      }),
    );
    expect(keychainHtml).toContain('钥匙串已锁定');

    const unsupportedAccountHtml = renderWithProviders(
      createElement(DoubaoQrLoginCard, {
        teamId: 't1',
        machineId: 'runner-mini',
        machineName: 'mac-mini',
        fixtureSession: makeLoginSession({ status: 'failed', reason: 'unsupported_account', qrPngBase64: undefined }),
      }),
    );
    expect(unsupportedAccountHtml).toContain('更换账号重试');

    const nonOwnerCardHtml = renderWithProviders(
      createElement(DoubaoQrLoginCard, {
        teamId: 't1',
        machineId: 'runner-mini',
        machineName: 'mac-mini',
        canManage: false,
        fixtureSession: makeLoginSession({ status: 'scanned', qrPngBase64: undefined }),
      }),
    );
    expect(nonOwnerCardHtml).toContain('需要管理员在 mac-mini 扫码登录豆包');
    expect(nonOwnerCardHtml).not.toContain('doubao-qr-image');
    expect(nonOwnerCardHtml).not.toContain('<button');

    const machinesRowHtml = renderWithProviders(
      createElement(ProviderRow, {
        provider: {
          runtime: 'doubao',
          login: 'logged-out',
          plan: null,
          version: null,
          loginCommand: 'doubao login',
          enabled: true,
          observedAt: NOW,
        },
      }),
    );
    expect(machinesRowHtml).toContain('豆包');
    expect(machinesRowHtml).not.toContain('doubao login');

    const groups = groupDoubaoUpstream([
      { id: '4', name: 'Doubao 2.1 Turbo' },
      { id: 'deepseek-r1', name: 'DeepSeek R1' },
      { id: 'custom-model', name: 'Custom Model' },
    ]);
    expect(groups.map(([label]) => label)).toEqual(['Doubao', 'DeepSeek', '其他']);

    const targets = routingTargets({
      subscriptions: [],
      devinSubscriptions: [],
      antigravitySubscriptions: [],
      doubaoSubscriptions: [account],
      providers: [],
      routing: undefined,
    });
    expect(
      targets.some((entry) => entry.runtime === 'doubao' && entry.id === `subscription:${account.id}`),
    ).toBe(true);

    const todo = makeTodo(1, 'building');
    const build: BuildRecord = {
      id: 'b-qr',
      todoId: todo.id,
      withPlan: false,
      prevPhase: null,
      triggerSource: 'user',
      planDocId: null,
      errorMessage: null,
      prUrl: null,
      prNumber: null,
      diffHash: null,
      createdAt: NOW,
    };
    const transcript = mapTranscript({
      messages: [],
      steps: [
        {
          id: 'step-qr',
          buildId: 'b-qr',
          kind: 'session',
          status: 'pending',
          createdAt: NOW,
          claimedAt: null,
          finishedAt: null,
          machineId: null,
          sessionId: null,
          errorMessage: null,
          summary: null,
          queue: {
            position: 1,
            waitingFor: { machineId: 'runner-mini', name: 'mac-mini' },
            blocked: { kind: 'doubao-login-required', missing: ['mac-mini'] },
          },
        } as unknown as Parameters<typeof mapTranscript>[0]['steps'][number],
      ],
      build,
      todo,
      machineName: null,
      userName: 'ian',
      liveText: '',
    });
    const blockedTranscriptHtml = renderWithProviders(
      createElement(
        MessageScrollerProvider,
        { defaultScrollPosition: 'end', children: null },
        createElement(
          MessageScroller,
          null,
          createElement(
            MessageScrollerContent,
            null,
            createElement(Transcript, {
              transcript,
              blockedActions: (kind, waitingFor) =>
                kind === 'doubao-login-required' && waitingFor !== undefined
                  ? createElement(DoubaoQrLoginCard, {
                      teamId: 't1',
                      machineId: waitingFor.machineId,
                      machineName: waitingFor.name,
                      fixtureSession: makeLoginSession({
                        status: 'qr',
                        qrPngBase64: PNG_1X1_B64,
                      }),
                    })
                  : null,
            }),
          ),
        ),
      ),
    );
    expect(blockedTranscriptHtml).toContain('mac-mini 尚未登录豆包');
    expect(blockedTranscriptHtml).toContain('data-testid="doubao-qr-login-card"');
    expect(blockedTranscriptHtml).toContain(`data:image/png;base64,${PNG_1X1_B64}`);
    expect(blockedTranscriptHtml).not.toContain('doubao login');

    const missingQrImgHtml = renderWithProviders(
      createElement(DoubaoQrLoginCard, {
        teamId: 't1',
        machineId: 'runner-mini',
        machineName: 'mac-mini',
        canManage: true,
        fixtureSession: makeLoginSession({ status: 'qr', qrPngBase64: undefined }),
      }),
    );
    expect(missingQrImgHtml).toContain('正在加载二维码…');
    expect(missingQrImgHtml).toContain('doubao-qr-refresh');
  });
});
