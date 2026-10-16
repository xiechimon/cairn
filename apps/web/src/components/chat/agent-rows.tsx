// 段行（#955 / ADR 0011 D5）：模型过程里除正文之外的两种段——思考行与流式期
// 工具行。总管抽屉与详情页共用同一张脸（两面同改，不给共享层加分支）。
//
// 样式走 Tailwind 工具类而非 per-face CSS：本域 CSS 正在被 #950 清零，新件
// 不再往 chief.css / detail.css 里加活。

import { useState } from 'react';
import { useI18n } from '../../i18n/provider.js';
import { ChevronDown, ChevronRight } from '../../icons/index.js';
import { Button } from '../ui/button.js';
import { useLiveSeconds } from './live-row.js';

/** 折叠态的预览长度（一行、按字符截断，与 Multica 的 ThinkingRow 同档）。
 *  切片只管「预览多长」；宽度截断由 CSS 承担（#1034）——字符数在 12px 下
 *  不等于像素宽，150 字符的 CJK 预览仍是 ~1800px。 */
const PREVIEW_CHARS = 150;

/** 思考行：折叠态一行斜体预览，展开看全文。默认折叠——思考是过程不是结论，
 *  不占正文版面（与工具行同档）。 */
export function ThinkingRow({ text }: { text: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const firstLine =
    text
      .trim()
      .split('\n')
      .find((l) => l.trim() !== '') ?? '';
  const preview =
    firstLine.length > PREVIEW_CHARS ? `${firstLine.slice(0, PREVIEW_CHARS)}…` : firstLine;
  return (
    <div className="flex flex-col gap-1">
      {/* #1034：Button 基类写死 whitespace-nowrap + shrink-0，w-fit 在 nowrap 下
          min-content == max-content，fit-content 解成整段文本宽（实测 626px 钮
          冲出 384px 列）——min-w-0 max-w-full 把钮收回列宽（chief-drawer 模型行钮
          同款），预览 span 挂 #772 截断律 min-w-0 flex-auto truncate 出省略号；
          chevron 由基类 [&_svg]:shrink-0 保住 10px 不被挤。 */}
      <Button
        variant="ghost"
        className="h-auto w-fit min-w-0 max-w-full shrink justify-start gap-1.5 rounded-none px-0 font-medium text-[12px] leading-4 text-[var(--text-dim)] active:not-aria-[haspopup]:translate-y-0 [&_svg:not([class*='size-'])]:size-auto"
        aria-label={t(open ? '收起思考' : '展开思考')}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDown width={10} height={10} /> : <ChevronRight width={10} height={10} />}
        <span className="min-w-0 flex-auto truncate italic">{open ? t('思考') : preview}</span>
      </Button>
      {open && (
        <pre className="m-0 whitespace-pre-wrap break-words font-[inherit] text-[12px] leading-4 text-[var(--text-secondary)]">
          {text}
        </pre>
      )}
    </div>
  );
}

/** 流式期工具行：`activeRun` 在飞时平铺进主呈现，与文本段按序交错。进行中的
 *  那条挂走秒数（锚 = 该次调用的真实起点；没有起点就不摆数字，#471 律）。
 *  回合收口后工具退回 robot 行的折叠面，本行不再产出。 */
export function ToolActivityRow({
  name,
  startedAt,
  seconds,
  running,
  error,
}: {
  name: string;
  startedAt?: number;
  seconds?: number;
  running?: boolean;
  error?: boolean;
}) {
  const { t } = useI18n();
  const tick = useLiveSeconds(running === true ? (startedAt ?? null) : null);
  const shown = tick ?? seconds ?? null;
  return (
    <span className="flex items-center gap-2 text-[12px] leading-4 text-[var(--text-dim)]">
      <span className="font-[var(--font-mono)]">
        {running === true ? t('正在调用 {n}', { n: name }) : name}
      </span>
      {shown != null && <span className="tabular-nums">{shown}s</span>}
      {error === true && <span className="text-[var(--destructive)]">{t('失败')}</span>}
    </span>
  );
}
