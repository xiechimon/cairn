const EXCERPT_MAX = 28;

const LEADING_COURTESY =
  /^(?:你们好|你好|您好|在不在|在吗|在么|嗨|哈+|嘿嘿|呵呵|谢谢(?:你|您)?|多谢|谢了|感谢|辛苦(?:了|你|您)?|麻烦你了|好(?:的|滴|嘞|呀)?|行|可以|没问题|没事|嗯+|哦+|收到|明白了|知道了|okay|ok|hi|hello|hey|thanks|thank you|thx|sure|cool|nice|great|yes|no|yep|nope|right|👍|👌|🙏|😂)(?:$|[\s\p{P}\p{Emoji_Presentation}])/iu;

const INTERROGATIVE =
  /[?？]|吗|呢|什么|怎么|为什么|哪(?!怕)|谁|多少|几点|几时|如何|是否|是不是|有没有|能不能|可不可以|\bwhy\b|\bhow\b|\bwhat\b|\bwhen\b|\bwhere\b|\bwhich\b|\bwho\b|\bcould you\b|\bcan you\b|\bdo you\b|\bdoes\b|\bis there\b|\bare there\b/iu;

export type FirstFeedbackSource = 'turn' | 'steer';

export interface FirstFeedbackSpec {
  messageId: string;
  text: string;
  steered: boolean;
  publish(line: string): void;
}

export interface PendingAck {
  messageId: string;
  line: string;
  deadlineAt: number;
  admittedAt: number;
}

export interface FirstFeedbackGuard {
  arm(threadId: string, spec: FirstFeedbackSpec): void;
  settle(threadId: string, messageId?: string): void;
  noteResponse(threadId: string): void;
  settleBeforeResponse(threadId: string): void;
  pending(threadId: string): PendingAck | undefined;
  reset(): void;
}

interface PendingEntry extends PendingAck {
  cancel(): void;
  publish(line: string): void;
}

function stripPunctuation(text: string): string {
  return text.replace(/^[\s\p{P}\p{S}\p{Emoji_Presentation}]+/u, '').trim();
}

function flattened(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/```[\s\S]*?(?:```|$)/g, ' ')
    .replace(/`+/g, ' ')
    .replace(/\[[^\]]*\]\((?:attachment|https?):[^)]*\)/g, ' ')
    .replace(/[#>*_~|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function excerptOf(text: string): string {
  const flat = flattened(text);
  const points = [...flat];
  if (points.length <= EXCERPT_MAX) return flat.replace(/[\s\p{P}]+$/u, '');
  const cut = points.slice(0, EXCERPT_MAX).join('');
  const lastSpace = cut.lastIndexOf(' ');
  const boundary =
    points[EXCERPT_MAX] === ' ' || !/\s/.test(cut)
      ? cut
      : cut.slice(0, lastSpace > EXCERPT_MAX - 12 ? lastSpace : cut.length);
  return `${boundary.replace(/[\s\p{P}]+$/u, '')}…`;
}

function substantive(text: string): string {
  let rest = text.trim();
  for (;;) {
    const stripped = stripPunctuation(rest.replace(LEADING_COURTESY, ''));
    if (stripped === rest) return rest;
    rest = stripped;
  }
}

function lineIn(script: 'zh' | 'en', source: FirstFeedbackSource, excerpt: string, ask: boolean) {
  if (script === 'zh') {
    if (source === 'steer') return `收到你这条：「${excerpt}」。`;
    return ask ? `我先核对「${excerpt}」。` : `收到，我来处理「${excerpt}」。`;
  }
  if (source === 'steer') return `Got it — “${excerpt}”.`;
  return ask ? `Let me check “${excerpt}”.` : `On it — “${excerpt}”.`;
}

export function firstFeedbackLine(text: string, source: FirstFeedbackSource): string | null {
  const rest = substantive(text);
  if (rest === '') return null;
  const excerpt = excerptOf(rest);
  if (excerpt === '') return null;
  const script = /\p{Script=Han}/u.test(excerpt) ? 'zh' : 'en';
  return lineIn(script, source, excerpt, INTERROGATIVE.test(rest));
}

export const FIRST_FEEDBACK_DELAY_MS = 1_200;

function defaultSchedule(fire: () => void, ms: number): () => void {
  const timer = setTimeout(fire, ms);
  timer.unref?.();
  return () => clearTimeout(timer);
}

export function createFirstFeedbackGuard(
  options: { delayMs?: number; now?: () => number; schedule?: typeof defaultSchedule } = {},
): FirstFeedbackGuard {
  const delayMs = options.delayMs ?? FIRST_FEEDBACK_DELAY_MS;
  const clock = options.now ?? Date.now;
  const schedule = options.schedule ?? defaultSchedule;
  const entries = new Map<string, PendingEntry>();
  const requestAt = new Map<string, number>();

  const drop = (threadId: string): PendingEntry | undefined => {
    const entry = entries.get(threadId);
    if (entry === undefined) return undefined;
    entries.delete(threadId);
    entry.cancel();
    return entry;
  };

  const guard: FirstFeedbackGuard = {
    arm(threadId, spec) {
      const line = firstFeedbackLine(spec.text, spec.steered ? 'steer' : 'turn');
      if (line === null) return;
      const existing = entries.get(threadId);
      if (existing !== undefined) {
        existing.messageId = spec.messageId;
        existing.line = line;
        existing.publish = spec.publish;
        existing.admittedAt = clock();
        return;
      }
      const admittedAt = clock();
      const entry: PendingEntry = {
        messageId: spec.messageId,
        line,
        admittedAt,
        deadlineAt: admittedAt + delayMs,
        publish: spec.publish,
        cancel: () => {},
      };
      entry.cancel = schedule(() => {
        const pending = entries.get(threadId);
        if (pending !== entry) return;
        entries.delete(threadId);
        try {
          entry.publish(entry.line);
        } catch (error) {
          console.warn('first feedback publish failed', { threadId, error });
        }
      }, delayMs);
      entries.set(threadId, entry);
    },
    settle(threadId, messageId) {
      if (messageId !== undefined && entries.get(threadId)?.messageId !== messageId) return;
      drop(threadId);
    },
    noteResponse(threadId) {
      requestAt.set(threadId, clock());
    },
    settleBeforeResponse(threadId) {
      const cut = requestAt.get(threadId);
      const entry = entries.get(threadId);
      if (entry === undefined || cut === undefined || entry.admittedAt > cut) return;
      drop(threadId);
    },
    pending(threadId) {
      const entry = entries.get(threadId);
      return entry === undefined
        ? undefined
        : {
            messageId: entry.messageId,
            line: entry.line,
            deadlineAt: entry.deadlineAt,
            admittedAt: entry.admittedAt,
          };
    },
    reset() {
      for (const threadId of [...entries.keys()]) drop(threadId);
      requestAt.clear();
    },
  };
  return guard;
}

export const firstFeedback = createFirstFeedbackGuard();
