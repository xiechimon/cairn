import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { runVerification, type Verification } from '../src/api/account-verification.js';
import type { SubscriptionAccount } from '../src/api/claude-accounts.js';
import { TooltipProvider } from '../src/components/ui/tooltip.js';
import { EN } from '../src/i18n/en.js';
import { I18nProvider } from '../src/i18n/provider.js';
import { type TFunc, translate } from '../src/i18n/translate.js';
import {
  SubscriptionDetail,
  subscriptionStatusView,
  verifyDetailFacts,
} from '../src/resources/subscription-detail.js';

const NOW = Date.UTC(2026, 10, 24, 8);
const t: TFunc = (source, vars) => translate('zh', {}, source, vars);
const clock = () => '12:00';

const BASE_ACCOUNT: SubscriptionAccount = {
  id: 'ag-sub-1',
  vendor: 'antigravity',
  label: 'Antigravity 订阅',
  expiresAt: null,
  createdAt: NOW - 86_400_000,
  plan: null,
  state: 'ok',
  cooldownUntil: null,
  windows: [],
  lastUsedAt: null,
  stepsLast24h: 0,
  hasToken: false,
  models: [],
};

function renderDetail(account: SubscriptionAccount, verification?: Verification) {
  const view = subscriptionStatusView(account, NOW, t, clock);
  return renderToStaticMarkup(
    createElement(I18nProvider, {
      initialLocale: 'zh',
      children: createElement(
        TooltipProvider,
        null,
        createElement(SubscriptionDetail, {
          account,
          models: account.runnerModels ?? [],
          now: NOW,
          view,
          verification,
          actions: { onVerify: () => {}, onRemove: () => {} },
        }),
      ),
    }),
  );
}

describe('antigravity verification and named-runner status', () => {
  it('records real wall time even when the server returns a sub-50ms check duration', async () => {
    const outcome = await runVerification(async () => {
      await new Promise((resolve) => setTimeout(resolve, 140));
      return {
        ok: true,
        runnerName: 'xmonsMac',
        check: {
          at: Date.now(),
          ok: true,
          reason: null,
          check: 'sign-in' as const,
          command: 'agy acp · xmonsMac',
          model: null,
          durationMs: 1,
        },
      };
    });
    expect(outcome.phase).toBe('passed');
    if (outcome.phase !== 'passed') return;
    expect(outcome.runnerName).toBe('xmonsMac');
    expect(outcome.check?.durationMs).toBeGreaterThanOrEqual(120);
  });

  it('names the bound Runner that still needs login alongside signed-in Runners', () => {
    const account: SubscriptionAccount = {
      ...BASE_ACCOUNT,
      runnerId: 'm-mini',
      runnerName: 'Ians-Mac-mini',
      runnerLogin: 'missing_local_login',
      runnerModels: [],
      runnerLogins: [
        { runnerId: 'm-mini', name: 'Ians-Mac-mini', online: true, status: 'missing_local_login' },
        { runnerId: 'm-mac', name: 'xmonsMac', online: true, status: 'ok' },
      ],
    };
    const view = subscriptionStatusView(account, NOW, t, clock);
    expect(view.tone).toBe('warn');
    expect(view.label).toBe('Ians-Mac-mini 未登录，已在 xmonsMac 登录');
    expect(view.reason).toBe(
      '这个订阅绑定在 Ians-Mac-mini。请在 Ians-Mac-mini 上登录 Antigravity，或改用 API key。',
    );
  });

  it('explains an unbound multi-Runner subscription instead of saying sign-in expired', () => {
    const account: SubscriptionAccount = {
      ...BASE_ACCOUNT,
      runnerId: null,
      runnerName: null,
      runnerLogin: 'unavailable',
      runnerModels: [],
      runnerLogins: [
        { runnerId: 'm-mini', name: 'Ians-Mac-mini', online: true, status: 'missing_local_login' },
        { runnerId: 'm-mac', name: 'xmonsMac', online: true, status: 'missing_local_login' },
      ],
    };
    const view = subscriptionStatusView(account, NOW, t, clock);
    expect(view.tone).toBe('warn');
    expect(view.label).toBe('Ians-Mac-mini, xmonsMac 未登录');
    expect(view.reason).toBe(
      '这个订阅尚未绑定执行机。请先在目标执行机登录 Antigravity，或改用 API key。',
    );
  });

  it('agrees on status after a passing named-runner check without contradicting with 未登录', () => {
    const account: SubscriptionAccount = {
      ...BASE_ACCOUNT,
      runnerId: 'm-mac',
      runnerName: 'xmonsMac',
      runnerLogin: 'ok',
      runnerModels: [{ id: 'gemini-4-carbon', name: 'Gemini 4 Carbon' }],
      runnerLogins: [
        { runnerId: 'm-mini', name: 'Ians-Mac-mini', online: true, status: 'missing_local_login' },
        { runnerId: 'm-mac', name: 'xmonsMac', online: true, status: 'ok' },
      ],
    };
    const html = renderDetail(account);
    expect(html).toContain('data-tone="ok"');
    expect(html).toContain('已在 xmonsMac 登录，Ians-Mac-mini 未登录');
    expect(html).not.toMatch(/data-testid="subscription-status"[^>]*><span[^>]*><\/span>未登录</);
  });

  it('reports bound-runner unavailable accurately instead of blaming expired login or leading with another runner', () => {
    const account: SubscriptionAccount = {
      ...BASE_ACCOUNT,
      runnerId: 'm-mini',
      runnerName: 'Ians-Mac-mini',
      runnerLogin: 'unavailable',
      runnerModels: [],
      runnerLogins: [
        { runnerId: 'm-mini', name: 'Ians-Mac-mini', online: true, status: 'unavailable' },
        { runnerId: 'm-mac', name: 'xmonsMac', online: true, status: 'ok' },
      ],
    };
    const view = subscriptionStatusView(account, NOW, t, clock);
    expect(view.tone).toBe('warn');
    expect(view.label).toBe('Ians-Mac-mini 无法验证 · 已在 xmonsMac 登录');
    expect(view.reason).toContain('Ians-Mac-mini');
    expect(view.reason).not.toContain('登录已失效');
  });

  it('renders plain localized check method instead of code command for account-API verification', () => {
    const en: TFunc = (source, vars) => translate('en', EN, source, vars);
    const agyApi = verifyDetailFacts(
      'antigravity',
      {
        phase: 'passed',
        check: {
          at: NOW,
          ok: true,
          reason: null,
          check: 'sign-in',
          command: 'Antigravity account API',
          via: 'api',
          model: null,
          durationMs: 800,
        },
      },
      NOW,
      NOW,
      t,
    );
    expect(agyApi).not.toContainEqual(expect.objectContaining({ label: '验证命令' }));
    expect(agyApi).toContainEqual({
      label: '验证方式',
      value: 'Antigravity 账号接口',
    });

    const agyApiEn = verifyDetailFacts(
      'antigravity',
      {
        phase: 'passed',
        check: {
          at: NOW,
          ok: true,
          reason: null,
          check: 'sign-in',
          command: 'Antigravity account API',
          model: null,
          durationMs: 800,
        },
      },
      NOW,
      NOW,
      en,
    );
    expect(agyApiEn).toContainEqual({
      label: 'Checked',
      value: 'Antigravity account API',
    });

    const claudeApi = verifyDetailFacts(
      'claude',
      {
        phase: 'passed',
        check: {
          at: NOW,
          ok: true,
          reason: null,
          check: 'sign-in',
          command: 'GET https://api.anthropic.com/v1/models',
          via: 'api',
          model: null,
          durationMs: 900,
        },
      },
      NOW,
      NOW,
      t,
    );
    expect(claudeApi).not.toContainEqual(expect.objectContaining({ label: '验证命令' }));
    expect(claudeApi).toContainEqual({
      label: '验证方式',
      value: 'Claude 账号接口',
    });

    const cliCheck = verifyDetailFacts(
      'antigravity',
      {
        phase: 'passed',
        check: {
          at: NOW,
          ok: true,
          reason: null,
          check: 'sign-in',
          command: 'agy acp · xmonsMac',
          via: 'cli',
          model: null,
          durationMs: 1200,
        },
      },
      NOW,
      NOW,
      t,
    );
    expect(cliCheck).toContainEqual({
      label: '验证命令',
      value: 'agy acp · xmonsMac',
      code: true,
    });

    const devinCli = verifyDetailFacts(
      'devin',
      {
        phase: 'passed',
        check: {
          at: NOW,
          ok: true,
          reason: null,
          check: 'sign-in',
          command: 'devin acp · authenticate',
          via: 'cli',
          model: null,
          durationMs: 1100,
        },
      },
      NOW,
      NOW,
      en,
    );
    expect(devinCli).toContainEqual({
      label: 'Command',
      value: 'devin acp · authenticate',
      code: true,
    });
  });
});
