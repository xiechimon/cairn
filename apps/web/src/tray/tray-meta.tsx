import { cn } from 'cn';
import { Gauge } from 'lucide-react';
import type { TrayGroup } from './tray-groups.js';

export function TrayHeadMeta({ meta, tip }: { meta: NonNullable<TrayGroup['meta']>; tip: string }) {
  return (
    <span
      data-testid="tray-machine-meta"
      data-level={meta.level}
      title={tip}
      className={cn('tray-head-meta', `tray-meta-${meta.level}`)}
    >
      <Gauge aria-hidden="true" />
      {meta.percent}%
    </span>
  );
}
