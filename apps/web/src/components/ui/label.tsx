import { cn } from 'cn';
import type * as React from 'react';

function Label({ className, ...props }: React.ComponentProps<'label'>) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: generic Label primitive — control association happens at call sites via htmlFor/nesting (upstream registry shape).
    <label
      data-slot="label"
      className={cn(
        // leading-tight（1.25）：CJK 字形墨盒满 em 见方，leading-none 会让
        // 标签墨贴着下缘——紧邻的聚焦控件环晕（Input focus-visible ring）
        // 在视觉上压/吃标签（实踩：创建 agent 弹窗「名称」行）。
        'flex items-center gap-2 text-sm leading-tight font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export { Label };
