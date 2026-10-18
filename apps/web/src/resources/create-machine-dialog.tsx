// 添加机器 dialog (wayfinder #181, #179 裁决落账 = CLI 两步表单; copy
// authority = r2 11b 弹窗 + r3 §1.2 API key 分支): rides DialogShell (#68
// family law — X / Esc / backdrop). 引导语 + 两段带 复制 的命令块(安装
// CLI → `npm install -g @xiechimon/pacman-cli@latest`;在机器上执行 → `pacman start`
// ——包名/命令名走 BRAND 品牌槽,#44);底部「在云服务器上运行?改用 API
// key 注册」disclosure 展开 `pacman start --api-key <key> --team <teamId>`
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

import { BRAND } from '@pacman/shared';
import { useState } from 'react';
import { Link, useLocation } from 'react-router';
import { Button } from '../components/ui/button.js';
import { DialogShell } from '../components/ui/dialog-shell.js';
import { useI18n } from '../i18n/provider.js';

/** 命令块(原 .dlg-enroll-cmd):白底发丝框 code + 复制钮行。 */
const CMD_CLS =
  'flex items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2 dark:bg-input/30';

/** 命令块内 code:等宽 meta 档,长命令任意断行。 */
const CMD_CODE_CLS = 'font-mono text-meta text-foreground [overflow-wrap:anywhere]';

/** disclosure / 链接行(原 .dlg-enroll-toggle 与 keylink/browserlink 共同形)。 */
const INLINE_ACTION_CLS = 'self-start text-ui';

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
  const installCmd = `npm install -g ${BRAND.cliPackageName}@latest`;
  const startCmd = `${BRAND.cliCommandName} start`;
  const apiKeyCmd = `${BRAND.cliCommandName} start --api-key <key> --team ${teamId ?? '<teamId>'}`;
  return (
    <DialogShell title={t('添加机器')} open={open} onClose={onClose}>
      {/* #1006（dialog-shell 零皮化的消费点清理，resources 域代跑一处）：
          body 外垫随壳 DialogContent 的 registry p-4 退役（双层垫会把最高
          内容态撑出 #193 封顶滚动区，dialog-viewport machine 面钉）。 */}
      <div className="flex flex-col gap-3">
        <p className="m-0 text-ui text-content-secondary">
          {t('有条件时优先使用云主机：笔记本会休眠或断网，云主机常在线，构建更稳定。')}
        </p>
        <p className="m-0 text-ui text-content-tertiary">
          {t(
            '在待接入的机器上执行以下命令。浏览器将打开登录页，授权团队 {team} 后机器即可上线。此后它在后台常驻运行，无需保持终端开启。',
            { team: teamName },
          )}
        </p>
        <span className="text-meta font-medium text-content-secondary">{t('安装 CLI')}</span>
        <div className={CMD_CLS}>
          <code className={CMD_CODE_CLS}>{installCmd}</code>
          <Button
            variant="outline"
            size="xs"
            className="shrink-0 px-2.5"
            onClick={() => void navigator.clipboard?.writeText(installCmd)}
          >
            {t('复制')}
          </Button>
        </div>
        <span className="text-meta font-medium text-content-secondary">{t('在机器上执行')}</span>
        <div className={CMD_CLS}>
          <code className={CMD_CODE_CLS}>{startCmd}</code>
          <Button
            variant="outline"
            size="xs"
            className="shrink-0 px-2.5"
            onClick={() => void navigator.clipboard?.writeText(startCmd)}
          >
            {t('复制')}
          </Button>
        </div>
        {/* disclosure 钮 = 正典表 §5.4 model-add 同族配方（Button ghost +
            贴左、无框、secondary 墨）；hover/展开态底色由件承载（D2）。 */}
        <Button
          variant="ghost"
          className={`${INLINE_ACTION_CLS} px-0 text-content-secondary hover:bg-transparent hover:text-content-secondary aria-expanded:bg-transparent aria-expanded:text-content-secondary dark:hover:bg-transparent font-normal active:not-aria-[haspopup]:translate-y-0`}
          aria-expanded={apiKeyOpen}
          onClick={() => setApiKeyOpen((value) => !value)}
        >
          {t('在云服务器上运行？改用 API key 注册')}
        </Button>
        {apiKeyOpen && (
          <div className="flex flex-col gap-2">
            <div className={CMD_CLS}>
              <code className={CMD_CODE_CLS}>{apiKeyCmd}</code>
              <Button
                variant="outline"
                size="xs"
                className="shrink-0 px-2.5"
                onClick={() => void navigator.clipboard?.writeText(apiKeyCmd)}
              >
                {t('复制')}
              </Button>
            </div>
            <Link className={INLINE_ACTION_CLS} to={{ pathname: '/app/api-keys', search }}>
              {t('获取 API key →')}
            </Link>
          </div>
        )}
        {/* W4 #285：浏览器授权路径入口（02 §5.2 路径一；CLI 两步为主路径不动）。
            与 keylink 同形；spec 载体 = link 文案一级（#910）。 */}
        <Link className={INLINE_ACTION_CLS} to={{ pathname: '/app/machines/authorize', search }}>
          {t('浏览器授权注册 →')}
        </Link>
      </div>
    </DialogShell>
  );
}
