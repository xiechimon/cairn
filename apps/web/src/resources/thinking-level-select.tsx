import type { ThinkingLevel } from '@cairn/shared';
import { cn } from 'cn';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select.js';
import { useI18n } from '../i18n/provider.js';

const DEFAULT_LEVEL = 'default';

const THINKING_LEVEL_COPY: Record<ThinkingLevel, string> = {
  off: '关闭思考',
  minimal: '极低',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
  max: '最高',
};

const levelLabel = (level: string, t: (key: string) => string) => {
  const key = THINKING_LEVEL_COPY[level as ThinkingLevel];
  return key !== undefined ? t(key) : level.charAt(0).toUpperCase() + level.slice(1);
};

export function ThinkingLevelSelect({
  levels,
  resolvesTo,
  value,
  onChange,
  label,
  className,
}: {
  levels: readonly ThinkingLevel[] | undefined;
  resolvesTo: ThinkingLevel | undefined;
  value: string | null;
  onChange: (level: ThinkingLevel | null) => void;
  label: string;
  className: string;
}) {
  const { t } = useI18n();
  const offered = levels ?? [];
  if (new Set<string>([resolvesTo ?? DEFAULT_LEVEL, ...offered]).size < 2) return null;
  const nameOf = (level: string) =>
    level !== DEFAULT_LEVEL
      ? levelLabel(level, t)
      : resolvesTo === undefined
        ? t('默认')
        : t('默认（{level}）', { level: levelLabel(resolvesTo, t) });
  const shown = offered.find((level) => level === value) ?? DEFAULT_LEVEL;
  return (
    <Select
      value={shown}
      onValueChange={(next) => {
        if (next === null) return;
        onChange(offered.find((level) => level === next) ?? null);
      }}
    >
      <SelectTrigger
        aria-label={label}
        className={cn(
          'w-auto flex-none border-transparent bg-transparent shadow-none hover:bg-muted dark:bg-transparent dark:hover:bg-muted max-sm:h-7 max-sm:text-meta',
          className,
        )}
      >
        <SelectValue>
          <span className="text-content-tertiary">{t('思考')}</span>
          {nameOf(shown)}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {[DEFAULT_LEVEL, ...offered].map((level) => (
          <SelectItem key={level} value={level}>
            {nameOf(level)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
