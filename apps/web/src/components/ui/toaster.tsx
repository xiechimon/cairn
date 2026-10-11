'use client';

// Toast 原语（#631）：shadcn 官方 toast 实现是 sonner——本件即其官方配方
// （toaster 壳 + `--normal-*` CSS 变量皮肤）按本仓形态的适配：
// - 主题：仓内无 next-themes，pacman 反相规约（theme.ts）= dark 是 :root
//   默认、light 由 html.light 挂类——sonner 只吃 'light'|'dark' 主题位，
//   用 MutationObserver 跟根元素 class 翻转（外观切换即时生效，已开 toast
//   不留旧肤）。
// - 皮肤：`--normal-bg/text/border` 映射 shadcn.css 语义槽（popover 族——
//   浮层级面，与 popover/dialog 同档），零新颜色值。
// - position：sonner 缺省 bottom-right 会压住右缘 docked 总管 drawer 的
//   composer（失败 toast 恰在用户发送交互处弹出的场景）——落 bottom-left
//   让开右缘（详情页 detail-fab 同在右下）。
// 调用面：任意位置 `toast.error('…')`（imperative，不需 hook）；文案走
// useI18n 的 t()（zh 权威 + en 兜底，01/S6）。

import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';
import { Toaster as Sonner, type ToasterProps, toast } from 'sonner';

/** #631/#638 失败反馈原语：标题句（调用面已 i18n）+ server 原因进
 *  description 透传不翻译（server 数据同 user 内容律）。非 Error / 空
 *  message 不落 description。模块级函数 = 引用恒稳，callback 依赖位安全
 *  （use-chief-surface 的 #631 首版同款逻辑，#638 提为共享单源）。 */
export function toastError(title: string, error: unknown): void {
  const reason = error instanceof Error && error.message !== '' ? error.message : null;
  toast.error(title, reason !== null ? { description: reason } : undefined);
}

/** 成功反馈原语（#1236）：委派/落定类动作的可见回执——「点了然后呢」不能
 *  只剩弹层关闭一个信号（merge 202 到相位推进之间隔着机器执行）。 */
export function toastSuccess(title: string): void {
  toast.success(title);
}

/** sonner 主题位 = 根元素 .light 位的即时镜像（见文件头注）。 */
function useSonnerTheme(): ToasterProps['theme'] {
  const [theme, setTheme] = useState<ToasterProps['theme']>(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('light')
      ? 'light'
      : 'dark',
  );
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setTheme(document.documentElement.classList.contains('light') ? 'light' : 'dark');
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  return theme;
}

function Toaster({ ...props }: ToasterProps) {
  const theme = useSonnerTheme();
  return (
    <Sonner
      theme={theme}
      position="bottom-left"
      className="group"
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
        } as CSSProperties
      }
      {...props}
    />
  );
}

export { Toaster, useSonnerTheme };
