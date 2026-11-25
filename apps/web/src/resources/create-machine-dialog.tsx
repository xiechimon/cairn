import { PUBLISHED_PACKAGES, type RemoteRoute, type TailscaleAccess } from '@cairn/shared';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import {
  useApproveMachineEnrollment,
  useEnableTailscaleAccess,
  useRemoteRoutes,
  useTailscaleAccess,
} from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { withCodeSpans } from '../components/notice-banner.js';
import { Button } from '../components/ui/button.js';
import { DIALOG_PRIMARY_BUTTON, DialogShell } from '../components/ui/dialog-shell.js';
import { Input } from '../components/ui/input.js';
import { toastError, toastSuccess } from '../components/ui/toaster.js';
import { useI18n } from '../i18n/provider.js';
import { copyTextWithFeedback, hasClipboard } from '../lib/clipboard.js';
import { isLoopbackOrigin } from '../lib/pairing-origin.js';
import { PhonePairDialog } from './phones-panel.js';

const CMD_CLS =
  'flex items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2 dark:bg-input/30';

const CMD_CODE_CLS = 'font-mono text-meta text-foreground [overflow-wrap:anywhere]';

export const INSTALL_COMMAND = `npm install -g ${PUBLISHED_PACKAGES.cli.name}@latest`;

const OPERATOR_COMMAND = 'sudo tailscale set --operator=$USER';

const TAILSCALE_DOWNLOAD_URL = 'https://tailscale.com/download';

const FIXTURE_TAILSCALE_URL = 'https://studio-mac.tail4c2a.ts.net';

const TAILSCALE_PARAM = 'tailscale';

const ENABLE_STATES = new Set<string>(['off', 'needs-operator', 'needs-https', 'occupied']);

export function startCommand(serverOrigin: string): string {
  return `${PUBLISHED_PACKAGES.cli.command} start --server ${serverOrigin}`;
}

export function CopyCommand({ command }: { command: string }) {
  const { t } = useI18n();
  return (
    <div className={CMD_CLS}>
      <code className={CMD_CODE_CLS}>{command}</code>
      {hasClipboard() && (
        <Button
          variant="outline"
          size="xs"
          className="shrink-0 px-2.5 pointer-coarse:h-11 pointer-coarse:px-3.5"
          onClick={() => copyTextWithFeedback(command, () => toastSuccess(t('已复制')))}
        >
          {t('复制')}
        </Button>
      )}
    </div>
  );
}

function fixtureAccess(search: string): TailscaleAccess {
  const state = new URLSearchParams(search).get(TAILSCALE_PARAM) ?? 'ready';
  if (state === 'needs-https') {
    return {
      state,
      url: null,
      consentUrl: 'https://login.tailscale.com/f/serve?node=studio-mac',
    };
  }
  if (state === 'ready' || state === 'verifying' || state === 'unreachable') {
    return { state, url: FIXTURE_TAILSCALE_URL, consentUrl: null };
  }
  const known: TailscaleAccess['state'][] = [
    'not-installed',
    'not-connected',
    'needs-operator',
    'occupied',
    'off',
  ];
  return {
    state: known.find((candidate) => candidate === state) ?? 'ready',
    url: null,
    consentUrl: null,
  };
}

export type RunnerServerSource = 'tailscale' | 'tailnet' | 'public' | 'page' | 'lan';

function normalizeOrigin(raw: string | null | undefined): string | null {
  if (raw == null || raw === '') return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (isLoopbackOrigin(parsed.origin)) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

export function resolveRunnerServerUrl(input: {
  routes?: readonly RemoteRoute[];
  tailscale?: TailscaleAccess;
  pageOrigin?: string;
}): { url: string; source: RunnerServerSource } | null {
  const tsUrl = input.tailscale?.state === 'ready' ? normalizeOrigin(input.tailscale.url) : null;
  if (tsUrl !== null) return { url: tsUrl, source: 'tailscale' };
  const routes = input.routes ?? [];
  for (const route of routes) {
    if (route.kind !== 'public') continue;
    const url = normalizeOrigin(route.url);
    if (url !== null) return { url, source: 'public' };
  }
  for (const route of routes) {
    if (route.kind !== 'tailnet') continue;
    const url = normalizeOrigin(route.url);
    if (url !== null) return { url, source: 'tailnet' };
  }
  const pageUrl = normalizeOrigin(input.pageOrigin);
  if (pageUrl !== null) return { url: pageUrl, source: 'page' };
  for (const route of routes) {
    if (route.kind !== 'lan') continue;
    const url = normalizeOrigin(route.url);
    if (url !== null) return { url, source: 'lan' };
  }
  return null;
}

export function useRunnerServerAccess(enabled: boolean): {
  access: TailscaleAccess | undefined;
  serverUrl: string | null;
  source: RunnerServerSource | null;
  failed: boolean;
  recheck: () => void;
} {
  const { search } = useLocation();
  const { live } = useLiveData();
  const tailscaleQuery = useTailscaleAccess(live && enabled);
  const routesQuery = useRemoteRoutes(live && enabled);
  if (!live) {
    const access = fixtureAccess(search);
    const serverUrl = access.state === 'ready' ? access.url : null;
    return {
      access,
      serverUrl,
      source: serverUrl !== null ? 'tailscale' : null,
      failed: false,
      recheck: () => {},
    };
  }
  const resolved = resolveRunnerServerUrl({
    routes: routesQuery.data?.routes,
    tailscale: tailscaleQuery.data,
    pageOrigin: typeof window === 'undefined' ? undefined : window.location.origin,
  });
  return {
    access: tailscaleQuery.data,
    serverUrl: resolved?.url ?? null,
    source: resolved?.source ?? null,
    failed: resolved === null && tailscaleQuery.isError,
    recheck: () => {
      void tailscaleQuery.refetch();
      void routesQuery.refetch();
    },
  };
}

const INLINE_ACTION_CLS = 'self-start text-ui';

const STEP_CLS = 'flex gap-3';
const STEP_NUM_CLS =
  'flex size-5.5 flex-none items-center justify-center rounded-full bg-card text-meta text-content-secondary ring-1 ring-border';
const STEP_BODY_CLS = 'flex min-w-0 flex-1 flex-col gap-1.5';
const STEP_TITLE_CLS = 'text-ui font-medium text-foreground';
const STEP_NOTE_CLS = 'm-0 text-meta text-content-secondary [&_code]:whitespace-nowrap';

function TailscaleStatus({
  access,
  failed,
}: {
  access: TailscaleAccess | undefined;
  failed: boolean;
}) {
  const { t } = useI18n();
  if (failed) {
    return <p className={STEP_NOTE_CLS}>{t('查不到 Tailscale 的状态。点「重新检查」再试。')}</p>;
  }
  if (access === undefined) {
    return <p className={STEP_NOTE_CLS}>{t('正在检查 Tailscale…')}</p>;
  }
  switch (access.state) {
    case 'not-installed':
      return (
        <>
          <p className={STEP_NOTE_CLS}>
            {t(
              '这台电脑尚未安装 Tailscale。下载安装并登录，在另一台电脑上也安装并登录同一个账号，完成后点击「重新检查」。',
            )}
          </p>
          <a
            className={INLINE_ACTION_CLS}
            href={TAILSCALE_DOWNLOAD_URL}
            target="_blank"
            rel="noreferrer"
          >
            {t('下载 Tailscale →')}
          </a>
        </>
      );
    case 'not-connected':
      return (
        <p className={STEP_NOTE_CLS}>
          {t(
            'Tailscale 已安装，但尚未登录或未连接。打开 Tailscale 登录并连接，再点击「重新检查」。',
          )}
        </p>
      );
    case 'needs-operator':
      return (
        <>
          <p className={STEP_NOTE_CLS}>
            {t(
              'Tailscale 需要允许当前用户修改它的设置。在这台电脑的终端运行一次下面的命令，再点「重试」。',
            )}
          </p>
          <CopyCommand command={OPERATOR_COMMAND} />
        </>
      );
    case 'needs-https':
      return (
        <>
          <p className={STEP_NOTE_CLS}>
            {t(
              '你的 Tailscale 网络尚未开启 HTTPS 证书。在 Tailscale 网页上开启后，返回此处点击「重试」。',
            )}
          </p>
          {access.consentUrl !== null && (
            <a
              className={INLINE_ACTION_CLS}
              href={access.consentUrl}
              target="_blank"
              rel="noreferrer"
            >
              {t('去 Tailscale 开启 →')}
            </a>
          )}
        </>
      );
    case 'occupied':
      return (
        <p className={STEP_NOTE_CLS}>
          {withCodeSpans(
            t(
              '这台电脑的 Tailscale Serve 端口 `443`、`8443`、`10000` 都被别的服务占着。腾出一个再点「重试」。',
            ),
          )}
        </p>
      );
    case 'off':
      return (
        <p className={STEP_NOTE_CLS}>
          {t(
            'Tailscale 已连接。点「开启」后，你 Tailscale 网络里的设备就能打开这台电脑上的 Cairn，打开时仍要登录 Cairn。',
          )}
        </p>
      );
    case 'verifying':
      return (
        <p className={STEP_NOTE_CLS}>
          {t('已开启，正在确认 {url} 能打开。第一次可能要等一分钟。', { url: access.url ?? '' })}
        </p>
      );
    case 'unreachable':
      return (
        <p className={STEP_NOTE_CLS}>
          {t('{url} 现在打不开。确认 Tailscale 还连着，再点「重新检查」。', {
            url: access.url ?? '',
          })}
        </p>
      );
    case 'ready':
      return (
        <p className={STEP_NOTE_CLS} data-testid="tailscale-ready">
          {t('已连通，另一台电脑用这个地址连回来：{url}', { url: access.url ?? '' })}
        </p>
      );
  }
}

function ApproveByCode({ teamId }: { teamId: string | undefined }) {
  const { t } = useI18n();
  const [code, setCode] = useState('');
  const approve = useApproveMachineEnrollment(teamId);
  const ready = code.replace(/[\s-]/g, '').length === 8;
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready) return;
        approve.mutate(code, {
          onSuccess: () => {
            setCode('');
            toastSuccess(t('已批准，执行机即将上线'));
          },
          onError: (error) =>
            toastError(t('批准码有误或已过期。请核对终端里的批准码后重试。'), error),
        });
      }}
    >
      <Input
        aria-label={t('批准码')}
        placeholder="XXXX-XXXX"
        autoComplete="off"
        spellCheck={false}
        className="font-mono"
        value={code}
        onChange={(event) => setCode(event.target.value.toUpperCase())}
      />
      <Button type="submit" size="sm" className="shrink-0" disabled={!ready || approve.isPending}>
        {t('批准')}
      </Button>
    </form>
  );
}

interface CreateMachineDialogProps {
  open?: boolean;
  onClose: () => void;
  teamName: string;
  teamId?: string;
  phoneHost?: { id: string; name: string } | null;
}

export function CreateMachineDialog({
  open,
  onClose,
  teamName,
  teamId,
  phoneHost = null,
}: CreateMachineDialogProps) {
  const { t } = useI18n();
  const { search } = useLocation();
  const [apiKeyOpen, setApiKeyOpen] = useState(false);
  const [pairOpen, setPairOpen] = useState(false);
  const apiKeyRef = useRef<HTMLDivElement>(null);
  const { access, serverUrl, source, failed, recheck } = useRunnerServerAccess(open !== false);
  const enable = useEnableTailscaleAccess();
  useEffect(() => {
    if (apiKeyOpen) apiKeyRef.current?.scrollIntoView({ block: 'nearest' });
  }, [apiKeyOpen]);
  const startCmd = serverUrl === null ? null : startCommand(serverUrl);
  const nonTailscaleReady = serverUrl !== null && source !== 'tailscale';
  const state = serverUrl !== null ? 'ready' : failed ? 'failed' : access?.state;
  const footer = (() => {
    if (state !== undefined && ENABLE_STATES.has(state)) {
      return (
        <Button
          className={DIALOG_PRIMARY_BUTTON}
          disabled={enable.isPending}
          onClick={() =>
            enable.mutate(undefined, {
              onError: (error) => toastError(t('未能开启 Tailscale 访问，请重试。'), error),
            })
          }
        >
          {enable.isPending ? t('正在开启…') : state === 'off' ? t('开启') : t('重试')}
        </Button>
      );
    }
    if (
      state === 'not-installed' ||
      state === 'not-connected' ||
      state === 'unreachable' ||
      state === 'failed'
    ) {
      return (
        <Button className={DIALOG_PRIMARY_BUTTON} onClick={recheck}>
          {t('重新检查')}
        </Button>
      );
    }
    return (
      <Button className={DIALOG_PRIMARY_BUTTON} onClick={onClose}>
        {t('完成')}
      </Button>
    );
  })();
  return (
    <>
      <DialogShell
        title={t('添加执行机')}
        info={t('让另一台电脑帮你运行任务')}
        open={open}
        onClose={onClose}
        size="l"
        hint={
          <Link className="text-meta" to={{ pathname: '/app/machines/authorize', search }}>
            {t('浏览器授权注册 →')}
          </Link>
        }
        footer={footer}
      >
        <div className="flex flex-col gap-4">
          <p className="m-0 text-ui text-content-secondary">
            {nonTailscaleReady
              ? t('另一台电脑可通过当前远程地址连接到这台电脑，这台电脑要保持开机联网。')
              : t('两台电脑通过 Tailscale 连接，这台电脑要保持开机联网。')}
          </p>
          <ol className="m-0 flex list-none flex-col gap-3.5 p-0">
            <li className={STEP_CLS}>
              <span className={STEP_NUM_CLS}>1</span>
              <div className={STEP_BODY_CLS}>
                <span className={STEP_TITLE_CLS}>
                  {nonTailscaleReady ? t('连通两台电脑') : t('用 Tailscale 连通两台电脑')}
                </span>
                {serverUrl !== null ? (
                  <p className={STEP_NOTE_CLS} data-testid="tailscale-ready">
                    {t('已连通，另一台电脑用这个地址连回来：{url}', { url: serverUrl })}
                  </p>
                ) : (
                  <TailscaleStatus access={access} failed={failed} />
                )}
              </div>
            </li>
            {startCmd !== null && (
              <>
                <li className={STEP_CLS}>
                  <span className={STEP_NUM_CLS}>2</span>
                  <div className={STEP_BODY_CLS}>
                    <span className={STEP_TITLE_CLS}>{t('在另一台电脑上安装 CLI')}</span>
                    <CopyCommand command={INSTALL_COMMAND} />
                  </div>
                </li>
                <li className={STEP_CLS}>
                  <span className={STEP_NUM_CLS}>3</span>
                  <div className={STEP_BODY_CLS}>
                    <span className={STEP_TITLE_CLS}>{t('在另一台电脑上启动执行机')}</span>
                    <CopyCommand command={startCmd} />
                    <p className="m-0 text-meta text-content-tertiary">
                      {t('之后它在后台运行，可以关掉终端。')}
                    </p>
                  </div>
                </li>
                <li className={STEP_CLS}>
                  <span className={STEP_NUM_CLS}>4</span>
                  <div className={STEP_BODY_CLS}>
                    <span className={STEP_TITLE_CLS}>{t('在这里批准')}</span>
                    <p className={STEP_NOTE_CLS} data-testid="enrollment-code-hint">
                      {t('终端会显示一个批准码。把它填在下面，确认把那台电脑加入团队 {team}。', {
                        team: teamName,
                      })}
                    </p>
                    <ApproveByCode teamId={teamId} />
                  </div>
                </li>
              </>
            )}
          </ol>
          {startCmd !== null && (
            <>
              <Button
                variant="ghost"
                className={`${INLINE_ACTION_CLS} px-0 text-content-secondary hover:bg-transparent hover:text-content-secondary aria-expanded:bg-transparent aria-expanded:text-content-secondary dark:hover:bg-transparent font-normal`}
                aria-expanded={apiKeyOpen}
                onClick={() => setApiKeyOpen((value) => !value)}
              >
                {t('在云服务器上运行？改用 API key 注册')}
              </Button>
              {apiKeyOpen && (
                <div ref={apiKeyRef} className="flex flex-col gap-2">
                  <CopyCommand
                    command={`${startCmd} --api-key <key> --team ${teamId ?? '<teamId>'}`}
                  />
                  <Link className={INLINE_ACTION_CLS} to={{ pathname: '/app/api-keys', search }}>
                    {t('获取 API key →')}
                  </Link>
                </div>
              )}
            </>
          )}
          {phoneHost !== null && (
            <div className="border-t border-border pt-4">
              <Button
                variant="outline"
                size="sm"
                className="self-start"
                data-testid="phone-pair-entry"
                onClick={() => setPairOpen(true)}
              >
                {t('配对手机')}
              </Button>
            </div>
          )}
        </div>
      </DialogShell>
      {phoneHost !== null && (
        <PhonePairDialog
          open={pairOpen}
          machineId={phoneHost.id}
          machineName={phoneHost.name}
          phoneId={null}
          prefillEndpoint=""
          onClose={() => setPairOpen(false)}
        />
      )}
    </>
  );
}
