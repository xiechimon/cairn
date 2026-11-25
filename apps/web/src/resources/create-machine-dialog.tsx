import { PUBLISHED_PACKAGES, type TailscaleAccess } from '@cairn/shared';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import {
  useApproveMachineEnrollment,
  useEnableTailscaleAccess,
  useTailscaleAccess,
} from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { withCodeSpans } from '../components/notice-banner.js';
import { SegmentedTabs } from '../components/segmented.js';
import { Button } from '../components/ui/button.js';
import { DIALOG_PRIMARY_BUTTON, DialogShell } from '../components/ui/dialog-shell.js';
import { Input } from '../components/ui/input.js';
import { toastError, toastSuccess } from '../components/ui/toaster.js';
import { useI18n } from '../i18n/provider.js';
import { copyTextWithFeedback, hasClipboard } from '../lib/clipboard.js';
import { PhonePairDialog } from './phones-panel.js';

const CMD_CLS =
  'flex items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2 dark:bg-input/30';

const CMD_CODE_CLS = 'font-mono text-meta text-foreground [overflow-wrap:anywhere]';

export const INSTALL_COMMAND = `npm install -g ${PUBLISHED_PACKAGES.cli.name}@latest`;

const OPERATOR_COMMAND = 'sudo tailscale set --operator=$USER';

const TAILSCALE_DOWNLOAD_URL = 'https://tailscale.com/download';

const DESKTOP_RELEASES_URL = 'https://github.com/xiechimon/cairn/releases/latest';

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

export function useRunnerServerAccess(enabled: boolean): {
  access: TailscaleAccess | undefined;
  failed: boolean;
  recheck: () => void;
} {
  const { search } = useLocation();
  const { live } = useLiveData();
  const query = useTailscaleAccess(live && enabled);
  if (!live) return { access: fixtureAccess(search), failed: false, recheck: () => {} };
  return {
    access: query.data,
    failed: query.isError,
    recheck: () => void query.refetch(),
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
  const [mode, setMode] = useState<'desktop' | 'cli'>('desktop');
  const [apiKeyOpen, setApiKeyOpen] = useState(false);
  const [pairOpen, setPairOpen] = useState(false);
  const apiKeyRef = useRef<HTMLDivElement>(null);
  const { access, failed, recheck } = useRunnerServerAccess(open !== false);
  const enable = useEnableTailscaleAccess();
  useEffect(() => {
    if (apiKeyOpen) apiKeyRef.current?.scrollIntoView({ block: 'nearest' });
  }, [apiKeyOpen]);
  const serverUrl = access?.state === 'ready' ? access.url : null;
  const startCmd = serverUrl === null ? null : startCommand(serverUrl);
  const state = failed ? 'failed' : access?.state;
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
            {t('两台电脑通过 Tailscale 连接，这台电脑要保持开机联网。')}
          </p>
          <ol className="m-0 flex list-none flex-col gap-3.5 p-0">
            <li className={STEP_CLS}>
              <span className={STEP_NUM_CLS}>1</span>
              <div className={STEP_BODY_CLS}>
                <span className={STEP_TITLE_CLS}>{t('用 Tailscale 连通两台电脑')}</span>
                <TailscaleStatus access={access} failed={failed} />
              </div>
            </li>
          </ol>
          {startCmd !== null && serverUrl !== null && (
            <div data-testid="add-machine-mode-tabs" className="flex flex-col gap-3.5">
              <SegmentedTabs
                value={mode}
                onChange={setMode}
                label={t('添加方式')}
                className="grid w-full grid-cols-2"
                optionHandle="flex-1"
                options={[
                  { value: 'desktop', label: t('安装桌面端') },
                  { value: 'cli', label: t('仅装命令行') },
                ]}
              />
              {mode === 'desktop' ? (
                <ol className="m-0 flex list-none flex-col gap-3.5 p-0">
                  <li className={STEP_CLS}>
                    <span className={STEP_NUM_CLS}>2</span>
                    <div className={STEP_BODY_CLS}>
                      <span className={STEP_TITLE_CLS}>
                        {t('在另一台电脑安装并打开 Cairn 桌面端')}
                      </span>
                      <p className={STEP_NOTE_CLS}>{t('支持 macOS、Windows 和 Linux。')}</p>
                      <a
                        className={INLINE_ACTION_CLS}
                        href={DESKTOP_RELEASES_URL}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {t('下载 Cairn 桌面端 →')}
                      </a>
                    </div>
                  </li>
                  <li className={STEP_CLS}>
                    <span className={STEP_NUM_CLS}>3</span>
                    <div className={STEP_BODY_CLS}>
                      <span className={STEP_TITLE_CLS}>{t('复制这台主机的地址')}</span>
                      <CopyCommand command={serverUrl} />
                    </div>
                  </li>
                  <li className={STEP_CLS}>
                    <span className={STEP_NUM_CLS}>4</span>
                    <div className={STEP_BODY_CLS}>
                      <span className={STEP_TITLE_CLS}>{t('在另一台电脑连接并登录')}</span>
                      <p className={STEP_NOTE_CLS} data-testid="desktop-connect-hint">
                        {t(
                          '新装打开后点击「连接已有 Cairn 主机」粘贴上面的地址并重启；已初始化的桌面端可在「执行机」页底部的「主机连接与常驻」中连接。完成登录后，那台电脑会自动作为执行机加入团队 {team}。',
                          { team: teamName },
                        )}
                      </p>
                    </div>
                  </li>
                </ol>
              ) : (
                <div className="flex flex-col gap-3.5">
                  <ol className="m-0 flex list-none flex-col gap-3.5 p-0">
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
                          {t(
                            '终端会显示一个批准码。把它填在下面，确认把那台电脑加入团队 {team}。',
                            {
                              team: teamName,
                            },
                          )}
                        </p>
                        <ApproveByCode teamId={teamId} />
                      </div>
                    </li>
                  </ol>
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
                      <Link
                        className={INLINE_ACTION_CLS}
                        to={{ pathname: '/app/api-keys', search }}
                      >
                        {t('获取 API key →')}
                      </Link>
                    </div>
                  )}
                </div>
              )}
            </div>
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
