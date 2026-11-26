import { DESIGN_LIMITS } from '@cairn/shared';
import { type ReactNode, useEffect, useLayoutEffect, useState } from 'react';
import { MarkdownViewer } from '../../../vendor-open-design/viewers/markdown-viewer.js';
import { CommentPin } from '../../design/design-comment-list.js';
import { useCommentLayer } from '../file-comments.js';

const TEXT_MATCH = 24;

interface Placed {
  id: string;
  pin: number;
  status: 'open' | 'sent' | 'resolved';
  top: number;
}

function blocksRoot(article: HTMLElement): HTMLElement | null {
  return article.querySelector<HTMLElement>('[data-slot="reply-blocks"]');
}

function blockText(element: Element): string {
  return (element.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function samePlaced(a: readonly Placed[], b: readonly Placed[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (item, index) =>
      item.id === b[index]?.id &&
      item.pin === b[index]?.pin &&
      item.status === b[index]?.status &&
      item.top === b[index]?.top,
  );
}

export function MarkdownComments({
  text,
  header,
  docTestId,
  docClassName,
}: {
  text: string;
  header?: ReactNode;
  docTestId?: string;
  docClassName?: string;
}) {
  const layer = useCommentLayer();
  const [article, setArticle] = useState<HTMLElement | null>(null);
  const [placed, setPlaced] = useState<Placed[]>([]);
  const commenting = layer?.commenting ?? false;
  const pick = layer?.pick;
  const report = layer?.report;
  const comments = layer?.comments;
  useEffect(() => {
    if (article === null || !commenting || pick === undefined) return;
    const click = (event: MouseEvent) => {
      const root = blocksRoot(article);
      if (root === null || !(event.target instanceof Element)) return;
      let block: Element | null = event.target;
      while (block !== null && block.parentElement !== root) block = block.parentElement;
      if (block === null) return;
      event.preventDefault();
      const index = [...root.children].indexOf(block) + 1;
      pick({
        anchor: null,
        element: {
          selector: `:scope > :nth-child(${index})`,
          label: block.tagName.toLowerCase(),
          text: blockText(block).slice(0, DESIGN_LIMITS.textChars),
        },
        point: { x: event.clientX, y: event.clientY },
      });
    };
    article.addEventListener('click', click);
    return () => article.removeEventListener('click', click);
  }, [article, commenting, pick]);
  useLayoutEffect(() => {
    if (article === null || comments === undefined) return;
    const root = blocksRoot(article);
    const lost = new Set<string>();
    const next: Placed[] = [];
    for (const comment of comments) {
      if (comment.anchor !== null || comment.selector === '') continue;
      const block = root?.querySelector(comment.selector) ?? null;
      const matches =
        block !== null &&
        blockText(block).slice(0, TEXT_MATCH) === comment.text.slice(0, TEXT_MATCH);
      if (!matches || !(block instanceof HTMLElement)) {
        lost.add(comment.id);
        continue;
      }
      next.push({ id: comment.id, pin: comment.pin, status: comment.status, top: block.offsetTop });
    }
    setPlaced((current) => (samePlaced(current, next) ? current : next));
    report?.({ lostElements: lost });
  }, [article, comments, report, text]);
  return (
    <div
      data-testid="artifact-markdown"
      data-commenting={commenting || undefined}
      className="artifact-markdown flex min-h-0 flex-1 flex-col"
    >
      <MarkdownViewer
        text={text}
        mode="preview"
        articleRef={setArticle}
        header={header}
        docTestId={docTestId}
        docClassName={docClassName}
      >
        {layer !== null &&
          placed.map((item) => (
            <span key={item.id} className="absolute right-0" style={{ top: item.top + 22 }}>
              <CommentPin
                pin={item.pin}
                status={item.status}
                onClick={() => layer.focus(item.id)}
              />
            </span>
          ))}
      </MarkdownViewer>
    </div>
  );
}
