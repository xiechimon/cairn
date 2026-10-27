import type { ChiefDigestItem } from '@cairn/shared';
import { CHIEF_DIGEST_GROUP_LABELS, CHIEF_DIGEST_GROUPS } from '@cairn/shared';
import { useId, useState } from 'react';
import { Link } from 'react-router';
import { useApiMutations, useMemories } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { Button } from '../components/ui/button.js';
import { MessageScrollerItem } from '../components/ui/message-scroller.js';
import { toastError } from '../components/ui/toaster.js';
import { ChatMarkdown } from '../detail/chat-markdown.js';
import { useI18n } from '../i18n/provider.js';
import { ChevronDown, ExternalLink, Trash2 } from '../icons/index.js';
import { AGENTS_HREF } from '../routes/agent-detail-page.js';

const DIVIDER_CLS =
  "my-3 flex items-center gap-3 text-meta text-content-tertiary before:h-px before:flex-1 before:bg-border before:content-[''] after:h-px after:flex-1 after:bg-border after:content-['']";
const TOGGLE_CLS =
  'h-7 max-w-[calc(100%-3rem)] gap-1.5 rounded-full px-2.5 text-meta font-normal whitespace-normal text-content-secondary [&_svg]:transition-transform [&_svg]:duration-200 aria-expanded:[&_svg]:rotate-180';
const CARD_CLS =
  'mb-3 flex flex-col gap-3 rounded-(--radius-card) border border-border bg-card px-3.5 py-3 text-ui leading-6 text-content-secondary';
const GROUP_CLS = 'grid grid-cols-[3.25rem_minmax(0,1fr)] gap-x-2.5 gap-y-1.5';
const ITEM_CLS = 'flex min-w-0 items-start gap-2 data-gone:opacity-60';
const ITEM_TEXT_CLS =
  'min-w-0 flex-1 text-foreground [&>:first-child]:mt-0! [&>:last-child]:mb-0! [[data-gone]_&]:line-through';
const ICON_BTN_CLS = 'size-7 shrink-0 text-content-tertiary';

function clock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function DigestItem({
  item,
  gone,
  onForget,
}: {
  item: ChiefDigestItem;
  gone: boolean;
  onForget: (memory: { id: string; agentId: string }) => void;
}) {
  const { t } = useI18n();
  const memory = item.memory;
  return (
    <li data-testid="chief-digest-item" data-gone={gone ? '' : undefined} className={ITEM_CLS}>
      <div className="min-w-0 flex-1">
        <div className={ITEM_TEXT_CLS}>
          <ChatMarkdown text={item.text} />
        </div>
        {(item.reason !== '' || gone) && (
          <div className="text-meta text-content-tertiary">{gone ? t('已忘掉') : item.reason}</div>
        )}
      </div>
      {memory !== undefined && !gone && (
        <>
          <Button
            variant="ghost"
            size="icon"
            className={ICON_BTN_CLS}
            aria-label={t('查看这条记忆')}
            render={<Link to={`${AGENTS_HREF}/${memory.agentId}?tab=memory#memory-${memory.id}`} />}
          >
            <ExternalLink width={14} height={14} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={ICON_BTN_CLS}
            aria-label={t('让总管忘掉这条')}
            onClick={() => onForget(memory)}
          >
            <Trash2 width={14} height={14} />
          </Button>
        </>
      )}
    </li>
  );
}

export function ChiefDigestRow({
  reason,
  madeAt,
  items,
}: {
  reason: 'daily' | 'threshold';
  madeAt: number;
  items: ChiefDigestItem[];
}) {
  const { t } = useI18n();
  const { live, teamId } = useLiveData();
  const [open, setOpen] = useState(false);
  const [forgotten, setForgotten] = useState<ReadonlySet<string>>(new Set());
  const cardId = useId();
  const memoryAgentId = items.find((item) => item.memory !== undefined)?.memory?.agentId;
  const memoriesQ = useMemories(teamId, memoryAgentId, live && open && memoryAgentId !== undefined);
  const mutations = useApiMutations(teamId);
  const known = memoriesQ.data === undefined ? null : new Set(memoriesQ.data.map((m) => m.id));
  const isGone = (item: ChiefDigestItem) =>
    item.memory !== undefined &&
    (forgotten.has(item.memory.id) || (known !== null && !known.has(item.memory.id)));
  const forget = (memory: { id: string; agentId: string }) => {
    if (!live) {
      setForgotten((prev) => new Set(prev).add(memory.id));
      return;
    }
    mutations.deleteMemory.mutate(
      { agentId: memory.agentId, memoryId: memory.id },
      {
        onSuccess: () => setForgotten((prev) => new Set(prev).add(memory.id)),
        onError: (error) => toastError(t('删除记忆失败，请重试。'), error),
      },
    );
  };
  const label =
    reason === 'daily'
      ? t('总管把昨天的对话整理成了 {n} 条摘要', { n: items.length })
      : t('对话太长了，总管把上面的内容整理成了 {n} 条摘要', { n: items.length });
  return (
    <MessageScrollerItem style={{ contentVisibility: 'visible' }}>
      <div className={DIVIDER_CLS} data-testid="chief-digest">
        <Button
          variant="outline"
          className={TOGGLE_CLS}
          aria-expanded={open}
          aria-controls={cardId}
          onClick={() => setOpen((v) => !v)}
        >
          {label}
          <ChevronDown width={12} height={12} aria-hidden="true" />
        </Button>
      </div>
      <section
        id={cardId}
        hidden={!open}
        data-testid="chief-digest-card"
        aria-label={label}
        className={CARD_CLS}
      >
        <h3 className="m-0 text-ui font-medium text-foreground">
          {t(reason === 'daily' ? '昨天的摘要 · {time} 整理' : '上面内容的摘要 · {time} 整理', {
            time: clock(madeAt),
          })}
        </h3>
        {CHIEF_DIGEST_GROUPS.map((group) => {
          const groupItems = items.filter((item) => item.group === group);
          if (groupItems.length === 0) return null;
          return (
            <div key={group} data-testid="chief-digest-group" className={GROUP_CLS}>
              <span className="pt-px text-meta text-content-tertiary">
                {t(CHIEF_DIGEST_GROUP_LABELS[group])}
              </span>
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                {groupItems.map((item, index) => (
                  <DigestItem key={index} item={item} gone={isGone(item)} onForget={forget} />
                ))}
              </ul>
            </div>
          );
        })}
        <p className="m-0 border-t border-border pt-2.5 text-meta text-content-tertiary">
          {t(
            '原文都还在，往上滑就能看到。总管接着聊时用的是这份摘要；任务的进度它会直接去任务里查，不靠记对话。摘要漏了或写错了，直接在下面告诉总管。',
          )}
        </p>
      </section>
    </MessageScrollerItem>
  );
}
