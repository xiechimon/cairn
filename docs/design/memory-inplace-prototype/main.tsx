import { MEMORY_QUOTA_PER_TEAM } from '../../../packages/shared/src/records/memory.js';
import { cn } from 'cn';
import { diffLines, diffWordsWithSpace } from 'diff';
import { type ReactNode, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { IconTooltip } from '../../../apps/web/src/components/icon-tooltip.js';
import { SegmentedTabs } from '../../../apps/web/src/components/segmented.js';
import { Button } from '../../../apps/web/src/components/ui/button.js';
import { DialogShell } from '../../../apps/web/src/components/ui/dialog-shell.js';
import { Textarea } from '../../../apps/web/src/components/ui/textarea.js';
import { TooltipProvider } from '../../../apps/web/src/components/ui/tooltip.js';
import { I18nProvider, useI18n } from '../../../apps/web/src/i18n/provider.js';
import { ArrowUp, ChevronLeft } from '../../../apps/web/src/icons/index.js';
import '../../../apps/web/src/styles/fonts.css';
import '../../../apps/web/src/styles/motion.css';
import '../../../apps/web/src/styles/app.css';

const params = new URLSearchParams(location.search);
const scenario = params.get('state') ?? 'input';
document.documentElement.classList.toggle('light', params.get('theme') !== 'dark');

type Layer = 'core' | 'searchable';
interface Memory {
  title: string;
  content: string;
  scope: string | null;
  layer: Layer;
  updated: string;
}
type Op =
  | { kind: 'update'; title: string; scope: string | null; before: string; after: string }
  | { kind: 'create'; title: string; scope: string | null; after: string }
  | { kind: 'delete'; title: string; scope: string | null; before: string };

const TEAM = null;
const VERIFY = '推送代码前先跑受影响的测试，不在本地跑全量 e2e。\n- 单测用 vitest 的 --changed 模式\n- 全量套件交给 CI';
const VERIFY_AFTER = '推送代码前先跑受影响的测试，不在本地跑全量 e2e。\n- 单测用 vitest 的 --changed 模式\n- 界面改动再跑受影响的 e2e\n- 全量套件交给 CI';
const API_VERSION = '新增字段只加不改，旧客户端至少兼容两个版本。\n- 删除字段前先发弃用通知\n- 版本号写在响应头里';
const FRIDAY = '周五不发布到生产环境，紧急修复除外。\n- 紧急修复要在任务里写明原因';
const base: Memory[] = [
  { title: '验证命令', content: VERIFY, scope: TEAM, layer: 'core', updated: '11月8日' },
  { title: '评审交接', content: '交给评审前，在任务里写清验收证据和没覆盖到的部分。\n- 附改前改后截图', scope: TEAM, layer: 'core', updated: '11月6日' },
  { title: '无障碍检查', content: '请求评审前检查键盘导航、焦点顺序和对比度。', scope: 'Field Notes', layer: 'core', updated: '11月7日' },
  { title: '发布交接', content: '交付完成的工作前，在任务里记录验收证据和部署版本。', scope: 'Field Notes', layer: 'searchable', updated: '11月2日' },
  { title: '接口版本', content: API_VERSION, scope: 'Harbor API', layer: 'core', updated: '10月30日' },
];
const applied: Memory[] = [
  { ...base[0]!, content: VERIFY_AFTER, updated: '刚刚' },
  { title: '周五不发布', content: FRIDAY, scope: TEAM, layer: 'core', updated: '刚刚' },
  ...base.slice(1, 4),
];
const INSTRUCTION = '验证命令里补一句：界面改动也要跑受影响的 e2e。Harbor API 的接口版本那条过时了，删掉。再记一条：周五不发布。';
const DETAIL_INSTRUCTION = '加一句：界面改动也要跑受影响的 e2e';
const ops: Op[] = [
  { kind: 'update', title: '验证命令', scope: TEAM, before: VERIFY, after: VERIFY_AFTER },
  { kind: 'delete', title: '接口版本', scope: 'Harbor API', before: API_VERSION },
  { kind: 'create', title: '周五不发布', scope: TEAM, after: FRIDAY },
];

const TABS = [
  { value: 'routing', label: '模型与机器' },
  { value: 'charter', label: '章程' },
  { value: 'memory', label: '记忆' },
  { value: 'watches', label: '关注与提醒' },
] as const;

const ROW_GRID_CLS = 'grid w-full items-baseline grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-0.5 sm:grid-cols-[11rem_minmax(0,1fr)_auto]';
const SEND_BTN_CLS = 'size-7 max-sm:size-11 flex-none cursor-pointer rounded-(--radius-control) border-0 bg-secondary text-(--text-tertiary) hover:bg-secondary hover:text-(--text-tertiary) dark:hover:bg-secondary';
const SEND_ON_CLS = 'bg-(--card-button) text-(--text-on-accent) hover:bg-(--card-button)/90 hover:text-(--text-on-accent) dark:hover:bg-(--card-button)/90 dark:hover:text-(--text-on-accent)';
const STOP_CLS = 'bg-transparent text-foreground hover:bg-(--menu-hover) hover:text-foreground dark:hover:bg-(--menu-hover)';
const CARD_CLS = 'relative z-1 flex max-h-[45dvh] min-h-0 flex-col overflow-hidden rounded-t-(--radius-composer) bg-card shadow-(--shadow-composer-cap)';
const COMPOSER_ATTACHED_CLS = 'shadow-(--shadow-composer-attached) focus-within:shadow-(--shadow-composer-attached-focus)';
const COMPOSER_FREE_CLS = 'rounded-t-(--radius-composer) shadow-(--shadow-composer) focus-within:shadow-(--shadow-composer-focus)';
const ACTION_CLS = 'min-h-8 max-sm:min-h-11';
const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });

const summaryOf = (memory: Memory) => memory.content.split('\n')[0] ?? '';

function groupsOf(rows: Memory[]) {
  const scopes = [TEAM, ...new Set(rows.map((row) => row.scope).filter((scope) => scope !== TEAM))];
  return scopes.map((scope) => ({ scope, rows: rows.filter((row) => row.scope === scope) })).filter((group) => group.rows.length > 0);
}

interface DiffPart {
  value: string;
  added?: boolean;
  removed?: boolean;
}

function lineThenWordDiff(before: string, after: string): DiffPart[] {
  const lines = diffLines(before, after);
  const out: DiffPart[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const part = lines[index]!;
    const next = lines[index + 1];
    if (part.removed && next?.added) {
      out.push(...diffWordsWithSpace(part.value, next.value, { intlSegmenter: segmenter }));
      index += 1;
    } else out.push(part);
  }
  return out;
}

function WordDiff({ before, after }: { before: string; after: string }) {
  const parts = lineThenWordDiff(before, after);
  return (
    <p data-slot="memory-diff" className="text-ui break-words whitespace-pre-wrap text-foreground">
      {parts.map((part, index) =>
        part.removed ? (
          <del key={index} className="rounded-(--cds-radius-xs) bg-(--diff-del-word-bg) text-foreground line-through">{part.value}</del>
        ) : part.added ? (
          <ins key={index} className="rounded-(--cds-radius-xs) bg-(--diff-add-word-bg) no-underline">{part.value}</ins>
        ) : (
          <span key={index}>{part.value}</span>
        ),
      )}
    </p>
  );
}

function OpBlock({ op, stale }: { op: Op; stale?: boolean }) {
  const { t } = useI18n();
  const tag = op.kind === 'update' ? t('修改') : op.kind === 'create' ? t('新增') : t('删除');
  return (
    <li data-slot="memory-op" className="border-t border-border px-3.5 py-3 first:border-t-0">
      <p className="mb-1 flex items-baseline gap-2 text-ui">
        <span className="flex-none text-meta text-content-tertiary">{tag}</span>
        <span className="min-w-0 truncate font-medium text-foreground">{op.title}</span>
        <span className="flex-none text-meta text-content-tertiary">{op.scope ?? t('团队')}</span>
        {stale && <span className="ml-auto flex-none text-meta text-destructive">{t('确认前已被改过')}</span>}
      </p>
      {op.kind === 'update' && <WordDiff before={op.before} after={op.after} />}
      {op.kind === 'create' && <WordDiff before="" after={op.after} />}
      {op.kind === 'delete' && <WordDiff before={op.before} after="" />}
    </li>
  );
}

function Echo({ text }: { text: string }) {
  const { t } = useI18n();
  return (
    <p className="px-3.5 pt-3 text-meta text-content-tertiary">
      {t('你：')}
      <span className="text-content-secondary">{text}</span>
    </p>
  );
}

function Composer({ placeholder, draft, setDraft, disabled, attached, working, onSend, onStop }: {
  placeholder: string;
  draft: string;
  setDraft: (value: string) => void;
  disabled?: boolean;
  attached: boolean;
  working?: boolean;
  onSend: () => void;
  onStop?: () => void;
}) {
  const { t } = useI18n();
  return (
    <form
      className={cn('flex items-end gap-2 rounded-b-(--radius-composer) bg-card py-2 pr-2 pl-3.5', attached ? COMPOSER_ATTACHED_CLS : COMPOSER_FREE_CLS)}
      onSubmit={(event) => { event.preventDefault(); onSend(); }}
    >
      <Textarea
        rows={1}
        aria-label={placeholder}
        placeholder={placeholder}
        disabled={disabled}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        className="max-h-30 min-h-0 resize-none rounded-none border-0 bg-transparent px-0.5 py-1 text-ui shadow-none placeholder:text-content-tertiary focus-visible:ring-0 disabled:bg-transparent md:text-ui dark:bg-transparent dark:disabled:bg-transparent"
      />
      {working && draft === '' ? (
        <Button type="button" variant="ghost" size="icon" aria-label={t('停止 Coordinator 这次修改')} className={cn(SEND_BTN_CLS, STOP_CLS)} onClick={onStop}>
          <span className="size-2.25 rounded-(--cds-radius-xs) bg-current" />
        </Button>
      ) : (
        <Button type="submit" variant="ghost" size="icon" aria-label={t('发送')} disabled={disabled} className={cn(SEND_BTN_CLS, draft !== '' && SEND_ON_CLS)}>
          <ArrowUp width={16} height={16} />
        </Button>
      )}
    </form>
  );
}

function EditCard({ state, onApply, onDiscard, onUndo, onRetry }: { state: string; onApply: () => void; onDiscard: () => void; onUndo: () => void; onRetry: () => void }) {
  const { t } = useI18n();
  const detail = state.startsWith('detail');
  const instruction = detail ? DETAIL_INSTRUCTION : INSTRUCTION;
  const shownOps = detail ? ops.slice(0, 1) : ops;
  let body: ReactNode = null;
  if (state === 'working') {
    body = (
      <>
        <Echo text={instruction} />
        <p role="status" className="px-3.5 pt-1 pb-3 text-ui text-content-secondary">
          {t('Coordinator 正在看记忆 · {time}', { time: '0:04' })}
        </p>
      </>
    );
  } else if (state === 'clarify') {
    body = (
      <>
        <Echo text={t('把发布交接改成要写部署版本')} />
        <p className="px-3.5 pt-1 pb-3 text-ui text-foreground">
          {t('“发布交接”只有 Field Notes 的一条，它已经写了部署版本。你是想把它提升到团队，还是改别的内容？')}
        </p>
      </>
    );
  } else if (state === 'proposed' || state === 'detail-proposed' || state === 'error-conflict') {
    const conflict = state === 'error-conflict';
    body = (
      <>
        <Echo text={instruction} />
        <div className="flex items-baseline gap-2 px-3.5 pt-1 pb-2">
          <p className="text-ui font-medium text-foreground">{t('建议修改 {n} 处', { n: shownOps.length })}</p>
          <p className="text-meta text-content-tertiary">{t('应用前记忆不会变')}</p>
        </div>
        {conflict && (
          <p role="alert" className="px-3.5 pb-2 text-ui text-destructive">
            {t('“验证命令”在你确认前被改过，没有应用任何修改。')}
          </p>
        )}
        <ul tabIndex={0} aria-label={t('建议的修改')} className="min-h-0 overflow-y-auto border-y border-border">
          {shownOps.map((op, index) => <OpBlock key={op.title} op={op} stale={conflict && index === 0} />)}
        </ul>
        <div className="flex flex-wrap items-center justify-end gap-2 px-3.5 py-2.5">
          <Button variant="ghost" className={ACTION_CLS} onClick={onDiscard}>{t('放弃')}</Button>
          {conflict ? (
            <Button className={ACTION_CLS} onClick={onRetry}>{t('按最新内容重新生成')}</Button>
          ) : (
            <Button className={ACTION_CLS} onClick={onApply}>{t('应用修改')}</Button>
          )}
        </div>
      </>
    );
  } else if (state === 'applied' || state === 'undone' || state === 'error-run') {
    const line = state === 'applied' ? t('已修改 {n} 条记忆。', { n: ops.length }) : state === 'undone' ? t('已撤销，记忆恢复到修改前。') : t('Coordinator 这次没有给出修改，记忆没有变。');
    body = (
      <div className="flex items-center gap-3 px-3.5 py-2.5">
        <p role={state === 'error-run' ? 'alert' : 'status'} tabIndex={-1} data-slot="memory-edit-status" className="min-w-0 flex-1 text-ui text-foreground outline-none">{line}</p>
        {state === 'applied' && <Button variant="outline" className={ACTION_CLS} onClick={onUndo}>{t('撤销')}</Button>}
        {state === 'error-run' && <Button variant="outline" className={ACTION_CLS} onClick={onRetry}>{t('重试')}</Button>}
      </div>
    );
  }
  if (body === null) return null;
  return (
    <section aria-label={t('记忆修改')} data-testid="memory-edit-card" className={CARD_CLS}>
      {body}
    </section>
  );
}

function Prototype() {
  const { t } = useI18n();
  const [state, setState] = useState(scenario);
  const detailOpen = state.startsWith('detail');
  const offline = state === 'offline';
  const rows = state === 'applied' ? applied : base;
  const [draft, setDraft] = useState(state === 'input' ? INSTRUCTION : state === 'detail-input' ? DETAIL_INSTRUCTION : '');
  const detailBody = useRef<HTMLDListElement>(null);
  const cardShown = !['input', 'offline', 'detail-input'].includes(state);
  const placeholder = state === 'clarify' ? t('回复 Coordinator…') : state === 'proposed' ? t('继续补充或纠正…') : t('告诉 Coordinator 要改什么');
  const card = (cardState: string) => (
    <EditCard
      state={cardState}
      onApply={() => setState('applied')}
      onDiscard={() => setState('input')}
      onUndo={() => setState('undone')}
      onRetry={() => setState('working')}
    />
  );
  const verify = rows[0]!;
  return (
    <div className="flex h-dvh min-w-0 flex-col bg-background text-foreground">
      <header className="flex h-14 flex-none items-center gap-3 border-b border-border px-6 whitespace-nowrap">
        <IconTooltip label={t('返回')} side="bottom" trigger={<Button data-chrome="product-header" variant="ghost" size="icon" className="-mr-1 -ml-2 size-7 flex-none cursor-pointer text-content-tertiary" />}>
          <ChevronLeft width={16} height={16} />
        </IconTooltip>
        <h1 className="min-w-0 truncate voice-title text-page text-foreground">{t('Coordinator 设置')}</h1>
      </header>
      <main className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4">
        <div className="mx-auto w-192 max-w-full pt-4 pb-6">
          <SegmentedTabs slide value="memory" onChange={() => undefined} options={TABS.map((tab) => ({ value: tab.value, label: t(tab.label) }))} />
          <p className="mt-4 text-meta text-content-tertiary">
            {t('已存 {n} 条，上限 {max} 条 · 不是每条都会自动注入', { n: rows.length, max: MEMORY_QUOTA_PER_TEAM })}
          </p>
          <div className="mt-2">
            {groupsOf(rows).map((group) => (
              <section key={group.scope ?? 'team'} aria-labelledby={`group-${group.scope ?? 'team'}`}>
                <h2 id={`group-${group.scope ?? 'team'}`} className="flex items-baseline gap-2 px-3 pt-4 pb-1 text-meta font-medium text-content-secondary">
                  {group.scope ?? t('团队')}
                  {group.scope !== TEAM && <span className="font-normal text-content-tertiary">{t('项目')}</span>}
                </h2>
                <ul className="border-t border-border">
                  {group.rows.map((row) => (
                    <li key={row.title} className="border-b border-border">
                      <Button
                        variant="ghost"
                        aria-label={t('打开记忆：{title}', { title: row.title })}
                        className="h-auto min-h-11 w-full justify-start rounded-none border-0 px-3 py-2.5 text-left text-ui font-normal whitespace-normal transition-none"
                        onClick={() => setState('detail-input')}
                      >
                        <span className={ROW_GRID_CLS}>
                          <span className="col-start-1 row-start-1 flex min-w-0 items-baseline gap-2">
                            <span className="truncate text-foreground">{row.title}</span>
                            {row.layer !== 'core' && <span className="flex-none text-meta text-content-tertiary">{t('可检索')}</span>}
                          </span>
                          <span className="col-span-2 row-start-2 truncate text-content-secondary sm:col-span-1 sm:col-start-2 sm:row-start-1">{summaryOf(row)}</span>
                          <span className="col-start-2 row-start-1 text-meta whitespace-nowrap text-content-tertiary sm:col-start-3">
                            {row.updated === '刚刚' ? t('刚刚更新') : t('更新于 {date}', { date: row.updated })}
                          </span>
                        </span>
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>
      </main>
      <footer className="flex-none px-4 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto w-192 max-w-full">
          {offline && <p className="mb-2 text-meta text-content-secondary">{t('离线中。重新连接后才能让 Coordinator 修改。')}</p>}
          {cardShown && !detailOpen && card(state)}
          <Composer
            placeholder={placeholder}
            draft={detailOpen ? '' : draft}
            setDraft={setDraft}
            disabled={offline}
            attached={cardShown && !detailOpen}
            working={state === 'working'}
            onSend={() => setState('working')}
            onStop={() => setState('input')}
          />
          <p className="mt-2 text-center text-meta text-content-tertiary">{t('设计样例 · 虚构数据 · 未连接产品')}</p>
        </div>
      </footer>
      <DialogShell
        className="max-sm:[&_[aria-label=关闭]]:size-11 [&_[data-testid=dialog-foot]>div:last-child]:ml-0 [&_[data-testid=dialog-foot]>div:last-child]:min-w-0 [&_[data-testid=dialog-foot]>div:last-child]:flex-1"
        open={detailOpen}
        title={verify.title}
        subtitle={`${t('团队')} · ${t('核心')}`}
        onClose={() => setState('input')}
        initialFocus={detailBody}
        footer={
          <div className="w-full min-w-0 flex-1 basis-full">
            {state === 'detail-proposed' && card(state)}
            <Composer
              placeholder={state === 'detail-proposed' ? t('继续补充或纠正…') : t('告诉 Coordinator 这条要怎么改')}
              draft={state === 'detail-input' ? draft : ''}
              setDraft={setDraft}
              attached={state === 'detail-proposed'}
              onSend={() => setState('detail-proposed')}
            />
          </div>
        }
      >
        <dl ref={detailBody} tabIndex={-1} className="space-y-4 outline-none">
          <div>
            <dt className="text-meta text-content-tertiary">{t('更新于')}</dt>
            <dd className="mt-0.5 text-ui">{verify.updated}</dd>
          </div>
          <div>
            <dt className="text-meta text-content-tertiary">{t('摘要')}</dt>
            <dd className="mt-0.5 text-ui break-words">{summaryOf(verify)}</dd>
          </div>
          <div>
            <dt className="text-meta text-content-tertiary">{t('详情')}</dt>
            <dd className="mt-1">
              <ul className="list-disc space-y-1 pl-5 text-ui break-words marker:text-content-tertiary">
                {verify.content.split('\n').slice(1).map((line) => <li key={line}>{line.replace(/^- /, '')}</li>)}
              </ul>
            </dd>
          </div>
        </dl>
      </DialogShell>
    </div>
  );
}

const root = document.getElementById('root');
if (root === null) throw new Error('Prototype root missing');
createRoot(root).render(<I18nProvider initialLocale="zh"><TooltipProvider><Prototype /></TooltipProvider></I18nProvider>);
