import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../i18n/provider.js';
import { mentionChipClass } from '../overlay/mention-chip.js';
import {
  type DraftChip,
  type FileMentionEntry,
  parseDraftChips,
} from '../overlay/mention-token.js';
import { COMPOSER_CHIP_LABEL } from './chat-markdown.js';

interface ComposerChipsProps {
  draft: string;
  files?: FileMentionEntry[];
  suspended: boolean;
}

function keyChips(chips: DraftChip[]): { chip: DraftChip; key: string }[] {
  const ordinals = new Map<string, number>();
  return chips.map((chip) => {
    const base = `${chip.kind}:${chip.id}`;
    const ordinal = ordinals.get(base) ?? 0;
    ordinals.set(base, ordinal + 1);
    return { chip, key: `${base}#${ordinal}` };
  });
}

export function ComposerChips({ draft, files, suspended }: ComposerChipsProps) {
  const { t } = useI18n();
  const chips = useMemo(() => parseDraftChips(draft, files), [draft, files]);
  const keyed = useMemo(() => keyChips(chips), [chips]);
  const committedRef = useRef<Set<string>>(new Set());
  const [freshKeys, setFreshKeys] = useState<Set<string>>(new Set());
  useEffect(() => {
    const next = new Set<string>();
    for (const { key } of keyed) {
      if (!committedRef.current.has(key)) next.add(key);
    }
    committedRef.current = new Set(keyed.map(({ key }) => key));
    setFreshKeys(next);
  }, [keyed]);
  if (suspended || keyed.length === 0) return null;
  return (
    <div
      className="composer-chips pointer-events-none absolute right-0 bottom-[calc(100%+6px)] left-0 z-30 flex flex-wrap gap-1.5"
      role="status"
      aria-label={t('提及')}
    >
      {keyed.map(({ chip, key }) => (
        <span
          key={key}
          className={`${mentionChipClass(chip.kind)}${
            freshKeys.has(key) ? ' animate-in fade-in-0 zoom-in-98 duration-100' : ''
          }`}
          {...(freshKeys.has(key) ? { 'data-fresh': 'true' } : {})}
        >
          <span className={COMPOSER_CHIP_LABEL}>{chip.label}</span>
        </span>
      ))}
    </div>
  );
}
