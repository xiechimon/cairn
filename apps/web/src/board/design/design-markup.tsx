import { DESIGN_LIMITS, type DesignTarget as ElementTarget } from '@cairn/shared';
import { PenLine, Redo2, Square, Type, Undo2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { IconTooltip } from '../../components/icon-tooltip.js';
import { SegmentedTabs } from '../../components/segmented.js';
import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import { useI18n } from '../../i18n/provider.js';
import {
  bakeMarks,
  hasInk,
  MARK_COLOR,
  type Mark,
  type MarkTool,
  markBounds,
  type useDrawing,
} from '../../vendor-open-design/draw-overlay.js';
import { requestPreviewSnapshot } from '../../vendor-open-design/snapshot-request.js';

const PNG_PREFIX = 'data:image/png;base64,';

const TOOL_LABEL: Record<MarkTool, string> = {
  box: '框选',
  pen: '画笔',
  text: '文字',
};

const TOOL_ICON = { box: Square, pen: PenLine, text: Type } as const;

export class MarkError extends Error {
  constructor(readonly reason: 'snapshot' | 'too-large') {
    super('');
  }
}

export async function bakeMarkPng(
  frame: HTMLIFrameElement,
  marks: readonly Mark[],
  frameWidth: number,
): Promise<string> {
  const result = await requestPreviewSnapshot(frame);
  if (!result.ok) throw new MarkError('snapshot');
  const dataUrl = await bakeMarks(result.snapshot, marks, frameWidth, MARK_COLOR);
  const pngBase64 = dataUrl.slice(PNG_PREFIX.length);
  if (Math.floor((pngBase64.length * 3) / 4) > DESIGN_LIMITS.markBytes)
    throw new MarkError('too-large');
  return pngBase64;
}

export function markTarget(
  marks: readonly Mark[],
  frame: { width: number; height: number },
  label: string,
): ElementTarget {
  const bounds = markBounds(marks) ?? { x: 0, y: 0, width: 0, height: 0 };
  return {
    elementId: '',
    selector: 'body',
    label,
    text: '',
    htmlHint: '',
    position: {
      x: Math.round(bounds.x * frame.width),
      y: Math.round(bounds.y * frame.height),
      width: Math.round(bounds.width * frame.width),
      height: Math.round(bounds.height * frame.height),
    },
    style: null,
  };
}

export function MarkBar({
  drawing,
  busy,
  onCancel,
  onSave,
  onSend,
}: {
  drawing: ReturnType<typeof useDrawing>;
  busy: boolean;
  onCancel: () => void;
  onSave: (note: string) => void;
  onSend: ((note: string) => void) | undefined;
}) {
  const { t } = useI18n();
  const [note, setNote] = useState('');
  const { undo, redo } = drawing;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing =
        event.target instanceof HTMLElement &&
        (event.target.isContentEditable || ['INPUT', 'TEXTAREA'].includes(event.target.tagName));
      if (event.key === 'Escape' && !typing) {
        onCancel();
        return;
      }
      if (typing || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return;
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, onCancel]);
  const trimmed = note.trim();
  const ready = trimmed !== '' && hasInk(drawing.marks) && !busy;
  return (
    <div
      role="toolbar"
      aria-label={t('标注工具')}
      data-testid="design-mark-bar"
      className="flex flex-none flex-wrap items-center gap-1.5 border-b border-border bg-background px-2 py-1.5"
    >
      <SegmentedTabs
        value={drawing.tool}
        label={t('标注工具')}
        onChange={drawing.setTool}
        options={(['box', 'pen', 'text'] as const).map((value) => {
          const Icon = TOOL_ICON[value];
          return {
            value,
            label: t(TOOL_LABEL[value]),
            icon: <Icon aria-hidden className="size-4" />,
            testId: `design-mark-tool-${value}`,
          };
        })}
      />
      <IconTooltip
        label={t('撤销')}
        side="bottom"
        trigger={
          <Button
            variant="ghost"
            size="icon-sm"
            data-testid="design-mark-undo"
            disabled={!drawing.canUndo}
            className="text-content-secondary"
            onClick={undo}
          />
        }
      >
        <Undo2 aria-hidden className="size-4" />
      </IconTooltip>
      <IconTooltip
        label={t('重做')}
        side="bottom"
        trigger={
          <Button
            variant="ghost"
            size="icon-sm"
            data-testid="design-mark-redo"
            disabled={!drawing.canRedo}
            className="text-content-secondary"
            onClick={redo}
          />
        }
      >
        <Redo2 aria-hidden className="size-4" />
      </IconTooltip>
      <Input
        data-testid="design-mark-note"
        aria-label={t('标注说明')}
        placeholder={t('说说要怎么改')}
        maxLength={DESIGN_LIMITS.noteChars}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onCancel();
          }
          if (event.key === 'Enter' && ready) {
            event.preventDefault();
            onSave(trimmed);
          }
        }}
        className="h-8 min-w-40 flex-1 text-ui"
      />
      <Button variant="ghost" size="sm" data-testid="design-mark-cancel" onClick={onCancel}>
        {t('取消')}
      </Button>
      <Button
        variant="outline"
        size="sm"
        data-testid="design-mark-save"
        disabled={!ready}
        onClick={() => onSave(trimmed)}
      >
        {t('保存')}
      </Button>
      {onSend !== undefined && (
        <Button
          size="sm"
          data-testid="design-mark-send"
          disabled={!ready}
          onClick={() => onSend(trimmed)}
        >
          {t('发给 agent')}
        </Button>
      )}
    </div>
  );
}
