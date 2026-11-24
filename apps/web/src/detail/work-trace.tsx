import { CircleDashed } from 'lucide-react';
import { useState } from 'react';
import { formatLiveElapsed, liveTokensLabel, useLiveSeconds } from '../components/chat/live-row.js';
import {
  EMPTY_TRACE_COUNTS,
  TraceCard,
  TraceChevron,
  TraceCollapse,
  TraceCommandBox,
  TraceFailTag,
  TraceGroupSummary,
  TraceOutput,
  TraceRowButton,
  traceSummary,
} from '../components/chat/trace-parts.js';
import { IconTooltip } from '../components/icon-tooltip.js';
import { Button } from '../components/ui/button.js';
import type { TranscriptItem, WorkStep } from '../fixtures/records.js';
import type { TFunc } from '../i18n/translate.js';
import { ChatMarkdown } from './chat-markdown.js';

const TAIL_STEPS = 5;

export function earlierStepCount(total: number): number {
  return total > TAIL_STEPS + 1 ? total - TAIL_STEPS : 0;
}

const DONE_VERBS = {
  read: '读取了',
  search: '搜索了',
  run: '运行了',
  edit: '修改了',
  tool: '调用了',
  setup: '准备了',
};
const RUNNING_VERBS = {
  read: '正在读取',
  search: '正在搜索',
  run: '正在运行',
  edit: '正在修改',
  tool: '正在调用',
  setup: '正在准备',
};

export function formatWorkDuration(seconds: number | null): string {
  if (seconds === null) return '';
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const rounded = Math.round(seconds);
  return `${Math.floor(rounded / 60)}m ${rounded % 60}s`;
}

const THINK_HEADING = /^\*\*(.+?)\*\*$/gm;
const TEST_COMMAND =
  /\b(?:vitest|jest|pytest|mocha|playwright test|cargo test|go test)\b|\b(?:pnpm|npm|yarn|bun)(?: run)? (?:test|e2e)/;
const NAMED_PURPOSES = 2;

function liveMeta(elapsed: string, outputTokens: number | undefined, t: TFunc): string {
  if (elapsed === '' || outputTokens === undefined) return elapsed;
  return `${elapsed} · ${liveTokensLabel(outputTokens, t)}`;
}

export function workPurposes(steps: readonly WorkStep[], running: boolean, t: TFunc): string[] {
  const purposes = steps.flatMap((step, index) => {
    if (step.kind === 'say') return [];
    if (step.kind === 'think') {
      if (running && index !== steps.length - 1) return [];
      const headings = [...step.text.matchAll(THINK_HEADING)].map((match) =>
        (match[1] ?? '').trim(),
      );
      if (headings.length > 0) return running ? headings.slice(-1) : headings;
      if (!running || index !== steps.length - 1) return [];
      const tail = step.text
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '')
        .at(-1);
      const cleaned =
        tail
          ?.replace(/^(?:#{1,6}\s+|[-*>]\s+)/, '')
          .replace(/^\*+|\*+$/g, '')
          .trim() ?? '';
      return cleaned === '' ? [] : [cleaned];
    }
    if (step.command === undefined || step.description === undefined) return [];
    if (running && !step.running) return [];
    const purpose = (
      step.localized === true ? t(step.description, step.localizedVars) : step.description
    ).trim();
    return purpose === '' || purpose === (step.command.split('\n')[0] ?? '').trim()
      ? []
      : [purpose];
  });
  return [...new Set(purposes.filter((purpose) => purpose !== ''))].slice(0, NAMED_PURPOSES);
}

const FILE_NAME = /([\w.-]+\.[A-Za-z]\w*)/;

function touchedFiles(steps: readonly WorkStep[], action: 'read' | 'edit'): string[] {
  const paths = steps.flatMap((step) =>
    step.kind === 'call' && step.action === action && !step.running && !step.error
      ? [(step.target ?? '').replace(/ L\d.*$/, '').trim()]
      : [],
  );
  return [...new Set(paths.filter((path) => path !== ''))];
}

function fileNames(paths: readonly string[], t: TFunc): string {
  const [first = '', second = ''] = paths.map((path) => path.split('/').pop() ?? path);
  if (paths.length === 1) return first;
  return paths.length === 2
    ? t('{first}、{second}', { first, second })
    : t('{first}、{second} 等 {n} 个文件', {
        first,
        second,
        n: paths.length,
        more: paths.length - 2,
      });
}

export function workResult(steps: readonly WorkStep[], t: TFunc): string | null {
  const edited = touchedFiles(steps, 'edit');
  const testIndex = steps.findLastIndex(
    (step) =>
      step.kind === 'call' &&
      step.action === 'run' &&
      !step.running &&
      !step.unfinished &&
      TEST_COMMAND.test(step.command ?? ''),
  );
  const lastEdit = steps.findLastIndex(
    (step) => step.kind === 'call' && step.action === 'edit' && !step.running && !step.error,
  );
  const test = steps[testIndex];
  const verdict = test?.kind === 'call' && testIndex > lastEdit ? test : undefined;
  if (edited.length > 0) {
    const files = fileNames(edited, t);
    if (verdict === undefined) return t('改了 {files}', { files });
    return t(verdict.error ? '改了 {files}，测试未通过' : '改了 {files}，测试通过', { files });
  }
  if (verdict !== undefined) return t(verdict.error ? '测试未通过' : '测试通过');
  const read = touchedFiles(steps, 'read');
  return read.length > 0 ? t('读了 {files}', { files: fileNames(read, t) }) : null;
}

function unrecoveredFailures(steps: readonly Exclude<WorkStep, { kind: 'say' }>[]): number {
  let failed = 0;
  for (const step of steps.toReversed()) {
    if (step.kind !== 'call') continue;
    if (!step.error) break;
    failed += 1;
  }
  return failed;
}

function currentAction(steps: readonly Exclude<WorkStep, { kind: 'say' }>[], t: TFunc): string {
  const call = steps.findLast(
    (step): step is Extract<WorkStep, { kind: 'call' }> => step.kind === 'call',
  );
  if (call === undefined) return t('正在思考');
  const target =
    call.localized === true ? t(stepTarget(call), call.localizedVars) : stepTarget(call);
  return `${t(RUNNING_VERBS[call.action])} ${target}`;
}

function stepTarget(step: Extract<WorkStep, { kind: 'call' }>): string {
  if (step.description !== undefined) return step.description;
  return (step.command ?? step.target ?? '').split('\n')[0] ?? '';
}

const MARKDOWN_LEAD = /^\s*(?:#{1,6}\s+|[-*•+]\s+(?:\[[ xX~]\]\s+)?|\d+[.)]\s+|>\s*)/;

function sayHeadline(text: string): { line: string; more: boolean } {
  const lines = text.split('\n').filter((line) => line.trim() !== '');
  const raw = lines[0] ?? '';
  const line = raw
    .replace(MARKDOWN_LEAD, '')
    .replace(/\*\*|__|`/g, '')
    .trim();
  return { line, more: lines.length > 1 || line !== raw.trim() };
}

function WorkSayRow({ text, t }: { text: string; t: TFunc }) {
  const [open, setOpen] = useState(false);
  const { line, more } = sayHeadline(text);
  if (!more)
    return (
      <div
        data-slot="work-say"
        className="px-3 py-2 text-ui leading-5 text-(--text-secondary) [overflow-wrap:anywhere]"
      >
        <ChatMarkdown text={text} />
      </div>
    );
  if (open)
    return (
      <div data-slot="work-say" data-open="" className="relative">
        <div className="py-2 pr-10 pl-3 text-ui leading-5 text-(--text-secondary) [overflow-wrap:anywhere]">
          <ChatMarkdown text={text} />
        </div>
        <IconTooltip
          label={t('收起这段话')}
          trigger={
            <Button
              variant="ghost"
              size="icon"
              aria-expanded
              className="absolute top-1.5 right-1.5 size-7"
              onClick={() => setOpen(false)}
            />
          }
        >
          <TraceChevron open />
        </IconTooltip>
      </div>
    );
  return (
    <div data-slot="work-say">
      <TraceRowButton
        aria-label={t('展开这段话')}
        expandable
        open={false}
        onClick={() => setOpen(true)}
        verb={
          <span className="font-normal text-(--text-secondary)" data-testid="work-say-line">
            {line}
          </span>
        }
        className="[&_[data-trace-verb]]:min-w-0 [&_[data-trace-verb]]:flex-1 [&_[data-trace-verb]]:truncate"
      />
    </div>
  );
}

function WorkStepRow({
  step,
  enter,
  t,
}: {
  step: Exclude<WorkStep, { kind: 'say' }>;
  enter: boolean;
  t: TFunc;
}) {
  const [open, setOpen] = useState(false);
  const [animate] = useState(enter);
  const call = step.kind === 'call' ? step : null;
  const lines = call
    ? (call.output === null
        ? t('无输出')
        : call.localized === true && call.localizedVars === undefined
          ? t(call.output)
          : call.output
      ).split('\n')
    : [];
  const changes = call?.changes;
  const changeLines = changes
    ? [
        ...changes.removed.map((text) => ({ text: `− ${text}`, kind: 'removed' })),
        ...changes.added.map((text) => ({ text: `+ ${text}`, kind: 'added' })),
      ]
    : null;
  const lineCount = changeLines?.length ?? lines.length;
  const running = call !== null ? call.running === true : step.running === true;
  const hasDetail =
    call === null
      ? step.kind === 'think' && step.text.trim() !== ''
      : (call.output !== null && call.output.trim() !== '') ||
        changeLines !== null ||
        (call.command !== undefined && call.command.trim() !== stepTarget(call).trim());
  const verb =
    call === null
      ? t(running ? '正在思考' : open ? '思考' : '思考了')
      : call.background === true
        ? t('后台')
        : t(running ? RUNNING_VERBS[call.action] : DONE_VERBS[call.action]);
  const preview = step.kind === 'think' ? step.text.trim().split('\n')[0] : undefined;
  return (
    <div
      className={
        animate
          ? 'work-enter animate-[card-enter_180ms_cubic-bezier(0.23,1,0.32,1)_both]'
          : undefined
      }
    >
      <TraceRowButton
        data-testid={call === null ? 'work-think' : 'work-call'}
        aria-label={call === null ? t(open ? '收起思考' : '展开思考') : undefined}
        running={running}
        expandable={hasDetail}
        open={open}
        {...(hasDetail ? { onClick: () => setOpen((value) => !value) } : {})}
        verb={verb}
        target={
          call === null ? (
            <span
              className={`work-preview font-normal text-(--text-tertiary)${open ? ' invisible' : ''}`}
            >
              {preview}
            </span>
          ) : call.localized === true ? (
            t(stepTarget(call), call.localizedVars)
          ) : (
            stepTarget(call)
          )
        }
        mono={
          call !== null &&
          call.description === undefined &&
          (call.command !== undefined || call.action === 'edit' || call.action === 'read')
        }
        trailing={
          <>
            {call?.diff !== undefined && (
              <span className="flex gap-1 font-mono text-code">
                <span className="text-(--diff-add-fg)">+{call.diff.added}</span>
                <span className="text-destructive">−{call.diff.removed}</span>
              </span>
            )}
            {call?.error === true && <TraceFailTag>{t('失败')}</TraceFailTag>}
            {call?.cancelled === true && !running && (
              <span className="text-caption" data-testid="work-cancelled">
                {t('已取消')}
              </span>
            )}
            {call?.unfinished === true && !running && call.cancelled !== true && (
              <CircleDashed
                className="size-4"
                data-testid="work-unfinished"
                aria-label={t('未完成')}
              />
            )}
            {running && (
              <span
                role="img"
                className="live-pulse size-1.5 rounded-full bg-(--text-tertiary)"
                data-testid="work-spinner"
                aria-label={t('执行中')}
              />
            )}
          </>
        }
      />
      <TraceCollapse open={open}>
        {call === null ? (
          <div className="px-3 pb-3">
            <div
              className="border-l-2 border-(--border) py-0.5 pl-3 text-ui whitespace-pre-wrap text-(--text-secondary) [overflow-wrap:anywhere]"
              data-testid="thinking-body"
            >
              {step.kind === 'think' ? step.text.trim() : ''}
            </div>
          </div>
        ) : (
          <div className="px-3 pb-3">
            <TraceCommandBox
              className="work-code-header"
              prompt={call.command !== undefined}
              command={call.command ?? call.target ?? call.label}
            />
            <TraceOutput
              data-testid="tool-output"
              className={call.error && changeLines === null ? 'text-destructive' : undefined}
            >
              {call.error && changeLines !== null && call.output !== null && (
                <span className="block text-destructive" data-testid="edit-error">
                  {call.output}
                </span>
              )}
              {changeLines !== null
                ? changeLines.slice(0, 40).map((line, index) => (
                    <span
                      className={`block ${line.kind === 'added' ? 'text-(--diff-add-fg)' : 'text-destructive'}`}
                      key={`${index}:${line.text}`}
                    >
                      {line.text}
                    </span>
                  ))
                : lines.slice(0, 40).join('\n')}
              {lineCount > 40 && (
                <span className="block text-(--text-tertiary)">
                  {t('还有 {n} 行', { n: lineCount - 40 })}
                </span>
              )}
            </TraceOutput>
          </div>
        )}
      </TraceCollapse>
    </div>
  );
}

export function WorkTrace({
  item,
  defaultExpanded,
  entering,
  t,
}: {
  item: Extract<TranscriptItem, { kind: 'work' }>;
  defaultExpanded: boolean;
  entering: Set<string>;
  t: TFunc;
}) {
  const [disclosure, setDisclosure] = useState<{ defaultExpanded: boolean; open: boolean } | null>(
    null,
  );
  const [showsEarlier, setShowsEarlier] = useState(false);
  const expanded =
    disclosure?.defaultExpanded === defaultExpanded ? disclosure.open : defaultExpanded;
  const traceSteps = item.steps.filter(
    (step): step is Exclude<WorkStep, { kind: 'say' }> => step.kind !== 'say',
  );
  const earlier = earlierStepCount(traceSteps.length);
  const firstShown = showsEarlier || earlier === 0 ? undefined : traceSteps[earlier];
  const shown = item.steps.slice(firstShown === undefined ? 0 : item.steps.indexOf(firstShown));
  const counts = { ...EMPTY_TRACE_COUNTS };
  const readPaths = new Set<string>();
  const editPaths = new Set<string>();
  let running = item.running === true;
  for (const step of item.steps) {
    if (step.kind === 'say') continue;
    if (step.kind === 'think') {
      counts.think += 1;
      if (step.running === true) running = true;
    } else {
      if (step.action === 'read') readPaths.add((step.target ?? '').replace(/ L\d.*$/, ''));
      else if (step.action === 'edit') editPaths.add(step.target ?? '');
      else if (step.action === 'setup') counts.setup = 1;
      else counts[step.action] += 1;
      if (step.running) running = true;
    }
  }
  counts.read = readPaths.size;
  counts.edit = editPaths.size;
  counts.failed = unrecoveredFailures(traceSteps);
  const { text, failed } = traceSummary(t, counts, running);
  const purposes = running ? [] : workPurposes(item.steps, running, t);
  const result = running ? null : workResult(item.steps, t);
  const current = running ? currentAction(traceSteps, t) : null;
  const detail = purposes.length > 0 ? `${purposes.join(t('，'))} · ${text}` : text;
  const liveSeconds = useLiveSeconds(running ? (item.startedAt ?? null) : null);
  return (
    <div className="my-2 min-w-0" data-testid="work-block">
      <div className="flex items-center gap-1">
        <TraceGroupSummary
          data-testid="work-summary"
          summary={
            current !== null
              ? current
              : result === null
                ? text
                : result.split(FILE_NAME).map((part, index) =>
                    index % 2 === 1 ? (
                      <span key={`${index}-${part}`} className="font-mono text-code">
                        {part}
                      </span>
                    ) : (
                      part
                    ),
                  )
          }
          summaryTitle={[current, detail, failed]
            .filter((part): part is string => part !== null && part !== '')
            .join(' · ')}
          failed={failed}
          elapsed={running ? liveMeta(formatLiveElapsed(liveSeconds), item.outputTokens, t) : ''}
          open={expanded}
          running={running}
          onClick={() => setDisclosure({ defaultExpanded, open: !expanded })}
        />
      </div>
      <TraceCollapse open={expanded}>
        <TraceCard>
          {earlier > 0 && (
            <div>
              <TraceRowButton
                data-testid="work-earlier"
                verb={t(showsEarlier ? '收起之前的 {n} 步' : '之前的 {n} 步', { n: earlier })}
                expandable
                open={showsEarlier}
                onClick={() => setShowsEarlier((value) => !value)}
              />
            </div>
          )}
          {shown.map((step) =>
            step.kind === 'say' ? (
              <WorkSayRow key={step.id} text={step.text} t={t} />
            ) : (
              <WorkStepRow key={step.id} step={step} enter={entering.has(step.id)} t={t} />
            ),
          )}
        </TraceCard>
      </TraceCollapse>
    </div>
  );
}
