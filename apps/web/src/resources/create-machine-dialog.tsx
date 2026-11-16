import { PUBLISHED_PACKAGES } from '@cairn/shared';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { Button } from '../components/ui/button.js';
import { DIALOG_PRIMARY_BUTTON, DialogShell } from '../components/ui/dialog-shell.js';
import { toastSuccess } from '../components/ui/toaster.js';
import { useI18n } from '../i18n/provider.js';
import { isLoopbackOrigin } from '../lib/pairing-origin.js';

const CMD_CLS =
  'flex items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2 dark:bg-input/30';

const CMD_CODE_CLS = 'font-mono text-meta text-foreground [overflow-wrap:anywhere]';

export const INSTALL_COMMAND = `npm install -g ${PUBLISHED_PACKAGES.cli.name}@latest`;

export function startCommand(serverOrigin: string): string {
  return `${PUBLISHED_PACKAGES.cli.command} start --server ${serverOrigin}`;
}

export function CopyCommand({ command }: { command: string }) {
  const { t } = useI18n();
  const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
  return (
    <div className={CMD_CLS}>
      <code className={CMD_CODE_CLS}>{command}</code>
      {clipboard && (
        <Button
          variant="outline"
          size="xs"
          className="shrink-0 px-2.5 pointer-coarse:h-11 pointer-coarse:px-3.5"
          onClick={() =>
            void clipboard.writeText(command).then(
              () => toastSuccess(t('已复制')),
              () => {},
            )
          }
        >
          {t('复制')}
        </Button>
      )}
    </div>
  );
}

const INLINE_ACTION_CLS = 'self-start text-ui';

const STEP_CLS = 'flex gap-3';
const STEP_NUM_CLS =
  'flex size-5.5 flex-none items-center justify-center rounded-full bg-card text-meta text-content-secondary ring-1 ring-border';
const STEP_BODY_CLS = 'flex min-w-0 flex-1 flex-col gap-1.5';

interface CreateMachineDialogProps {
  open?: boolean;
  onClose: () => void;
  teamName: string;
  teamId?: string;
}

export function CreateMachineDialog({ open, onClose, teamName, teamId }: CreateMachineDialogProps) {
  const { t } = useI18n();
  const { search } = useLocation();
  const [apiKeyOpen, setApiKeyOpen] = useState(false);
  const apiKeyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (apiKeyOpen) apiKeyRef.current?.scrollIntoView({ block: 'nearest' });
  }, [apiKeyOpen]);
  const installCmd = INSTALL_COMMAND;
  const serverOrigin = window.location.origin;
  const startCmd = startCommand(serverOrigin);
  const apiKeyCmd = `${startCmd} --api-key <key> --team ${teamId ?? '<teamId>'}`;
  return (
    <DialogShell
      title={t('添加执行机')}
      open={open}
      onClose={onClose}
      size="l"
      hint={
        <Link className="text-meta" to={{ pathname: '/app/machines/authorize', search }}>
          {t('浏览器授权注册 →')}
        </Link>
      }
      footer={
        <Button className={DIALOG_PRIMARY_BUTTON} onClick={onClose}>
          {t('完成')}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="m-0 text-ui text-content-secondary">
          {t('有条件时优先使用云主机：笔记本会休眠或断网，云主机常在线，构建更稳定。')}
        </p>
        {isLoopbackOrigin(serverOrigin) && (
          <p className="m-0 text-meta text-content-secondary">
            {t(
              '当前地址只适用于这台电脑。添加另一台电脑前，请用 Tailscale 地址打开 Cairn，再复制命令。',
            )}{' '}
            <Link
              className="whitespace-nowrap text-foreground underline underline-offset-2"
              to={{ pathname: '/app/settings/remote', search }}
            >
              {t('远程访问')}
            </Link>
          </p>
        )}
        <ol className="m-0 flex list-none flex-col gap-3.5 p-0">
          <li className={STEP_CLS}>
            <span className={STEP_NUM_CLS}>1</span>
            <div className={STEP_BODY_CLS}>
              <span className="text-ui font-medium text-foreground">{t('安装 CLI')}</span>
              <CopyCommand command={installCmd} />
            </div>
          </li>
          <li className={STEP_CLS}>
            <span className={STEP_NUM_CLS}>2</span>
            <div className={STEP_BODY_CLS}>
              <span className="text-ui font-medium text-foreground">{t('在执行机上运行')}</span>
              <CopyCommand command={startCmd} />
              <p className="m-0 text-meta text-content-tertiary">
                {t(
                  '在待接入的执行机上执行以下命令。浏览器将打开登录页，授权团队 {team} 后执行机即可上线。此后它在后台常驻运行，无需保持终端开启。',
                  { team: teamName },
                )}
              </p>
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
            <CopyCommand command={apiKeyCmd} />
            <Link className={INLINE_ACTION_CLS} to={{ pathname: '/app/api-keys', search }}>
              {t('获取 API key →')}
            </Link>
          </div>
        )}
      </div>
    </DialogShell>
  );
}
