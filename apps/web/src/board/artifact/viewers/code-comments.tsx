import { useEffect, useState } from 'react';
import { TextViewer } from '../../../vendor-open-design/viewers/text-viewer.js';
import { CommentPin } from '../../design/design-comment-list.js';
import { useCommentLayer } from '../file-comments.js';

function lineOf(node: Node | null): number | null {
  const element = node instanceof Element ? node : (node?.parentElement ?? null);
  const row = element?.closest<HTMLElement>('[data-line]') ?? null;
  return row === null ? null : Number(row.dataset.line);
}

export function CodeComments({ name, text }: { name: string; text: string }) {
  const layer = useCommentLayer();
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const commenting = layer?.commenting ?? false;
  const pick = layer?.pick;
  const report = layer?.report;
  const lineCount = text.split('\n').length;
  useEffect(() => report?.({ lines: lineCount }), [report, lineCount]);
  useEffect(() => {
    if (root === null || !commenting || pick === undefined) return;
    const up = (event: MouseEvent) => {
      const selection = window.getSelection();
      const collapsed = selection === null || selection.isCollapsed;
      const a = collapsed ? lineOf(event.target as Node) : lineOf(selection.anchorNode);
      const b = collapsed ? a : lineOf(selection.focusNode);
      if (a === null || b === null) return;
      selection?.removeAllRanges();
      pick({
        anchor: { type: 'lines', from: Math.min(a, b), to: Math.max(a, b) },
        point: { x: event.clientX, y: event.clientY },
      });
    };
    root.addEventListener('mouseup', up);
    return () => root.removeEventListener('mouseup', up);
  }, [root, commenting, pick]);
  const marks = new Map<
    number,
    { id: string; pin: number; status: 'open' | 'sent' | 'resolved' }
  >();
  for (const comment of layer?.comments ?? [])
    if (comment.anchor?.type === 'lines') marks.set(comment.anchor.from, comment);
  return (
    <div
      ref={setRoot}
      data-testid="artifact-code"
      data-commenting={commenting || undefined}
      className={`flex min-h-0 flex-1 flex-col ${commenting ? 'cursor-text' : ''}`}
    >
      <TextViewer
        name={name}
        text={text}
        lineMark={(line) => {
          const comment = marks.get(line);
          return comment === undefined || layer === null ? null : (
            <span className="absolute top-5 left-2">
              <CommentPin
                pin={comment.pin}
                status={comment.status}
                onClick={() => layer.focus(comment.id)}
              />
            </span>
          );
        }}
      />
    </div>
  );
}
