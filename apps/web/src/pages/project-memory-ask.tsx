import type { MemoryRecord } from '@cairn/shared';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from 'cn';
import { Check, CornerDownLeft } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useApiMutations } from '../api/hooks.js';
import { COMPOSER_FIELD_CLS, SEND_BTN_CLS, SEND_ON_CLS } from '../chief/composer-surface.js';
import { Button } from '../components/ui/button.js';
import { Input } from '../components/ui/input.js';
import { Spinner } from '../components/ui/spinner.js';
import { toastError } from '../components/ui/toaster.js';
import { blockDemoWrite } from '../demo/demo-gate.js';
import { useI18n } from '../i18n/provider.js';

const POLL_MS = 3_000;
const GIVE_UP_MS = 180_000;

export function ProjectMemoryAsk({
  live,
  teamId,
  projectId,
  memories,
  empty,
}: {
  live: boolean;
  teamId: string | undefined;
  projectId: string;
  memories: MemoryRecord[];
  empty: boolean;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const mutations = useApiMutations(teamId);
  const [draft, setDraft] = useState('');
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [baseline, setBaseline] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const own = memories.filter((memory) => memory.projectId === projectId);
  const changed =
    sentAt === null
      ? null
      : (own
          .filter((memory) => memory.updatedAt > baseline)
          .sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null);
  const waiting = sentAt !== null && changed === null && now - sentAt < GIVE_UP_MS;
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => {
      setNow(Date.now());
      void qc.invalidateQueries({ queryKey: ['memories', teamId] });
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [waiting, qc, teamId]);
  const sending = mutations.chiefOpenChannel.isPending || mutations.chiefSend.isPending;
  const send = async () => {
    const text = draft.trim();
    if (text === '' || sending) return;
    if (!live) {
      blockDemoWrite();
      return;
    }
    try {
      const thread = await mutations.chiefOpenChannel.mutateAsync(projectId);
      await mutations.chiefSend.mutateAsync({
        threadId: thread.id,
        projectId,
        clientMessageId: crypto.randomUUID(),
        content: t('改一下这个项目的记忆：{text}', { text }),
      });
      setDraft('');
      setBaseline(Math.max(0, ...own.map((memory) => memory.updatedAt)));
      const at = Date.now();
      setNow(at);
      setSentAt(at);
    } catch (error) {
      toastError(t('没有发出去，请重试。'), error);
    }
  };
  const hasDraft = draft.trim() !== '';
  return (
    <div className="sticky bottom-0 mt-1 bg-dialog-surface pt-4 pb-4">
      <div
        className={cn(
          'flex h-11.5 items-center gap-2 rounded-(--radius-composer) bg-(--composer-fill) pr-2 pl-3.5',
          COMPOSER_FIELD_CLS,
        )}
      >
        <Input
          data-testid="project-memory-ask"
          aria-label={t('让 agent 改记忆')}
          className="h-auto flex-auto border-0 bg-transparent outline-hidden px-0 py-0 text-ui text-foreground placeholder:text-content-tertiary focus-visible:border-0 focus-visible:ring-0 md:text-ui dark:bg-transparent"
          placeholder={
            empty
              ? t('告诉 agent 记住什么，例如：周四晚上 8 点发 B 站')
              : t('告诉 agent 怎么改，例如：发布时间改成周二')
          }
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('发送')}
          disabled={sending}
          className={cn(SEND_BTN_CLS, hasDraft && SEND_ON_CLS)}
          onClick={() => void send()}
        >
          {sending ? <Spinner /> : <CornerDownLeft width={20} height={20} />}
        </Button>
      </div>
      {sentAt !== null && (
        <p
          role="status"
          data-testid="project-memory-ask-status"
          className="mt-2 flex items-center gap-1.5 text-meta text-content-secondary"
        >
          {changed !== null ? (
            <>
              <Check aria-hidden className="size-4 flex-none" />
              {t('已改 {title}', { title: changed.title })}
            </>
          ) : waiting ? (
            <>
              <Spinner className="size-4" />
              {t('Coordinator 正在改记忆…')}
            </>
          ) : (
            t('已交给 Coordinator，改完会出现在上面。')
          )}
        </p>
      )}
    </div>
  );
}
