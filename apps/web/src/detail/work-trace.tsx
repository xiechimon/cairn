import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  FileText,
  LoaderCircle,
  Pencil,
  Plug,
  Search,
  Sparkles,
  SquareTerminal,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { Button } from '../components/ui/button.js';
import type { TranscriptItem, WorkStep } from '../fixtures/records.js';
import type { TFunc } from '../i18n/translate.js';

const ACTION_LABELS = { read: '读取', search: '搜索', run: '运行', edit: '修改', tool: '调用' };

const ACTION_ICONS = {
  read: FileText,
  search: Search,
  run: SquareTerminal,
  edit: Pencil,
  tool: Plug,
};

export function formatWorkDuration(seconds: number | null): string {
  if (seconds === null) return '';
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const rounded = Math.round(seconds);
  return `${Math.floor(rounded / 60)}m ${rounded % 60}s`;
}

function WorkStepRow({ step, enter, t }: { step: WorkStep; enter: boolean; t: TFunc }) {
  const [open, setOpen] = useState(false);
  const [animate] = useState(enter);
  const Icon = step.kind === 'think' ? Sparkles : ACTION_ICONS[step.action];
  const lines = step.kind === 'call' ? (step.output ?? t('无输出')).split('\n') : [];
  const changes = step.kind === 'call' ? step.changes : undefined;
  const changeLines = changes
    ? [
        ...changes.removed.map((text) => ({ text: `− ${text}`, kind: 'removed' })),
        ...changes.added.map((text) => ({ text: `+ ${text}`, kind: 'added' })),
      ]
    : null;
  const lineCount = changeLines?.length ?? lines.length;
  return (
    <div
      className={
        animate
          ? 'work-enter animate-[card-enter_180ms_cubic-bezier(0.23,1,0.32,1)_both]'
          : undefined
      }
    >
      <Button
        variant="ghost"
        className="flex h-7 min-h-7 w-full min-w-0 cursor-pointer justify-start gap-2 rounded-md border-0 bg-transparent px-1.5 text-left text-ui leading-5 font-normal text-(--text-secondary) hover:bg-(--secondary) hover:text-(--text-secondary) aria-expanded:bg-transparent aria-expanded:text-(--text-secondary) dark:hover:bg-(--secondary) [&_svg]:size-3.5 [&_svg]:flex-none [&_svg]:text-(--text-tertiary) [&_strong]:flex-none [&_strong]:font-semibold [&_strong]:text-(--foreground)"
        data-testid={step.kind === 'think' ? 'work-think' : 'work-call'}
        aria-expanded={open}
        aria-label={step.kind === 'think' ? t(open ? '收起思考' : '展开思考') : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon aria-hidden="true" />
        <strong>{t(step.kind === 'think' ? '思考' : ACTION_LABELS[step.action])}</strong>
        {step.kind === 'think' ? (
          <span
            className={`work-preview min-w-0 flex-1 truncate italic text-(--text-tertiary)${open ? ' invisible' : ''}`}
          >
            {step.text.trim().split('\n')[0]}
          </span>
        ) : (
          <>
            <span
              className={
                step.description !== undefined
                  ? 'min-w-0 flex-1 truncate'
                  : 'min-w-0 flex-1 truncate font-mono text-meta'
              }
            >
              {step.description ?? step.target}
            </span>
            {step.command !== undefined && (
              <span className="max-w-[45%] flex-[0_1_auto] truncate font-mono text-caption text-(--text-tertiary)">
                {step.command.split('\n')[0]}
              </span>
            )}
            {step.diff !== undefined && (
              <span className="flex flex-none gap-1 font-mono text-caption">
                <span className="text-(--diff-add-fg)">+{step.diff.added}</span>
                <span className="text-destructive">−{step.diff.removed}</span>
              </span>
            )}
          </>
        )}
        <span className="flex-none text-meta tabular-nums text-(--text-tertiary)">
          {formatWorkDuration(step.seconds)}
        </span>
        {step.kind === 'call' &&
          (step.running ? (
            <LoaderCircle
              className="animate-spin"
              data-testid="work-spinner"
              aria-label={t('执行中')}
            />
          ) : step.error ? (
            <X className="!text-destructive" aria-label={t('失败')} />
          ) : (
            <Check className="!text-(--diff-add-fg)" aria-label={t('已完成')} />
          ))}
      </Button>
      {open &&
        (step.kind === 'think' ? (
          <div
            className="mt-0.5 mb-1.5 ml-5 border-l-2 border-(--border) py-0.5 pl-3 text-ui whitespace-pre-wrap text-(--text-secondary) [overflow-wrap:anywhere]"
            data-testid="thinking-body"
          >
            {step.text.trim()}
          </div>
        ) : (
          <div className="mt-1 mb-2 ml-6 overflow-hidden rounded-lg border border-(--border) bg-(--muted) font-mono">
            <div className="work-code-header border-b border-(--border) px-2.5 py-1.5 text-caption whitespace-pre-wrap [overflow-wrap:anywhere]">
              {step.command !== undefined ? `$ ${step.command}` : (step.target ?? step.label)}
            </div>
            <pre
              className="m-0 max-h-60 overflow-auto px-2.5 py-2 text-left font-mono text-caption leading-5 whitespace-pre-wrap text-(--foreground) [overflow-wrap:anywhere]"
              data-testid="tool-output"
            >
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
            </pre>
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
  const counts = { think: 0, read: 0, search: 0, run: 0, edit: 0, tool: 0 };
  let seconds: number | null = null;
  const readPaths = new Set<string>();
  const editPaths = new Set<string>();
  for (const step of item.steps) {
    if (step.kind === 'call' && step.action === 'read')
      readPaths.add((step.target ?? '').replace(/ L\d.*$/, ''));
    else if (step.kind === 'call' && step.action === 'edit') editPaths.add(step.target ?? '');
    else counts[step.kind === 'think' ? 'think' : step.action] += 1;
    if (step.seconds !== null) seconds = (seconds ?? 0) + step.seconds;
  }
  const summary = [
    counts.think > 0 ? t('思考 {n} 次', { n: counts.think }) : null,
    readPaths.size > 0 ? t('读了 {n} 个文件', { n: readPaths.size }) : null,
    counts.search > 0 ? t('搜索 {n} 次', { n: counts.search }) : null,
    counts.run > 0 ? t('跑了 {n} 条命令', { n: counts.run }) : null,
    editPaths.size > 0 ? t('改了 {n} 个文件', { n: editPaths.size }) : null,
    counts.tool > 0 ? t('调用 {n} 个工具', { n: counts.tool }) : null,
  ]
    .filter((part) => part !== null)
    .join(t('，'));
  return (
    <div className="my-1 min-w-0 pl-8 text-(--text-secondary)" data-testid="work-block">
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          className="flex h-7 min-h-7 w-full min-w-0 cursor-pointer justify-start gap-2 rounded-md border-0 bg-transparent px-1.5 text-left text-ui leading-5 font-normal text-(--text-secondary) hover:bg-(--secondary) hover:text-(--text-secondary) aria-expanded:bg-transparent aria-expanded:text-(--text-secondary) dark:hover:bg-(--secondary) [&_svg]:size-3.5 [&_svg]:flex-none [&_svg]:text-(--text-tertiary) [&_strong]:flex-none [&_strong]:font-semibold [&_strong]:text-(--foreground) h-auto flex-1"
          data-testid="work-summary"
          aria-expanded={expanded}
          onClick={() => setDisclosure({ defaultExpanded, open: !expanded })}
        >
          {expanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
          <span className="min-w-0 flex-1 truncate" title={summary}>
            {summary}
          </span>
          <span className="flex-none text-meta tabular-nums text-(--text-tertiary)">
            {formatWorkDuration(seconds)}
          </span>
        </Button>
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
        <div className="mt-0.5 mb-1.5 ml-1 border-l border-(--border) pl-3">
          {item.steps.map((step) => (
            <WorkStepRow key={step.id} step={step} enter={entering.has(step.id)} t={t} />
          ))}
        </div>
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
