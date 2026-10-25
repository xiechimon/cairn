import { PUBLISHED_PACKAGES } from '@cairn/shared';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { Button } from '../components/ui/button.js';
import { DIALOG_PRIMARY_BUTTON, DialogShell } from '../components/ui/dialog-shell.js';
import { useI18n } from '../i18n/provider.js';

const CMD_CLS =
  'flex items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2 dark:bg-input/30';

const CMD_CODE_CLS = 'font-mono text-meta text-foreground [overflow-wrap:anywhere]';

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
  const installCmd = `npm install -g ${PUBLISHED_PACKAGES.cli.name}@latest`;
  const startCmd = `${PUBLISHED_PACKAGES.cli.command} start`;
  const apiKeyCmd = `${PUBLISHED_PACKAGES.cli.command} start --api-key <key> --team ${teamId ?? '<teamId>'}`;
  const copyButton = (cmd: string) => (
    <Button
      variant="outline"
      size="xs"
      className="shrink-0 px-2.5"
      onClick={() => void navigator.clipboard?.writeText(cmd)}
    >
      {t('复制')}
    </Button>
  );
  return (
    <DialogShell
      title={t('添加机器')}
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
        <ol className="m-0 flex list-none flex-col gap-3.5 p-0">
          <li className={STEP_CLS}>
            <span className={STEP_NUM_CLS}>1</span>
            <div className={STEP_BODY_CLS}>
              <span className="text-ui font-medium text-foreground">{t('安装 CLI')}</span>
              <div className={CMD_CLS}>
                <code className={CMD_CODE_CLS}>{installCmd}</code>
                {copyButton(installCmd)}
              </div>
            </div>
          </li>
          <li className={STEP_CLS}>
            <span className={STEP_NUM_CLS}>2</span>
            <div className={STEP_BODY_CLS}>
              <span className="text-ui font-medium text-foreground">{t('在机器上执行')}</span>
              <div className={CMD_CLS}>
                <code className={CMD_CODE_CLS}>{startCmd}</code>
                {copyButton(startCmd)}
              </div>
              <p className="m-0 text-meta text-content-tertiary">
                {t(
                  '在待接入的机器上执行以下命令。浏览器将打开登录页，授权团队 {team} 后机器即可上线。此后它在后台常驻运行，无需保持终端开启。',
                  { team: teamName },
                )}
              </p>
            </div>
          </li>
        </ol>
        <Button
          variant="ghost"
          className={`${INLINE_ACTION_CLS} px-0 text-content-secondary hover:bg-transparent hover:text-content-secondary aria-expanded:bg-transparent aria-expanded:text-content-secondary dark:hover:bg-transparent font-normal active:not-aria-[haspopup]:translate-y-0`}
          aria-expanded={apiKeyOpen}
          onClick={() => setApiKeyOpen((value) => !value)}
        >
          {t('在云服务器上运行？改用 API key 注册')}
        </Button>
        {apiKeyOpen && (
          <div ref={apiKeyRef} className="flex flex-col gap-2">
            <div className={CMD_CLS}>
              <code className={CMD_CODE_CLS}>{apiKeyCmd}</code>
              {copyButton(apiKeyCmd)}
            </div>
            <Link className={INLINE_ACTION_CLS} to={{ pathname: '/app/api-keys', search }}>
              {t('获取 API key →')}
            </Link>
          </div>
        )}
      </div>
    </DialogShell>
  );
}
