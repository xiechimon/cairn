export interface RouteSkillRef {
  id: string;
  name: string;
  description: string | null;
}

export type SkillRouteRuleId = 'reminder' | 'explicit-mention';

export interface SkillRouteHint {
  ruleId: SkillRouteRuleId;
  skills: RouteSkillRef[];
  toolHint: string | null;
}

function normalizeForMatch(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}]/gu, '');
}

const WAKE_PREFIX_RE = /^\[wake:\w+\]/;

const TIME_EXPR_RE =
  /明早|明天|今晚|今早|后天|大后天|下周|下月|下个月|周[一二三四五六日天]|星期[一二三四五六日天]|每天|每周|每月|\d+点|\d+:\d+|早上|中午|下午|晚上|凌晨|半夜|分钟后|小时后|天后|准时|按时|定时/;

const REMINDER_VERB_RE = /提醒|闹钟|叫我|喊我|通知我|别忘|勿忘|记得|记住|到时|届时|remind|alarm/;

const REMINDER_SKILL_KEYWORDS = [
  '提醒',
  '定时',
  '闹钟',
  '日程',
  'remind',
  'schedul',
  'wake',
  'alarm',
];

const REMINDER_TOOL_HINT = 'set_wake（到点回头核实汇报）/ schedule_todo（定时重跑任务）';

function matchReminderSkills(installed: RouteSkillRef[]): RouteSkillRef[] {
  return installed
    .filter((s) => {
      const hay = normalizeForMatch(`${s.id} ${s.name} ${s.description ?? ''}`);
      return REMINDER_SKILL_KEYWORDS.some((k) => hay.includes(k));
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

function matchExplicitMention(normText: string, installed: RouteSkillRef[]): RouteSkillRef[] {
  const out: RouteSkillRef[] = [];
  for (const s of installed) {
    const keys = [normalizeForMatch(s.id), normalizeForMatch(s.name)];
    if (keys.some((k) => k.length >= 2 && normText.includes(k))) out.push(s);
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export function suggestSkillsForMessage(
  text: string,
  installed: RouteSkillRef[],
): SkillRouteHint | null {
  if (WAKE_PREFIX_RE.test(text)) return null;
  const norm = normalizeForMatch(text);
  if (norm === '') return null;
  const mentioned = matchExplicitMention(norm, installed);
  if (mentioned.length > 0) {
    return { ruleId: 'explicit-mention', skills: mentioned, toolHint: null };
  }
  if (TIME_EXPR_RE.test(norm) && REMINDER_VERB_RE.test(norm)) {
    return {
      ruleId: 'reminder',
      skills: matchReminderSkills(installed),
      toolHint: REMINDER_TOOL_HINT,
    };
  }
  return null;
}

const RULE_LABEL: Record<SkillRouteRuleId, string> = {
  reminder: '提醒意图（时间表达 + 提醒动词）',
  'explicit-mention': '显式点名已装技能',
};

const SKILL_ROUTE_HEADING = '## 技能路由提示（发送后自动检测，仅建议——先核对再用）';

export function stripSkillRouteSection(text: string): string {
  const at = text.indexOf(`\n\n${SKILL_ROUTE_HEADING}`);
  return at === -1 ? text : text.slice(0, at);
}

export function formatSkillRouteSection(hint: SkillRouteHint): string {
  const lines = [
    SKILL_ROUTE_HEADING,
    `用户消息命中「${RULE_LABEL[hint.ruleId]}」。以下候选仅供参考：`,
  ];
  for (const s of hint.skills) {
    lines.push(
      `- 技能 ${s.id}${s.description ? ` — ${s.description}` : ''}（用 skills 工具核对详情；切合才用，不切合直接忽略）`,
    );
  }
  if (hint.toolHint !== null) {
    lines.push(`- 内置能力：${hint.toolHint}（无切合技能时走此路；同样先确认用户真想要定时动作）`);
  }
  lines.push('普通对话直接忽略本节，绝不强行调用技能。');
  return lines.join('\n');
}
