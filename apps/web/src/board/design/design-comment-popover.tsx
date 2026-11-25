import { DESIGN_LIMITS, type DesignTarget as ElementTarget } from '@cairn/shared';
import { useRef, useState } from 'react';
import { Button } from '../../components/ui/button.js';
import { Popover, PopoverContent } from '../../components/ui/popover.js';
import { Textarea } from '../../components/ui/textarea.js';
import { useI18n } from '../../i18n/provider.js';
import type { FrameTransform } from './design-frame.js';

function firstFamily(family: string | undefined): string | undefined {
  return family?.split(',')[0]?.replace(/["']/g, '').trim() || undefined;
}

const INVISIBLE_COLOR = /^(?:transparent|rgba\([^)]*,\s*0\))$/;
const CSS_VALUE_FUNCTION = /var\(|url\(|attr\(|env\(/i;

function colorValue(value: string | undefined): string | undefined {
  if (value === undefined || INVISIBLE_COLOR.test(value) || CSS_VALUE_FUNCTION.test(value))
    return undefined;
  if (typeof CSS === 'undefined' || !CSS.supports('color', value)) return undefined;
  return value;
}

export function InspectRows({ target }: { target: ElementTarget }) {
  const { t } = useI18n();
  const style = target.style ?? {};
  const color = colorValue(style.color);
  const background = colorValue(style.backgroundColor);
  const font = [style.fontSize, style.fontWeight, firstFamily(style.fontFamily)]
    .filter((part) => part !== undefined && part !== '')
    .join(' · ');
  const rows: { key: string; label: string; value: string; swatch?: string }[] = [
    {
      key: 'size',
      label: t('尺寸'),
      value: `${Math.round(target.position.width)} × ${Math.round(target.position.height)}`,
    },
    ...(color !== undefined
      ? [{ key: 'color', label: t('文字'), value: color, swatch: color }]
      : []),
    ...(background !== undefined
      ? [{ key: 'background', label: t('背景'), value: background, swatch: background }]
      : []),
    ...(font !== '' ? [{ key: 'font', label: t('字体'), value: font }] : []),
  ];
  return (
    <dl
      data-testid="design-inspect"
      className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-meta"
    >
      {rows.map((row) => (
        <div key={row.key} data-inspect={row.key} className="contents">
          <dt className="text-content-tertiary">{row.label}</dt>
          <dd className="m-0 flex min-w-0 items-center gap-1.5 text-foreground tabular-nums">
            {row.swatch !== undefined && (
              <span
                aria-hidden
                className="size-3 flex-none rounded-full border border-border"
                style={{ backgroundColor: row.swatch }}
              />
            )}
            <span className="truncate">{row.value}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function targetCaption(target: Pick<ElementTarget, 'label' | 'text'>): string {
  return target.text !== '' ? `${target.label} · 「${target.text}」` : target.label;
}

export function CommentPopover({
  target,
  transform,
  busy,
  onCancel,
  onSave,
  onSend,
}: {
  target: ElementTarget;
  transform: FrameTransform;
  busy: boolean;
  onCancel: () => void;
  onSave: (note: string) => void;
  onSend: ((note: string) => void) | undefined;
}) {
  const { t } = useI18n();
  const [note, setNote] = useState('');
  const anchorRef = useRef<HTMLSpanElement>(null);
  const trimmed = note.trim();
  return (
    <>
      <span
        ref={anchorRef}
        aria-hidden
        className="pointer-events-none absolute"
        style={{
          left: target.position.x * transform.scale,
          top: target.position.y * transform.scale,
          width: target.position.width * transform.scale,
          height: target.position.height * transform.scale,
        }}
      />
      <Popover
        open
        onOpenChange={(next) => {
          if (!next) onCancel();
        }}
      >
        <PopoverContent
          anchor={anchorRef}
          side="bottom"
          align="start"
          sideOffset={8}
          collisionPadding={8}
          aria-label={t('评论这个元素')}
          data-testid="design-comment-popover"
          className="w-75 max-w-[calc(100vw-16px)] border border-border p-3"
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && trimmed !== '') {
              event.preventDefault();
              onSave(trimmed);
            }
          }}
        >
          <p
            data-testid="design-comment-target"
            className="m-0 truncate text-meta text-content-secondary"
          >
            {targetCaption(target)}
          </p>
          <InspectRows target={target} />
          <Textarea
            data-testid="design-comment-note"
            aria-label={t('评论内容')}
            placeholder={t('对这个元素说点什么')}
            maxLength={DESIGN_LIMITS.noteChars}
            value={note}
            autoFocus
            onChange={(event) => setNote(event.target.value)}
            className="min-h-16 resize-none text-ui"
          />
          <div className="flex items-center justify-end gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              data-testid="design-comment-cancel"
              onClick={onCancel}
            >
              {t('取消')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              data-testid="design-comment-save"
              disabled={trimmed === '' || busy}
              onClick={() => onSave(trimmed)}
            >
              {t('保存')}
            </Button>
            {onSend !== undefined && (
              <Button
                size="sm"
                data-testid="design-comment-send"
                disabled={trimmed === '' || busy}
                onClick={() => onSend(trimmed)}
              >
                {t('发给 Coordinator')}
              </Button>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
}
