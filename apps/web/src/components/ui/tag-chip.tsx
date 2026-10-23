// TagChip 零皮肤适配层（XMON-14；#983 判决：改写为零皮肤适配层，地图 #980
// 前提②）：标签 chip = registry Badge 默认形态 + 运行期数据色。保留的全是
// 语义映射：TagRecord.color→inline backgroundColor（运行期记录字段、非设计
// 皮肤，board-filter.spec 明文钉此契约）、name→内容、max-w-40+truncate
// （layout）、--text-on-accent 前景（数据色底上的可读墨，token 层承载）。
//
// 11px 字体改写档已按 #983 判决删除（text-[11px]/leading-5/py-0 超出官网
// 形态）——字号/行高/内边距收敛 registry Badge 默认 text-xs(12px)/h-5/
// py-0.5（前提④：几何冲突 registry 默认赢；11→12px 由本域探针重钉）。
//
// 与 StatusChip 的边界不变：StatusChip = 状态色族（五对 token 槽）；
// TagChip = 用户数据色（tag record color 位）。数据色走 inline style 而非
// Tailwind 类：tag.color 是运行期记录字段，进不了类名编译面。
//
// 看板卡身份行的 row-flush 消费点覆写（todo-card.tsx className）是 #983
// 判决明示的「用户自行决定」面（前提④下属），去留归原型实审裁——本件不
// 代判、不吸收。

import type { TagRecord } from '@cairn/shared';
import { cn } from 'cn';
import { Badge } from './badge.js';

/** 渲染所需的最小投影（record 全形见 shared tagRecordSchema）。 */
export type TagChipData = Pick<TagRecord, 'id' | 'name' | 'color'>;

interface TagChipProps {
  tag: TagChipData;
  /** per-face 类名（fresh-tag-chip / todo-card-tag…），作 e2e 定位别名
   *  （README 规则 2）。 */
  className?: string;
}

export function TagChip({ tag, className }: TagChipProps) {
  return (
    <Badge
      className={cn(
        // 语义映射与 layout 位；几何/字号 = registry Badge 默认（#983）。
        'tag-chip max-w-40 justify-start gap-0 text-(--text-on-accent) text-ellipsis transition-none',
        className,
      )}
      style={{ backgroundColor: tag.color }}
    >
      {tag.name}
    </Badge>
  );
}
