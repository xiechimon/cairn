// Token 门页（#253，spec #247 D9）：鉴权开且 server 打回 401 时落页——
// 输入 → probe（api/auth.ts probeToken，裸 fetch 面）→ localStorage → 放行
// 原请求（client.ts 停车面唤醒 + SSE 重连，auth 单缝）。错 token：停留本页、
// 清输入、只显通用文案——server {error} 细节不透传（票 AC2）。鉴权关：
// gateOpen 永不置位，本组件恒不可见（零行为差）。
// B2 收编（#426）：面板 = 仓内 shadcn Card（bg-card + ring-1 ring-foreground/10
// + 12px 边圆角 + shadow-lg，与 dialog 族浮层面同配方），字样 = 语义标签 + TW
// 工具类直引 token 正本；per-face 样式（overlay/token-gate.css）随片退役。
// 类名别名（token-gate*）原样保留 = e2e 定位锚（token-gate.spec.ts，#411
// 政策 1）。面板虽由 Card 承载，表单语义（form + type=submit，回车即提交）
// 仍由内层 form 原样承接。
// 输入与提交走仓内 shadcn 件（ui/Input / ui/Button default 档）。两件的 per-face
// 值以工具类钉回轨 A3 实测档——输入 36px 盒 / 8px 圆角 / --card-border 描边 /
// --surface 底，提交 32px 高 / 8px 圆角 / 13px 常规字重 / --card-button 实底：
// 铺开是纯结构换件，per-face 数值仍是几何正本（#411 政策 4），故不取 shadcn
// 默认档。聚焦环按仓级 #388 canon（2px --focus-ring + offset 2）。
// 聚焦锚点仍是既有 htmlFor/id（cairn-token-input，开门聚焦）。
// #1048 增补（纯信息缺口，鉴权逻辑零改动）：desc 下加一段「令牌从哪来」
// 指引（.token-gate-help，e2e 定位锚）——三事实钉在 token-gate.spec.ts
// 失败方式 7/8/9：令牌 = 服务端环境变量 ENV_VARS.token 的值（BRAND 槽，
// 经 {tokenVar} 插值，页面读不到）；自部署落点 = systemd 单元 EnvironmentFile
// 指向的文件；删变量 + 重启 = 关闭鉴权（server config 只在进程启动时读 env）。
// 文案禁止出现示例令牌值（票 AC4：示例会诱导贴真值）。

import { ENV_VARS } from '@cairn/shared';
import { type FormEvent, useEffect, useState } from 'react';
import { passGate, probeToken, useAuth } from '../api/auth.js';
import { Button } from '../components/ui/button.js';
import { Card } from '../components/ui/card.js';
import { Input } from '../components/ui/input.js';
import { useI18n } from '../i18n/provider.js';

export function TokenGate() {
  const { t } = useI18n();
  const auth = useAuth();
  const [value, setValue] = useState('');
  const [rejected, setRejected] = useState(false);
  const [probing, setProbing] = useState(false);

  // 每次开门清上一轮残值并聚焦（关门→再开 = 新一轮输入）。
  useEffect(() => {
    if (!auth.gateOpen) return;
    setValue('');
    setRejected(false);
    (document.getElementById('cairn-token-input') as HTMLInputElement | null)?.focus();
  }, [auth.gateOpen]);

  if (!auth.gateOpen) return null;

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const candidate = value.trim();
    if (candidate === '' || probing) return;
    setProbing(true);
    setRejected(false);
    void probeToken(candidate).then((accepted) => {
      if (accepted) {
        passGate(candidate);
      } else {
        // 无效/网络失败同律：停留、清输入、通用文案，localStorage 不落值
        setRejected(true);
        setValue('');
      }
      setProbing(false);
    });
  };

  return (
    // 门页盖住全部 UI：全屏黑幕（--overlay-scrim，正本单源）置于浮层阶梯的
    // 模态族之上——#688 阶梯给门页留了专属档 --z-gate（独立档位，不参与
    // 浮层家族的同档并列；门页显示时应用尚未解锁，其它浮层不可能同场）。
    <div className="fixed inset-0 z-(--z-gate) flex items-center justify-center bg-(--overlay-scrim)">
      <Card
        role="dialog"
        aria-modal="true"
        aria-label={t('需要访问令牌')}
        className="token-gate w-[360px] max-w-[calc(100vw-48px)] rounded-[12px] p-6 shadow-lg"
      >
        <form className="flex flex-col gap-3" onSubmit={submit}>
          <h1 className="token-gate-title text-base font-semibold text-foreground">
            {t('需要访问令牌')}
          </h1>
          <p className="text-[13px] leading-normal text-content-secondary">
            {t('服务端已开启令牌鉴权，输入访问令牌后继续使用。')}
          </p>
          <p className="token-gate-help text-xs leading-relaxed text-content-tertiary">
            {t(
              '令牌由部署方在服务端用环境变量 {tokenVar} 设定，页面无法读出它的值：自己部署的服务，去启动它的环境里找这个变量（systemd 部署看单元 EnvironmentFile 指向的文件）；别人部署的，向部署者索取。删除该变量并重启服务端即可关闭令牌鉴权。',
              { tokenVar: ENV_VARS.token },
            )}
          </p>
          <label className="text-xs text-content-tertiary" htmlFor="cairn-token-input">
            {t('访问令牌')}
          </label>
          <Input
            id="cairn-token-input"
            // 过渡窄写 = components/ui/button 的同一处仓内偏离（TW 的
            // transition-colors 属性表含 outline-color，会把 focus 环吞进
            // 过渡初值）；dark 档另钉一次底，压适配层的 `dark:bg-input/30` 底噪。
            // 圆角骑 Input 件默认 rounded-lg（#1045 registry 回正；#1054 清点
            // 摘除消费点 rounded-none 覆写，ADR 0012 D1）。
            className="token-gate-input h-9 border-(--border) bg-(--card) px-3 py-0 text-sm text-foreground transition-[color,background-color,border-color] focus-visible:border-(--border) focus-visible:ring-0 focus-visible:[outline:2px_solid_var(--focus-ring)] focus-visible:outline-offset-2 dark:bg-(--card)"
            type="password"
            value={value}
            autoComplete="off"
            onChange={(event) => setValue(event.target.value)}
          />
          {rejected && (
            <p className="token-gate-error text-xs text-destructive" role="alert">
              {t('令牌无效，请重试。')}
            </p>
          )}
          <Button
            type="submit"
            className="token-gate-submit border-0 rounded-md px-3 text-[13px] font-normal"
            disabled={probing || value.trim() === ''}
          >
            {t('进入')}
          </Button>
        </form>
      </Card>
    </div>
  );
}
