import type { ComputerCommand, ComputerRecord, ComputerState } from '@cairn/shared';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useAuth } from '../api/auth.js';
import { computerFeedStore, mergeComputerFeed } from '../api/computer-feed.js';
import { useComputerCommands, useComputers } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { ListCard } from '../components/list-card.js';
import { QueryBoundary } from '../components/query-state.js';
import { StatusGlyph } from '../components/status-glyph.js';
import { Badge } from '../components/ui/badge.js';
import { Button } from '../components/ui/button.js';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../components/ui/collapsible.js';
import { StatusChip, type StatusTone } from '../components/ui/status-chip.js';
import { useI18n } from '../i18n/provider.js';
import { ChevronRight, Terminal } from '../icons/index.js';
import { relativeTime } from './rel-time.js';

const STICK_PX = 24;

const STATE_LABEL: Record<ComputerState, string> = {
  stopped: '关着',
  starting: '正在开机',
  running: '开着',
  failed: '出错',
};

const TIME_TICK_MS = 30_000;

const STATUS_TONE: Record<ComputerCommand['status'], StatusTone> = {
  running: 'plan',
  done: 'done',
  error: 'failed',
  interrupted: 'confirm',
  cancelled: 'idle',
};

const STATUS_LABEL: Record<ComputerCommand['status'], string> = {
  running: '运行中',
  done: '完成',
  error: '出错',
  interrupted: '中断',
  cancelled: '已取消',
};

const TOOL_LABEL: Record<ComputerCommand['tool'], string> = {
  shell: '终端',
  user_computer_shell: '我的电脑',
  write_file: '写文件',
  attach_file: '附件',
  open_path: '打开',
  launch_app: '启动应用',
};

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TIME_TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function CommandEntry({ command, now }: { command: ComputerCommand; now: number }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [outputOpen, setOutputOpen] = useState(false);
  const output = useRef<HTMLPreElement>(null);
  const outputStuck = useRef(true);
  useLayoutEffect(() => {
    const el = output.current;
    if (el !== null && outputStuck.current) el.scrollTop = el.scrollHeight;
  }, [command.output, outputOpen]);
  return (
    <li
      data-testid="computer-command"
      data-call-id={command.callId}
      data-status={command.status}
      className="flex min-w-0 flex-col gap-1 px-3.5 py-2.5"
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="flex-none text-meta text-content-tertiary">
          {t(TOOL_LABEL[command.tool])}
        </span>
        <span
          data-testid="computer-command-time"
          title={new Date(command.at).toLocaleString()}
          className="flex-none text-meta text-content-tertiary"
        >
          {relativeTime(command.at, now, t)}
        </span>
        {command.status === 'running' ? (
          <Badge
            data-tone="plan"
            className="ml-auto flex-none gap-1 bg-secondary pl-1.5 text-content-secondary"
          >
            <StatusGlyph kind="working" className="size-3" />
            {t(STATUS_LABEL[command.status])}
          </Badge>
        ) : (
          <StatusChip tone={STATUS_TONE[command.status]} className="ml-auto flex-none">
            {t(STATUS_LABEL[command.status])}
          </StatusChip>
        )}
        {command.exitCode !== null && (
          <span
            data-testid="computer-command-exit"
            className="flex-none text-meta text-content-tertiary tabular-nums"
          >
            {t('退出码 {n}', { n: command.exitCode })}
          </span>
        )}
      </div>
      <Button
        variant="ghost"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
        className="h-auto w-full min-w-0 justify-start rounded-md p-0 text-left font-mono text-code leading-5 font-normal whitespace-normal text-foreground hover:bg-transparent dark:hover:bg-transparent"
      >
        <span
          data-testid="computer-command-text"
          className={`min-w-0 flex-1 break-all [overflow-wrap:anywhere] ${expanded ? '' : 'line-clamp-3'}`}
        >
          {command.command}
        </span>
      </Button>
      {command.output !== '' && (
        <Collapsible
          open={outputOpen}
          onOpenChange={(open) => {
            outputStuck.current = true;
            setOutputOpen(open);
          }}
          className="group/out min-w-0"
        >
          <CollapsibleTrigger className="flex cursor-pointer items-center gap-1 rounded-md text-meta text-content-tertiary outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50">
            <ChevronRight
              aria-hidden="true"
              className="size-3 transition-transform duration-(--dur-fast) group-data-open/out:rotate-90"
            />
            {t('输出')}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre
              ref={output}
              onScroll={(event) => {
                const el = event.currentTarget;
                outputStuck.current = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_PX;
              }}
              data-testid="computer-command-output"
              className="m-0 mt-1.5 max-h-48 overflow-auto rounded-lg bg-(--surface-1) px-3 py-2 font-mono text-code leading-5 whitespace-pre-wrap text-content-secondary [overflow-wrap:anywhere]"
            >
              {command.output}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      )}
    </li>
  );
}

function CommandFeed({ computerId }: { computerId: string }) {
  const { t } = useI18n();
  const { teamId } = useLiveData();
  const now = useNow();
  const history = useComputerCommands(teamId, computerId);
  const liveCommands = useSyncExternalStore(
    computerFeedStore.subscribe,
    computerFeedStore.snapshot,
  );
  const commands = useMemo(
    () =>
      mergeComputerFeed(
        history.data ?? [],
        liveCommands.filter((command) => command.computerId === computerId),
      ),
    [history.data, liveCommands, computerId],
  );
  const scroller = useRef<HTMLUListElement>(null);
  const stuck = useRef(true);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el !== null && commands.length > 0 && stuck.current) el.scrollTop = el.scrollHeight;
  }, [commands]);
  if (commands.length === 0) {
    return (
      <QueryBoundary
        query={history}
        isEmpty
        loadingLabel={t('正在加载命令记录')}
        errorTitle={t('命令记录没能加载')}
        className="px-3.5 py-3"
        empty={
          <p
            data-testid="computer-feed-empty"
            className="m-0 px-3.5 py-3 text-meta text-content-tertiary"
          >
            {t('还没有命令。Coordinator 在这台电脑上跑的命令会出现在这里。')}
          </p>
        }
      >
        {null}
      </QueryBoundary>
    );
  }
  return (
    <ul
      ref={scroller}
      data-testid="computer-feed"
      aria-label={t('命令记录')}
      onScroll={(event) => {
        const el = event.currentTarget;
        stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_PX;
      }}
      className="m-0 flex max-h-80 list-none flex-col divide-y divide-border overflow-y-auto p-0"
    >
      {commands.map((command) => (
        <CommandEntry key={command.callId} command={command} now={now} />
      ))}
    </ul>
  );
}

function ComputerHead({ computer }: { computer: ComputerRecord }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-3 px-3.5 py-3">
      <Terminal aria-hidden="true" className="size-5.5 flex-none text-content-secondary" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-ui font-medium text-foreground">
          {t('Coordinator 的电脑')}
        </span>
        <span className="truncate text-meta text-content-tertiary">{computer.machine.name}</span>
      </span>
      <Badge
        data-testid="computer-state"
        data-state={computer.machine.online ? computer.state : 'offline'}
        variant="secondary"
        className={`flex-none font-normal ${computer.machine.online ? '' : 'text-content-tertiary'}`}
      >
        {computer.machine.online ? t(STATE_LABEL[computer.state]) : t('离线')}
      </Badge>
    </div>
  );
}

function ComputerSection() {
  const { t } = useI18n();
  const { teamId } = useLiveData();
  const computers = useComputers(teamId, true);
  const computer = computers.data?.[0];
  return (
    <QueryBoundary
      query={computers}
      isEmpty={computer === undefined}
      loadingLabel={t('正在加载 Coordinator 的电脑')}
      errorTitle={t('Coordinator 的电脑没能加载')}
      skeletonRows={1}
      empty={
        <p data-testid="computer-none" className="m-0 px-1 text-meta text-content-tertiary">
          {t('Coordinator 还没有自己的电脑。第一次需要时会自动开一台。')}
        </p>
      }
    >
      {computer !== undefined && (
        <ListCard className="flex-none">
          <ComputerHead computer={computer} />
          <CommandFeed computerId={computer.id} />
        </ListCard>
      )}
    </QueryBoundary>
  );
}

export function CoordinatorComputer() {
  const { live } = useLiveData();
  const auth = useAuth();
  return live && !auth.gateOpen ? <ComputerSection /> : null;
}
