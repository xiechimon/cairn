import { ChevronDown, ChevronRight, CircleDashed, Copy } from 'lucide-react';
import { useState } from 'react';
import {
  EMPTY_TRACE_COUNTS,
  TraceCard,
  TraceCommandBox,
  TraceFailTag,
  TraceGroupSummary,
  TraceOutput,
  TraceRowButton,
  traceSummary,
} from '../components/chat/trace-parts.js';
import { Button } from '../components/ui/button.js';
import type { TranscriptItem, WorkStep } from '../fixtures/records.js';
import type { TFunc } from '../i18n/translate.js';

const DONE_VERBS = {
  read: '读取了',
  search: '搜索了',
  run: '运行了',
  edit: '修改了',
  tool: '调用了',
};
const RUNNING_VERBS = {
  read: '正在读取',
  search: '正在搜索',
  run: '正在运行',
  edit: '正在修改',
  tool: '正在调用',
};

export function formatWorkDuration(seconds: number | null): string {
  if (seconds === null) return '';
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const rounded = Math.round(seconds);
  return `${Math.floor(rounded / 60)}m ${rounded % 60}s`;
}

function stepTarget(step: Extract<WorkStep, { kind: 'call' }>): string {
  if (step.description !== undefined) return step.description;
  return (step.command ?? step.target ?? '').split('\n')[0] ?? '';
}

function WorkStepRow({ step, enter, t }: { step: WorkStep; enter: boolean; t: TFunc }) {
  const [open, setOpen] = useState(false);
  const [animate] = useState(enter);
  const call = step.kind === 'call' ? step : null;
  const lines = call ? (call.output ?? t('无输出')).split('\n') : [];
  const changes = call?.changes;
  const changeLines = changes
    ? [
        ...changes.removed.map((text) => ({ text: `− ${text}`, kind: 'removed' })),
        ...changes.added.map((text) => ({ text: `+ ${text}`, kind: 'added' })),
      ]
    : null;
  const lineCount = changeLines?.length ?? lines.length;
  const running = call?.running === true;
  const verb =
    call === null
      ? t(open ? '思考' : '思考了')
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
        expandable
        open={open}
        onClick={() => setOpen((value) => !value)}
        verb={verb}
        target={
          call === null ? (
            <span
              className={`work-preview font-normal italic text-(--text-tertiary)${open ? ' invisible' : ''}`}
            >
              {preview}
            </span>
          ) : (
            stepTarget(call)
          )
        }
        mono={call !== null && call.description === undefined && call.command !== undefined}
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
                className="size-3.5"
                data-testid="work-unfinished"
                aria-label={t('未完成')}
              />
            )}
            <span className="text-caption">{formatWorkDuration(step.seconds)}</span>
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
      {open &&
        (call === null ? (
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
            <TraceOutput data-testid="tool-output">
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
        ))}
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
  const expanded =
    disclosure?.defaultExpanded === defaultExpanded ? disclosure.open : defaultExpanded;
  const counts = { ...EMPTY_TRACE_COUNTS };
  const readPaths = new Set<string>();
  const editPaths = new Set<string>();
  let running = false;
  for (const step of item.steps) {
    if (step.kind === 'think') counts.think += 1;
    else {
      if (step.action === 'read') readPaths.add((step.target ?? '').replace(/ L\d.*$/, ''));
      else if (step.action === 'edit') editPaths.add(step.target ?? '');
      else counts[step.action] += 1;
      if (step.error) counts.failed += 1;
      if (step.running) running = true;
    }
  }
  counts.read = readPaths.size;
  counts.edit = editPaths.size;
  const { text, failed } = traceSummary(t, counts, running);
  return (
    <div className="my-2 min-w-0" data-testid="work-block">
      <div className="flex items-center gap-1">
        <TraceGroupSummary
          data-testid="work-summary"
          summary={text}
          summaryTitle={failed === null ? text : `${text} ${failed}`}
          failed={failed}
          open={expanded}
          running={running}
          onClick={() => setDisclosure({ defaultExpanded, open: !expanded })}
        />
        {expanded && (
          <Button
            variant="ghost"
            className="size-6 flex-none border-0 p-1 text-(--text-tertiary)"
            aria-label={t('复制')}
            onClick={() => {
              void navigator.clipboard.writeText(
                item.steps
                  .map((step) =>
                    step.kind === 'think'
                      ? step.text
                      : [step.label, step.target, step.command, step.output]
                          .filter(Boolean)
                          .join('\n'),
                  )
                  .join('\n'),
              );
            }}
          >
            <Copy aria-hidden="true" />
          </Button>
        )}
      </div>
      {expanded && (
        <TraceCard>
          {item.steps.map((step) => (
            <WorkStepRow key={step.id} step={step} enter={entering.has(step.id)} t={t} />
          ))}
        </TraceCard>
      )}
    </div>
  );
}

export function InjectedSkills({
  skills,
  t,
}: {
  skills: { id: string; reason: string }[];
  t: TFunc;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mx-auto mt-3.5 max-w-[68ch] text-center text-meta text-(--text-tertiary)">
      <Button
        variant="secondary"
        className="h-6 rounded-(--cds-radius-sm) px-2 text-meta font-normal"
        data-testid="injected-skills-chip"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {t('已加载 {n} 个技能', { n: skills.length })}
        {open ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
      </Button>
      {open && (
        <div
          data-testid="injected-skills"
          className="mt-1.5 flex flex-wrap justify-center gap-1.5 [overflow-wrap:anywhere]"
        >
          {skills.length > 0
            ? skills.map((skill) => (
                <span key={skill.id}>
                  {skill.id}（{skill.reason}）
                </span>
              ))
            : t('未注入技能（任务文本未命中任何技能）')}
        </div>
      )}
    </div>
  );
}
