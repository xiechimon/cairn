// 2026-10-13 复制钮单源（用户 review 钉：「整个界面复制按钮不一致，好几个
// 没有复用，显得很乱」）。此前全家底：transcript ActionRow 的 13px 裸图标、
// 用户行动作行的 28px 盒、代码块横幅的 28px 盒 + 对勾、chief 行的
// copiedKey 1.5s 换形——四种形态四套反馈。本组件 = 唯一行为源：dsh
// MessageIconActions 的形（28px 盒 / 15px 字形 / tertiary 墨 / hover 淡底
// 升二级墨）+ 复制成功对勾 1s 换回（dsh copied 同律）。
//
// 两族消费面：
//   - fadeByRecency（默认 true）：会话流行内的复制（transcript 动作行）——
//     挂 .chat-copy，可见性归 motion.css 的新近律（最新回合恒显、更早回合
//     hover 浮现、触屏恒显）。
//   - false：块自带 chrome（代码块横幅等）——恒显，不参与行级新近律。

import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n/provider.js';
import { Check, Copy } from '../../icons/index.js';
import { Button } from './button.js';

export function CopyButton({
  text,
  fadeByRecency = true,
  className,
}: {
  /** 复制载荷（读者可见文本 / markdown 源，由调用方决定）。 */
  text: string;
  /** 会话流行内 = true（默认）：挂 .chat-copy，可见性走新近律。块自带
   *  chrome（代码块横幅）= false：恒显。 */
  fadeByRecency?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  return (
    <Button
      variant="ghost"
      className={`${fadeByRecency ? 'chat-copy ' : ''}flex size-7 cursor-pointer items-center justify-center rounded-md border-none bg-transparent p-0 text-(--text-tertiary) hover:bg-(--seg-hover) hover:text-(--text-secondary) dark:hover:bg-(--seg-hover) dark:hover:text-(--text-secondary) active:not-aria-[haspopup]:translate-y-0 [&_svg:not([class*='size-'])]:size-auto${className ? ` ${className}` : ''}`}
      aria-label={copied ? t('已复制') : t('复制')}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          if (timer.current !== null) clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), 1000);
        });
      }}
    >
      {copied ? <Check width={15} height={15} /> : <Copy width={15} height={15} />}
    </Button>
  );
}
