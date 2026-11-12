import type { ChiefDigestItem } from '@cairn/shared';
import { CHIEF_DIGEST_GROUP_LABELS, CHIEF_DIGEST_GROUPS } from '@cairn/shared';
import { useId, useState } from 'react';
import { useApiMutations, useMemories } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { STATUS_LINE_CLS } from '../components/chat/status-line.js';
import { Button } from '../components/ui/button.js';
import { MessageScrollerItem } from '../components/ui/message-scroller.js';
import { toastError } from '../components/ui/toaster.js';
import { ChatMarkdown } from '../detail/chat-markdown.js';
import { useI18n } from '../i18n/provider.js';
import { ChevronDown, Trash2 } from '../icons/index.js';

const DIVIDER_CLS = `${STATUS_LINE_CLS} mt-6 mb-3`;
const TOGGLE_CLS =
  'h-auto min-h-7 max-w-full gap-2 border-0 bg-transparent p-0 text-left text-card-title font-normal whitespace-normal text-(--foreground) hover:bg-transparent dark:hover:bg-transparent aria-expanded:bg-transparent [&_svg]:transition-transform [&_svg]:duration-200 aria-expanded:[&_svg]:rotate-180';
const CARD_CLS =
  'mb-3 flex flex-col gap-3 rounded-(--radius-card) border border-border bg-card px-3.5 py-3 text-ui leading-6 text-foreground';
const GROUP_CLS = 'grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5';
const ITEM_CLS = 'flex min-w-0 items-start gap-2 data-gone:opacity-60';
const ITEM_TEXT_CLS =
  'min-w-0 flex-1 text-foreground [&>:first-child]:mt-0! [&>:last-child]:mb-0! [[data-gone]_&]:line-through';
const ICON_BTN_CLS = 'size-7 shrink-0 text-content-tertiary';

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
  const hasMemory = items.some((item) => item.memory !== undefined);
  const memoriesQ = useMemories(teamId, live && open && hasMemory);
  const mutations = useApiMutations(teamId);
  const known = memoriesQ.data === undefined ? null : new Set(memoriesQ.data.map((m) => m.id));
  const label =
    reason === 'daily'
      ? t('Coordinator 把昨天的对话整理成了 {n} 条摘要', { n: items.length })
      : t('对话太长了，Coordinator 把上面的内容整理成了 {n} 条摘要', { n: items.length });
  return (
    <MessageScrollerItem style={{ contentVisibility: 'visible' }}>
      <div className={DIVIDER_CLS} data-testid="chief-digest">
        <Button
          variant="ghost"
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
            time: new Date(madeAt).toTimeString().slice(0, 5),
          })}
        </h3>
        {CHIEF_DIGEST_GROUPS.map((group) => {
          const groupItems = items.filter((item) => item.group === group);
          if (groupItems.length === 0) return null;
          return (
            <div key={group} data-testid="chief-digest-group" className={GROUP_CLS}>
              <span className="truncate pt-px text-meta text-content-tertiary">
                {t(CHIEF_DIGEST_GROUP_LABELS[group])}
              </span>
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                {groupItems.map((item, index) => {
                  const memory = item.memory;
                  const gone =
                    memory !== undefined &&
                    (forgotten.has(memory.id) || (known !== null && !known.has(memory.id)));
                  return (
                    <li
                      key={index}
                      data-testid="chief-digest-item"
                      data-gone={gone ? '' : undefined}
                      className={ITEM_CLS}
                    >
                      <div className="min-w-0 flex-1">
                        <div className={ITEM_TEXT_CLS}>
                          <ChatMarkdown text={item.text} />
                        </div>
                        {(item.reason !== '' || gone) && (
                          <div className="text-meta text-content-tertiary">
                            {gone ? t('已忘掉') : item.reason}
                          </div>
                        )}
                      </div>
                      {memory !== undefined && !gone && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className={ICON_BTN_CLS}
                          aria-label={t('让 Coordinator 忘掉这条')}
                          onClick={() => {
                            const markGone = () =>
                              setForgotten((prev) => new Set(prev).add(memory.id));
                            if (!live) markGone();
                            else
                              mutations.deleteMemory.mutate(
                                { memoryId: memory.id },
                                {
                                  onSuccess: markGone,
                                  onError: (error) =>
                                    toastError(t('删除记忆失败，请重试。'), error),
                                },
                              );
                          }}
                        >
                          <Trash2 width={16} height={16} />
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
        <p className="m-0 border-t border-border pt-2.5 text-meta text-content-tertiary">
          {t(
            '原文都还在，往上滑就能看到。Coordinator 接着聊时用的是这份摘要；任务的进度它会直接去任务里查，不靠记对话。摘要漏了或写错了，直接在下面告诉 Coordinator。',
          )}
        </p>
      </section>
    </MessageScrollerItem>
  );
}
