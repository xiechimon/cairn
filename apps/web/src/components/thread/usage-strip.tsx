import { StatStrip } from '../stat-strip.js';

export interface UsageStripProps {
  cost: string;
  tokens: string;
  cached: string;
  duration: string;
  model: string;
  machine: string;
  className?: string;
}

export function UsageStrip({
  cost,
  tokens,
  cached,
  duration,
  model,
  machine,
  className,
}: UsageStripProps) {
  return (
    <StatStrip
      className={className}
      items={[
        { value: cost, label: 'cost' },
        { value: tokens, label: `tokens · ${cached} cached` },
        { value: duration, label: `${model} · ${machine}` },
      ]}
    />
  );
}
