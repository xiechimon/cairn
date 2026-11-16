import type {
  ChiefReportContent,
  ChiefReportTodoRef,
  RetroProposal,
  RetroProposalStatus,
} from '@cairn/shared';
import { useI18n } from '../i18n/provider.js';
import { ResearchReportCard } from './research-report.js';

type Translate = ReturnType<typeof useI18n>['t'];

function mdText(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/[\\`*_[\]<>#|~]/g, '\\$&');
}

function todoLinks(refs: readonly ChiefReportTodoRef[]): string {
  return refs.map((ref) => `[${mdText(ref.title)}](todo:${ref.id})`).join('、');
}

function statusLabel(status: RetroProposalStatus, t: Translate): string {
  if (status === 'accepted') return t('已建成线程');
  if (status === 'dismissed') return t('已忽略');
  return t('未处理（只读）');
}

function suggestionLines(p: RetroProposal, n: number, t: Translate): string[] {
  const pad = ' '.repeat(String(n).length + 2);
  const state = statusLabel(p.status, t);
  const title =
    p.status === 'accepted' && p.todoId !== null
      ? `[${mdText(p.title)}](todo:${p.todoId})`
      : mdText(p.title);
  const source =
    p.source.todoId === null
      ? t('协调者对话')
      : `[${mdText(p.source.label)}](todo:${p.source.todoId})`;
  return [
    `${n}. **${title}** · ${state}`,
    `${pad}${mdText(p.what)}`,
    `${pad}- ${t('为什么没拦住：{why}', { why: mdText(p.why) })}`,
    `${pad}- ${t('防护：{safeguard}', { safeguard: mdText(p.safeguard) })}`,
    `${pad}- ${t('出处：')}${source}`,
  ];
}

export function chiefReportSentence(report: ChiefReportContent, t: Translate): string {
  const y = report.yesterday;
  const counts = {
    day: report.day,
    done: y.finishedCount,
    merged: y.mergedCount,
    failed: y.failedCount,
  };
  if (report.status !== 'posted')
    return t('{day} 的历史日报未完成：完成 {done} · 合并 {merged} · 失败 {failed}', counts);
  return t('{day} 的历史日报：完成 {done} · 合并 {merged} · 失败 {failed}', counts);
}

export function chiefReportMarkdown(report: ChiefReportContent, t: Translate): string {
  const y = report.yesterday;
  const suggestions = report.status === 'posted' ? report.retro : [];
  const out: string[] = [];
  out.push(
    chiefReportSentence(report, t),
    '',
    t('历史记录，仅供查看；日报已停用，不再生成或处理建议。'),
  );
  out.push('', `## ${t('昨天（{day}）的进展', { day: report.covers })}`, '');
  out.push(
    t(
      '完成 {done} · 合并 {merged} · 失败 {failed} · 重跑 {retries} · 等额度 {quota} · 审查通过 {pass} / 拦下 {block}',
      {
        done: y.finishedCount,
        merged: y.mergedCount,
        failed: y.failedCount,
        retries: y.retries,
        quota: y.quotaWaits,
        pass: y.verdicts.pass,
        block: y.verdicts.block,
      },
    ),
  );
  const refs: string[] = [];
  if (y.finished.length > 0) refs.push(`- ${t('完成：')}${todoLinks(y.finished)}`);
  if (y.merged.length > 0)
    refs.push(
      `- ${t('合并：')}${y.merged
        .map((pr) =>
          pr.prUrl === null
            ? `[${mdText(pr.title)}](todo:${pr.id})`
            : `[PR ${pr.prNumber ?? ''} · ${mdText(pr.title)}](${pr.prUrl})`,
        )
        .join('、')}`,
    );
  if (y.failed.length > 0) refs.push(`- ${t('失败：')}${todoLinks(y.failed)}`);
  if (refs.length > 0) out.push('', ...refs);
  out.push('', `## ${t('等你的事')}`, '');
  out.push(
    report.needsYou.count === 0
      ? t('没有等你的事')
      : t('写日报时有 {n} 件等你，现在的情况看任务面板。', { n: report.needsYou.count }),
  );
  if (report.status === 'posted' && report.retroRan) {
    out.push('', `## ${t('复盘建议')}`, '');
    if (suggestions.length === 0) out.push(t('昨天的对话里没找到值得改的地方'));
    else
      suggestions.forEach((entry, index) => {
        out.push(...suggestionLines(entry, index + 1, t));
      });
  }
  const notes: string[] = [];
  if (report.truncated.length > 0)
    notes.push(
      t('这些来源太长，只读了后面的部分：{sources}。', {
        sources: report.truncated.map(mdText).join('、'),
      }),
    );
  if (notes.length > 0) out.push('', '---', '', ...notes.flatMap((note) => [note, '']));
  return `${out.join('\n').trimEnd()}\n`;
}

export function ChiefReportMessage({ report }: { report: ChiefReportContent }) {
  const { t } = useI18n();
  return (
    <>
      <p className="m-0" data-testid="chief-report-sentence">
        {chiefReportSentence(report, t)}
      </p>
      <ResearchReportCard
        inline
        className="mt-1"
        report={{
          title: report.day,
          content: chiefReportMarkdown(report, t),
          createdAt: report.madeAt,
          final: null,
          label: t('历史日报'),
        }}
      />
    </>
  );
}
