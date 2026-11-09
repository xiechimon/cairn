import { cn } from 'cn';
import { diffLines, diffWordsWithSpace } from 'diff';
import { type ReactNode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { IconTooltip } from '../../../apps/web/src/components/icon-tooltip.js';
import { SegmentedTabs } from '../../../apps/web/src/components/segmented.js';
import { Button } from '../../../apps/web/src/components/ui/button.js';
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

interface Index {
  scope: string;
  lines: string[];
  updated: string;
}
interface MemoryFile {
  name: string;
  scope: string;
  firstLine: string;
  updated: string;
}
interface Change {
  doc: string;
  scope: string;
  before: string;
  after: string;
}

const TEAM_BEFORE = [
  '- 推送代码前先跑受影响的测试，不在本地跑全量 e2e。',
  '- 交给评审前，在任务里写清验收证据和没覆盖到的部分。',
  '- 发布流程见 [发布交接](发布交接.md)。',
];
const TEAM_AFTER = [
  '- 推送代码前先跑受影响的测试，界面改动再跑受影响的 e2e，不在本地跑全量。',
  '- 交给评审前，在任务里写清验收证据和没覆盖到的部分。',
  '- 发布流程见 [发布交接](发布交接.md)。',
  '- 周五不发布到生产环境，紧急修复除外。',
];
const FIELD_NOTES = [
  '- 请求评审前检查键盘导航、焦点顺序和对比度。',
  '- 截图统一放在任务附件里，不提交到仓库。',
];
const API_BEFORE = '新增字段只加不改，旧客户端至少兼容两个版本。\n删除字段前先发弃用通知。';
const API_AFTER = '新增字段只加不改，旧客户端至少兼容三个版本。\n删除字段前先发弃用通知。';
const filesBefore: MemoryFile[] = [
  { name: '发布交接.md', scope: '团队', firstLine: '交付完成的工作前，在任务里记录验收证据和部署版本。', updated: '11月2日' },
  { name: '接口版本.md', scope: 'Harbor API', firstLine: '新增字段只加不改，旧客户端至少兼容两个版本。', updated: '10月30日' },
  { name: '无障碍检查清单.md', scope: 'Field Notes', firstLine: 'Tab 顺序与视觉顺序一致；关闭弹窗后焦点回到触发处。', updated: '11月7日' },
];
const filesAfter: MemoryFile[] = filesBefore.map((file) =>
  file.name === '接口版本.md' ? { ...file, firstLine: '新增字段只加不改，旧客户端至少兼容三个版本。', updated: '刚刚' } : file,
);
const INSTRUCTION = '验证那条补一句：界面改动也要跑受影响的 e2e。再记一条：周五不发布。Harbor API 的接口版本改成兼容三个版本。';
const changes: Change[] = [
  { doc: 'MEMORY.md', scope: '团队', before: TEAM_BEFORE.join('\n'), after: TEAM_AFTER.join('\n') },
  { doc: '接口版本.md', scope: 'Harbor API', before: API_BEFORE, after: API_AFTER },
];

const TABS = [
  { value: 'routing', label: '模型与机器' },
  { value: 'charter', label: '章程' },
  { value: 'memory', label: '记忆' },
  { value: 'watches', label: '关注与提醒' },
] as const;

const FILE_GRID_CLS = 'grid w-full items-baseline grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-0.5 sm:grid-cols-[11rem_minmax(0,1fr)_auto]';
const SEND_BTN_CLS = 'size-7 max-sm:size-11 flex-none cursor-pointer rounded-(--radius-control) border-0 bg-secondary text-(--text-tertiary) hover:bg-secondary hover:text-(--text-tertiary) dark:hover:bg-secondary';
const SEND_ON_CLS = 'bg-(--card-button) text-(--text-on-accent) hover:bg-(--card-button)/90 hover:text-(--text-on-accent) dark:hover:bg-(--card-button)/90 dark:hover:text-(--text-on-accent)';
const STOP_CLS = 'bg-transparent text-foreground hover:bg-(--menu-hover) hover:text-foreground dark:hover:bg-(--menu-hover)';
const CARD_CLS = 'relative z-1 flex max-h-[45dvh] min-h-0 flex-col overflow-hidden rounded-t-(--radius-composer) bg-card shadow-(--shadow-composer-cap)';
const COMPOSER_ATTACHED_CLS = 'shadow-(--shadow-composer-attached) focus-within:shadow-(--shadow-composer-attached-focus)';
const COMPOSER_FREE_CLS = 'rounded-t-(--radius-composer) shadow-(--shadow-composer) focus-within:shadow-(--shadow-composer-focus)';
const SECTION_HEAD_CLS = 'mt-6 text-ui font-medium text-foreground';
const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });

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
  return (
    <p data-slot="memory-diff" className="text-ui break-words whitespace-pre-wrap text-foreground">
      {lineThenWordDiff(before, after).map((part, index) =>
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

function EditCard({ state }: { state: string }) {
  const { t } = useI18n();
  const echo = (
    <p className="px-3.5 pt-3 text-meta text-content-tertiary">
      {t('你：')}
      <span className="text-content-secondary">{INSTRUCTION}</span>
    </p>
  );
  let body: ReactNode = null;
  if (state === 'working') {
    body = (
      <>
        {echo}
        <p role="status" className="px-3.5 pt-1 pb-3 text-ui text-content-secondary">{t('Coordinator 正在改记忆 · {time}', { time: '0:04' })}</p>
      </>
    );
  } else if (state === 'applied') {
    body = (
      <>
        {echo}
        <p role="status" className="px-3.5 pt-1 pb-2 text-ui font-medium text-foreground">{t('已按你的话改了 {n} 处', { n: 3 })}</p>
        <ul tabIndex={0} aria-label={t('这次的改动')} className="min-h-0 overflow-y-auto border-t border-border">
          {changes.map((change) => (
            <li key={change.doc} data-slot="memory-change" className="border-t border-border px-3.5 py-3 first:border-t-0">
              <p className="mb-1 flex items-baseline gap-2 text-ui">
                <span className="min-w-0 truncate font-medium text-foreground">{change.doc}</span>
                <span className="flex-none text-meta text-content-tertiary">{change.scope}</span>
              </p>
              <WordDiff before={change.before} after={change.after} />
            </li>
          ))}
        </ul>
      </>
    );
  } else if (state === 'error') {
    body = (
      <p role="alert" className="px-3.5 py-3 text-ui text-foreground">{t('Coordinator 这次没有改成，记忆没有变。你的话已放回输入框，再发一次即可。')}</p>
    );
  }
  if (body === null) return null;
  return (
    <section aria-label={t('记忆修改')} data-testid="memory-edit-card" className={CARD_CLS}>
      {body}
    </section>
  );
}

function IndexBlock({ index, fresh }: { index: Index; fresh: boolean }) {
  const { t } = useI18n();
  return (
    <section aria-labelledby={`index-${index.scope}`} className="mt-3">
      <h3 id={`index-${index.scope}`} className="flex items-baseline gap-2 px-3 pb-1 text-meta font-medium text-content-secondary">
        {index.scope}
        <span className="font-normal text-content-tertiary">MEMORY.md</span>
        <span className="ml-auto font-normal text-content-tertiary">{fresh ? t('刚刚更新') : t('更新于 {date}', { date: index.updated })}</span>
      </h3>
      <ul className="border-y border-border px-3 py-2">
        {index.lines.map((line) => (
          <li key={line} className="py-1 text-ui break-words text-foreground">{line.replace(/^- /, '')}</li>
        ))}
      </ul>
    </section>
  );
}

function Prototype() {
  const { t } = useI18n();
  const state = scenario;
  const applied = state === 'applied';
  const [draft, setDraft] = useState(state === 'input' || state === 'error' ? INSTRUCTION : '');
  const files = applied ? filesAfter : filesBefore;
  const indexes: Index[] = [
    { scope: t('团队'), lines: applied ? TEAM_AFTER : TEAM_BEFORE, updated: '11月8日' },
    { scope: 'Field Notes', lines: FIELD_NOTES, updated: '11月7日' },
  ];
  const cardShown = state !== 'input';
  const working = state === 'working';
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
          <h2 className={SECTION_HEAD_CLS}>{t('每个线程都会读')}</h2>
          <p className="mt-0.5 text-meta text-content-tertiary">{t('团队的 MEMORY.md 进入每次对话和任务；项目的只在这个项目里读。')}</p>
          {indexes.map((index) => (
            <IndexBlock key={index.scope} index={index} fresh={applied && index.scope === t('团队')} />
          ))}
          <h2 className={SECTION_HEAD_CLS}>{t('记忆文件')}</h2>
          <p className="mt-0.5 text-meta text-content-tertiary">{t('Coordinator 需要时才读。')}</p>
          <ul className="mt-2 border-t border-border">
            {files.map((file) => (
              <li key={file.name} className="border-b border-border">
                <Button
                  variant="ghost"
                  aria-label={t('打开记忆文件：{name}', { name: file.name })}
                  className="h-auto min-h-11 w-full justify-start rounded-none border-0 px-3 py-2.5 text-left text-ui font-normal whitespace-normal transition-none"
                >
                  <span className={FILE_GRID_CLS}>
                    <span className="col-start-1 row-start-1 flex min-w-0 items-baseline gap-2">
                      <span className="truncate text-foreground">{file.name}</span>
                      <span className="flex-none text-meta text-content-tertiary">{file.scope}</span>
                    </span>
                    <span className="col-span-2 row-start-2 truncate text-content-secondary sm:col-span-1 sm:col-start-2 sm:row-start-1">{file.firstLine}</span>
                    <span className="col-start-2 row-start-1 text-meta whitespace-nowrap text-content-tertiary sm:col-start-3">
                      {file.updated === '刚刚' ? t('刚刚更新') : t('更新于 {date}', { date: file.updated })}
                    </span>
                  </span>
                </Button>
              </li>
            ))}
          </ul>
        </div>
      </main>
      <footer className="flex-none px-4 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto w-192 max-w-full">
          {cardShown && <EditCard state={state} />}
          <form
            className={cn('flex items-end gap-2 rounded-b-(--radius-composer) bg-card py-2 pr-2 pl-3.5', cardShown ? COMPOSER_ATTACHED_CLS : COMPOSER_FREE_CLS)}
            onSubmit={(event) => event.preventDefault()}
          >
            <Textarea
              rows={1}
              aria-label={t('告诉 Coordinator 要改什么')}
              placeholder={t('告诉 Coordinator 要改什么')}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              className="max-h-30 min-h-0 resize-none rounded-none border-0 bg-transparent px-0.5 py-1 text-ui shadow-none placeholder:text-content-tertiary focus-visible:ring-0 md:text-ui dark:bg-transparent"
            />
            {working ? (
              <Button type="button" variant="ghost" size="icon" aria-label={t('停止 Coordinator 这次修改')} className={cn(SEND_BTN_CLS, STOP_CLS)}>
                <span className="size-2.25 rounded-(--cds-radius-xs) bg-current" />
              </Button>
            ) : (
              <Button type="submit" variant="ghost" size="icon" aria-label={t('发送')} className={cn(SEND_BTN_CLS, draft !== '' && SEND_ON_CLS)}>
                <ArrowUp width={16} height={16} />
              </Button>
            )}
          </form>
          <p className="mt-2 text-center text-meta text-content-tertiary">{t('设计样例 · 虚构数据 · 未连接产品')}</p>
        </div>
      </footer>
    </div>
  );
}

const root = document.getElementById('root');
if (root === null) throw new Error('Prototype root missing');
createRoot(root).render(<I18nProvider initialLocale="zh"><TooltipProvider><Prototype /></TooltipProvider></I18nProvider>);
