import type { DesktopLocale } from './locale.js';

const COPY = {
  zh: {
    coordinator: '打开 Coordinator',
    coordinatorBusy: 'Coordinator 正在回复',
    loading: '正在读取工作区状态',
    unavailable: '暂时无法读取工作区状态',
    empty: '没有待处理的任务',
    waiting: '待你处理',
    working: '进行中',
    pressure: (percent: number, level: string) => `负载 ${percent}%（${level}）`,
    pressureLevel: { normal: '正常', high: '偏高', full: '高' },
    pressureDetail: (memory: number, cpu: number | null, disk: number) =>
      `内存压力 ${memory}%${cpu === null ? '' : `；CPU ${cpu}%`}；剩余磁盘 ${disk} GB`,
    more: (count: number) => `在 Cairn 中查看另外 ${count} 个任务`,
    running: (minutes: number) => `已运行 ${minutes} 分钟`,
    stalled: (minutes: number) => `${minutes} 分钟无进展`,
    waitingForRunner: '等待这台执行机空闲',
    quotaWait: '等待额度',
    quotaWaitUntil: (at: string) => `等待额度，${at} 重试`,
    today: (tokens: string) => `今日用量：${tokens} tokens`,
    quota: (percent: number) => `Claude 额度已用 ${percent}%`,
    quotaExhausted: 'Claude 额度已用完',
    quotaRecovers: (at: string) => `Claude 额度已用完，${at} 恢复`,
    usage: '查看用量',
    runner: '本机执行机',
    runnerStatus: {
      starting: '本机执行机：正在启动',
      stopping: '本机执行机：正在停止',
      failed: '本机执行机：异常停止',
    },
    keepAwake: '保持屏幕常亮',
    settings: '设置',
    quit: '退出 Cairn',
  },
  en: {
    coordinator: 'Open Coordinator',
    coordinatorBusy: 'Coordinator is responding',
    loading: 'Loading workspace status',
    unavailable: 'Workspace status unavailable',
    empty: 'No tasks need your attention',
    waiting: 'Needs your attention',
    working: 'In progress',
    pressure: (percent: number, level: string) => `Load ${percent}% (${level})`,
    pressureLevel: { normal: 'normal', high: 'elevated', full: 'high' },
    pressureDetail: (memory: number, cpu: number | null, disk: number) =>
      `Memory pressure ${memory}%${cpu === null ? '' : `; CPU ${cpu}%`}; ${disk} GB free`,
    more: (count: number) => `View ${count} more in Cairn`,
    running: (minutes: number) => `Running for ${minutes} min`,
    stalled: (minutes: number) => `No progress for ${minutes}m`,
    waitingForRunner: 'Waiting for this Runner to free up',
    quotaWait: 'Waiting for quota',
    quotaWaitUntil: (at: string) => `Waiting for quota, retries at ${at}`,
    today: (tokens: string) => `Tokens used today: ${tokens}`,
    quota: (percent: number) => `Claude quota ${percent}% used`,
    quotaExhausted: 'Claude quota exhausted',
    quotaRecovers: (at: string) => `Claude quota exhausted, resets at ${at}`,
    usage: 'View Usage',
    runner: 'Local Runner',
    runnerStatus: {
      starting: 'Local Runner: Starting',
      stopping: 'Local Runner: Stopping',
      failed: 'Local Runner: Stopped unexpectedly',
    },
    keepAwake: 'Keep the Screen On',
    settings: 'Settings…',
    quit: 'Quit Cairn',
  },
} as const;

export function trayCopy(locale: DesktopLocale) {
  return COPY[locale];
}
