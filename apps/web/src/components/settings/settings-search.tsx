import { cn } from 'cn';
import { Search } from 'lucide-react';
import { type ComponentType, type Ref, type SVGProps, useId, useState } from 'react';
import { useI18n } from '../../i18n/provider.js';
import { SETTINGS_ROW_INDEX } from '../../settings/settings-index.js';
import { Button } from '../ui/button.js';
import { Input } from '../ui/input.js';

export interface SettingsSearchSection {
  id: string;
  label: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
}

interface Pick {
  section: string;
  row: string | null;
}

interface Result extends Pick {
  key: string;
  primary: string;
  secondary: string | null;
  Icon: ComponentType<SVGProps<SVGSVGElement>> | null;
}

type Line = { kind: 'result'; result: Result } | { kind: 'more'; key: string; count: number };

const ROWS_PER_SECTION = 4;

function includes(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle);
}

export function SettingsSearch({
  sections,
  onPick,
  inputRef,
}: {
  sections: SettingsSearchSection[];
  onPick: (pick: Pick) => void;
  inputRef?: Ref<HTMLInputElement>;
}) {
  const { t } = useI18n();
  const listId = useId();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const needle = query.trim().toLowerCase();

  const lines: Line[] = [];
  if (needle !== '') {
    for (const section of sections) {
      const sectionHit = includes(section.label, needle);
      const rows = SETTINGS_ROW_INDEX.filter(
        (entry) =>
          entry.section === section.id &&
          (includes(t(entry.label), needle) ||
            (entry.keywords ?? []).some((word) => includes(t(word), needle))),
      ).map((entry) => t(entry.label));
      if (!sectionHit && rows.length === 0) continue;
      const [only] = rows;
      if (!sectionHit && only !== undefined && rows.length === 1) {
        lines.push({
          kind: 'result',
          result: {
            key: `${section.id}:${only}`,
            section: section.id,
            row: only,
            primary: section.label,
            secondary: only,
            Icon: section.Icon,
          },
        });
        continue;
      }
      lines.push({
        kind: 'result',
        result: {
          key: section.id,
          section: section.id,
          row: null,
          primary: section.label,
          secondary: null,
          Icon: section.Icon,
        },
      });
      for (const row of rows.slice(0, ROWS_PER_SECTION)) {
        lines.push({
          kind: 'result',
          result: {
            key: `${section.id}:${row}`,
            section: section.id,
            row,
            primary: row,
            secondary: null,
            Icon: null,
          },
        });
      }
      if (rows.length > ROWS_PER_SECTION) {
        lines.push({
          kind: 'more',
          key: `${section.id}:more`,
          count: rows.length - ROWS_PER_SECTION,
        });
      }
    }
  }
  const results = lines.flatMap((line) => (line.kind === 'result' ? [line.result] : []));
  const current = results[Math.min(active, Math.max(results.length - 1, 0))];
  const optionId = (key: string) => `${listId}-${key}`;
  const close = () => {
    setOpen(false);
    setQuery('');
    setActive(0);
  };
  const choose = (result: Result) => {
    close();
    onPick({ section: result.section, row: result.row });
  };
  const showPopover = open && needle !== '';
  return (
    <div className="relative flex-none">
      <div
        data-testid="settings-search"
        className="flex h-7 items-center gap-2 rounded-(--radius-control) border border-border px-2.5 text-content-tertiary transition-colors duration-(--dur-fast) focus-within:border-(--focus-field-border) hover:bg-sidebar-hover"
      >
        <Search aria-hidden className="size-5 flex-none" strokeWidth={1.75} />
        <Input
          ref={inputRef}
          role="combobox"
          aria-label={t('搜索设置')}
          aria-expanded={showPopover}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            showPopover && current !== undefined ? optionId(current.key) : undefined
          }
          autoComplete="off"
          className="h-full flex-auto border-0 bg-transparent px-0 py-0 text-ui outline-hidden text-foreground shadow-none placeholder:text-content-tertiary focus-visible:border-0 focus-visible:ring-0 md:text-ui dark:bg-transparent"
          placeholder={t('搜索')}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
            if (event.key === 'Escape') {
              event.stopPropagation();
              close();
              event.currentTarget.blur();
              return;
            }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              if (results.length === 0) return;
              const step = event.key === 'ArrowDown' ? 1 : -1;
              setActive((index) => (index + step + results.length) % results.length);
              return;
            }
            if (event.key === 'Enter' && current !== undefined && showPopover) {
              event.preventDefault();
              choose(current);
            }
          }}
        />
      </div>
      {showPopover && (
        <div
          id={listId}
          role="listbox"
          data-testid="settings-search-results"
          className="absolute top-full left-0 z-10 mt-1 flex max-h-80 w-72 max-w-[calc(100vw-2rem)] flex-col gap-px overflow-y-auto rounded-(--radius-popover) bg-popover p-1 text-popover-foreground shadow-(--shadow-popover)"
        >
          {lines.length === 0 && (
            <p className="m-0 px-2.5 py-2 text-meta text-content-tertiary">{t('没有匹配的设置')}</p>
          )}
          {lines.map((line) =>
            line.kind === 'more' ? (
              <span key={line.key} className="px-2.5 py-1 pl-9 text-meta text-content-tertiary">
                {t('还有 {n} 项', { n: line.count })}
              </span>
            ) : (
              <Button
                variant="ghost"
                type="button"
                key={line.result.key}
                id={optionId(line.result.key)}
                role="option"
                tabIndex={-1}
                aria-selected={current?.key === line.result.key}
                data-settings-result={line.result.section}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(results.indexOf(line.result))}
                onClick={() => choose(line.result)}
                className={cn(
                  'h-auto w-full cursor-pointer items-start justify-start gap-3 rounded-(--radius-control) px-2.5 py-1.5 text-left text-ui font-normal',
                  line.result.Icon === null && 'pl-9',
                  current?.key === line.result.key && 'bg-(--sidebar-active)',
                )}
              >
                {line.result.Icon !== null && (
                  <line.result.Icon
                    aria-hidden
                    className="mt-0.5 size-5 flex-none"
                    strokeWidth={1.75}
                  />
                )}
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-foreground">{line.result.primary}</span>
                  {line.result.secondary !== null && (
                    <span className="truncate text-meta text-content-tertiary">
                      {line.result.secondary}
                    </span>
                  )}
                </span>
              </Button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
