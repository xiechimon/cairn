import {
  type ChiefReportContent,
  type ChiefReportSuggestion,
  type ChiefReportTodoRef,
  chiefReportSuggestions,
  type RetroProposalStatus,
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

function sourceHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function statusLabel(status: RetroProposalStatus, t: Translate): string {
  if (status === 'accepted') return t('已建成线程');
  if (status === 'dismissed') return t('已忽略');
  return t('待你决定');
}

function suggestionLines(entry: ChiefReportSuggestion, t: Translate): string[] {
  const pad = ' '.repeat(String(entry.n).length + 2);
  const state = statusLabel(entry.item.status, t);
  const made =
    entry.item.status === 'accepted' && entry.item.todoId !== null
      ? `[${state}](todo:${entry.item.todoId})`
      : state;
  if (entry.kind === 'retro') {
    const p = entry.item;
    const source =
      p.source.todoId === null
        ? t('协调者对话')
        : `[${mdText(p.source.label)}](todo:${p.source.todoId})`;
    return [
      `${entry.n}. **${mdText(p.title)}** · ${made}`,
      `${pad}${mdText(p.what)}`,
      `${pad}- ${t('为什么没拦住：{why}', { why: mdText(p.why) })}`,
      `${pad}- ${t('防护：{safeguard}', { safeguard: mdText(p.safeguard) })}`,
      `${pad}- ${t('出处：')}${source}`,
    ];
  }
  const item = entry.item;
  return [
    `${entry.n}. **${mdText(item.claim)}** · ${made}`,
    `${pad}- ${t('来源：')}[${mdText(sourceHost(item.url))}](${item.url})`,
    ...(item.matches === ''
      ? []
      : [`${pad}- ${t('对应：{matches}', { matches: mdText(item.matches) })}`]),
    ...(item.action === ''
      ? []
      : [`${pad}- ${t('建议动作：{action}', { action: mdText(item.action) })}`]),
  ];
}

function isQuiet(report: ChiefReportContent): boolean {
  const y = report.yesterday;
  return (
    y.finishedCount + y.mergedCount + y.failedCount + y.retries + y.quotaWaits === 0 &&
    y.verdicts.pass + y.verdicts.block === 0
  );
}

function undecidedCount(suggestions: readonly ChiefReportSuggestion[]): number {
  return suggestions.filter((entry) => entry.item.status === 'draft').length;
}

export function chiefReportSentence(report: ChiefReportContent, t: Translate): string {
  const y = report.yesterday;
  const counts = { done: y.finishedCount, merged: y.mergedCount, failed: y.failedCount };
  if (report.status !== 'posted')
    return t('日报没写成，先看昨天的数字：完成 {done} · 合并 {merged} · 失败 {failed}', counts);
  const k = undecidedCount(chiefReportSuggestions(report));
  const today = report.day === new Intl.DateTimeFormat('en-CA').format(Date.now());
  const quiet = isQuiet(report) && k === 0;
  const head = today
    ? quiet
      ? t('今天的日报写好了：昨天没有新进展')
      : t('今天的日报写好了：完成 {done} · 合并 {merged} · 失败 {failed}', counts)
    : quiet
      ? t('{day} 的日报写好了：{covers} 没有新进展', { day: report.day, covers: report.covers })
      : t('{day} 的日报写好了：完成 {done} · 合并 {merged} · 失败 {failed}', {
          day: report.day,
          ...counts,
        });
  return k === 0 ? head : `${head}${t('，有 {k} 条建议等你决定', { k })}`;
}

export function chiefReportMarkdown(report: ChiefReportContent, t: Translate): string {
  const y = report.yesterday;
  const suggestions = report.status === 'posted' ? chiefReportSuggestions(report) : [];
  const retro = suggestions.filter((entry) => entry.kind === 'retro');
  const intake = suggestions.filter((entry) => entry.kind === 'intake');
  const out: string[] = [];
  out.push(
    report.status === 'retrying'
      ? t('日报没写成，过一会儿再试一次；先看昨天的数字。')
      : report.status === 'failed'
        ? t('日报两次都没写成；下面是昨天的原始数字。')
        : chiefReportSentence(report, t),
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
    if (retro.length === 0) out.push(t('昨天的对话里没找到值得改的地方'));
    else for (const entry of retro) out.push(...suggestionLines(entry, t));
  }
  if (intake.length > 0) {
    out.push('', `## ${t('外部动态')}`, '');
    for (const entry of intake) out.push(...suggestionLines(entry, t));
  }
  const notes: string[] = [];
  if (suggestions.length > 0)
    notes.push(
      t(
        '要处理某条建议，直接在对话里告诉 Coordinator，比如「{day} 日报第 1 条建线程」或「第 2 条不用了」。',
        {
          day: report.day,
        },
      ),
    );
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
          label: { card: t('日报'), doc: t('日报') },
        }}
      />
    </>
  );
}
