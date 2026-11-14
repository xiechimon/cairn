import { infoReportMessageSchema } from '@cairn/shared';
import { cn } from 'cn';
import { createContext, useContext, useMemo, useState } from 'react';
import { useConversationMessages } from '../api/hooks.js';
import { TraceCard } from '../components/chat/trace-parts.js';
import { Button } from '../components/ui/button.js';
import { DialogShell } from '../components/ui/dialog-shell.js';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover.js';
import { ChatMarkdown } from '../detail/chat-markdown.js';
import { TodoGlanceContext } from '../detail/segments.js';
import { useI18n } from '../i18n/provider.js';
import { FileText } from '../icons/index.js';
import { messageStampLabel } from './time-dividers.js';

export interface ResearchReport {
  title: string;
  content: string;
  createdAt: number | undefined;
  final: boolean;
}

export const ReportThreadContext = createContext<{ title: string; final: boolean } | null>(null);

export const isFinalReportPhase = (phase: string) => phase === 'done' || phase === 'review';

export function TranscriptReportCard({
  content,
  createdAt,
}: {
  content: string;
  createdAt: number | undefined;
}) {
  const { t } = useI18n();
  const thread = useContext(ReportThreadContext);
  const heading = /^#{1,3}\s+(.+)$/m.exec(content)?.[1]?.trim();
  return (
    <ResearchReportCard
      className="mt-3"
      report={{
        title: thread?.title ?? heading ?? t('调研报告'),
        content,
        createdAt,
        final: thread?.final ?? true,
      }}
    />
  );
}

export function reportSummaryOf(content: string): string {
  const para = content
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .find((block) => block !== '' && !/^(#|!\[|[-*]\s|\d+\.\s|```|\||>)/.test(block));
  return (para ?? '').replace(/[*_`]/g, '').replace(/\s+/g, ' ');
}

export function ResearchReportCard({
  report,
  className,
}: {
  report: ResearchReport;
  className?: string;
}) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const summary = reportSummaryOf(report.content);
  const stage = report.final ? t('定稿') : t('初稿');
  const when =
    report.createdAt === undefined
      ? null
      : messageStampLabel(report.createdAt, Date.now(), locale, t);
  return (
    <>
      <Popover open={hover && !open} onOpenChange={setHover}>
        <PopoverTrigger
          openOnHover
          delay={350}
          nativeButton={false}
          render={<TraceCard className={cn('w-fit max-w-full', className)} />}
        >
          <Button
            variant="ghost"
            data-testid="research-report-card"
            data-stage={report.final ? 'final' : 'draft'}
            onClick={() => setOpen(true)}
            className="h-10 max-w-full justify-start gap-2 border-0 px-3 text-ui font-normal text-foreground hover:bg-(--menu-hover) pointer-coarse:h-11 dark:hover:bg-(--menu-hover)"
          >
            <FileText aria-hidden="true" className="size-5 flex-none text-content-secondary" />
            <span className="flex-none">{t('调研报告已生成')}</span>
            <span className="min-w-0 truncate text-content-secondary">{report.title}</span>
            <span
              data-slot="research-report-stage"
              className="flex-none rounded-sm bg-secondary px-1.5 text-meta text-content-secondary"
            >
              {stage}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="start"
          data-testid="research-report-hover"
          className="w-80 gap-1.5 p-3.5 duration-0 data-open:animate-none data-closed:animate-none"
        >
          <div className="flex items-center gap-2 text-meta text-content-tertiary">
            <FileText aria-hidden="true" className="size-4 flex-none" />
            <span>{stage}</span>
            {when !== null && <span className="ml-auto tabular-nums">{when}</span>}
          </div>
          <p className="m-0 line-clamp-2 text-ui font-medium text-foreground">{report.title}</p>
          {summary !== '' && (
            <p className="m-0 line-clamp-3 text-ui text-content-secondary">{summary}</p>
          )}
        </PopoverContent>
      </Popover>
      <ResearchReportDialog report={report} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

export function ResearchReportDialog({
  report,
  open,
  onClose,
}: {
  report: ResearchReport;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <DialogShell
      title={report.title}
      subtitle={report.final ? t('定稿') : t('初稿')}
      open={open}
      onClose={onClose}
      width="var(--settings-w)"
      className="h-(--settings-h)"
    >
      <div
        data-testid="research-report-doc"
        className="chat-text mx-auto max-w-180 font-sans text-ui leading-6 break-words text-foreground"
      >
        <ChatMarkdown text={report.content} />
      </div>
    </DialogShell>
  );
}

export function useBuildReport(
  thread: { buildId: string | null; title: string; phase: string } | null,
): { report: ResearchReport | null; settled: boolean } {
  const buildId = thread?.buildId ?? null;
  const { query, messages } = useConversationMessages(buildId, thread !== null);
  const report = useMemo(() => {
    if (thread === null || buildId === null) return null;
    const row = messages.find((m) => m.id === `info-report-${buildId}`);
    if (row === undefined || typeof row.content !== 'string') return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.content);
    } catch {
      return null;
    }
    const message = infoReportMessageSchema.safeParse(parsed);
    if (!message.success) return null;
    return {
      title: thread.title,
      content: `${message.data.attachmentToken}\n\n${message.data.content}`,
      createdAt: row.createdAt,
      final: isFinalReportPhase(thread.phase),
    };
  }, [thread, buildId, messages]);
  return { report, settled: buildId === null || query.isSuccess || query.isError };
}

export function useResearchReport(todoId: string): ResearchReport | null {
  const glance = useContext(TodoGlanceContext)?.get(todoId);
  const thread = useMemo(
    () =>
      glance?.report === true
        ? { buildId: glance.buildId ?? null, title: glance.title ?? '', phase: glance.phase }
        : null,
    [glance],
  );
  return useBuildReport(thread).report;
}

export function ResearchReportRow({ todoId, indent }: { todoId: string; indent: string }) {
  const report = useResearchReport(todoId);
  if (report === null) return null;
  return <ResearchReportCard report={report} className={cn('my-1', indent)} />;
}
