// 添加机器 dialog (wayfinder #181, #179 裁决落账 = CLI 两步表单; copy
// authority = r2 11b 弹窗 + r3 §1.2 API key 分支): rides DialogShell (#68
// family law — X / Esc / backdrop). 引导语 + 两段带 复制 的命令块(安装
// CLI → `npm install -g <包名>@latest`;在机器上执行 → `<命令名> start`
// ——包名/命令名成对取自 PUBLISHED_PACKAGES.cli);底部「在云服务器上运行?改用 API
// key 注册」disclosure 展开 `cairn start --api-key <key> --team <teamId>`
// (teamId 内嵌 = 02 §5.2 路径二 → POST /api/machine/enroll 端点链,
// routes-machine.ts schema 核实)+「获取 API key →」跳 /app/api-keys
// (#121 Link family: scenario 随跳)。无服务端 mutation——注册由 CLI
// 驱动(enroll/start+poll / enroll),机器上线经 machine_presence SSE
// 回流列表;fixture 面纯展示(命令即真相,无 accept 律提交位)。
// #944 per-face 清零:.dlg-enroll* 族(规则住 detail/overlays.css,detail-b
// 的清零账)消费面在本票随改迁 utility——等值迁移,别名类退役后 overlays.css
// 里的规则成孤儿,detail-b 删规则时不再有此消费点。裸 button ×4(复制 ×3 +
// disclosure)收编 Button(#851 账):复制钮 = default/xs(24px 高、10px 垫,原
// .dlg-enroll-copy 等值);disclosure = ghost 文字钮(正典表 §5.4
// model-add 同族配方:贴左、无框、secondary 墨)。

import { PUBLISHED_PACKAGES } from '@cairn/shared';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { Button } from '../components/ui/button.js';
import { DIALOG_PRIMARY_BUTTON, DialogShell } from '../components/ui/dialog-shell.js';
import { useI18n } from '../i18n/provider.js';

/** 命令块(原 .dlg-enroll-cmd):白底发丝框 code + 复制钮行。 */
const CMD_CLS =
  'flex items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2 dark:bg-input/30';

/** 命令块内 code:等宽 meta 档,长命令任意断行。 */
const CMD_CODE_CLS = 'font-mono text-meta text-foreground [overflow-wrap:anywhere]';

/** disclosure / 链接行(原 .dlg-enroll-toggle 与 keylink/browserlink 共同形)。 */
const INLINE_ACTION_CLS = 'self-start text-ui';

/** 编号步骤（DESIGN.md 弹窗与菜单 · 多步）：22px 白底圆号 + 内容列。 */
const STEP_CLS = 'flex gap-3';
const STEP_NUM_CLS =
  'flex size-5.5 flex-none items-center justify-center rounded-full bg-card text-meta text-content-secondary ring-1 ring-border';
const STEP_BODY_CLS = 'flex min-w-0 flex-1 flex-col gap-1.5';

interface CreateMachineDialogProps {
  /** #73 retained-mount open flag. */
  open?: boolean;
  onClose: () => void;
  /** 授权文案的团队名插值(live = GET /api/teams;fixture = TEAM_NAME)。 */
  teamName: string;
  /** API key 命令内嵌的团队 id;fixture 无真值 → `<teamId>` 占位。 */
  teamId?: string;
}

export function CreateMachineDialog({ open, onClose, teamName, teamId }: CreateMachineDialogProps) {
  const { t } = useI18n();
  // the 获取 API key link carries the scenario string along so dev/fixture
  // fixture selection survives the hop (#121 Link family discipline)
  const { search } = useLocation();
  const [apiKeyOpen, setApiKeyOpen] = useState(false);
  const apiKeyRef = useRef<HTMLDivElement>(null);
  // 展开的密钥命令块排在体的最底：滚进体的可视区，不让用户以为点了没反应。
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
        // W4 #285：浏览器授权路径入口（02 §5.2 路径一；CLI 两步为主路径不动）。
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
        {/* disclosure 钮 = Button ghost 贴左、无框、secondary 墨；hover/展开态
            底色由件承载（D2）。 */}
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
