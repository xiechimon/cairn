import {
  CONNECTION_FAILURE_RE,
  isDiskFullFailure,
  isUnansweredFetch,
  RUNTIME_UPDATE_REQUIRED_RE,
} from '../task-failure.js';

export const TURN_ERROR_KINDS = [
  'no-model',
  'interrupted',
  'turn-limit',
  'runtime-update',
  'connect',
  'key',
  'context',
  'model',
  'quota',
  'busy',
  'timeout',
  'provider',
  'disk',
  'unknown',
] as const;
export type TurnErrorKind = (typeof TURN_ERROR_KINDS)[number];

const RULES: readonly [TurnErrorKind, Pick<RegExp, 'test'>][] = [
  ['disk', { test: isDiskFullFailure }],
  ['no-model', /\bno_model\b|no keyed provider|has no model or chief context/i],
  [
    'interrupted',
    /\b(interrupted|restart_limit|faulted|orphaned|(?<!connection[ _])reset)\b|journal lost|server restarted|stream disconnected|executor lost/i,
  ],
  ['turn-limit', /\bturn_limit\b/i],
  ['runtime-update', RUNTIME_UPDATE_REQUIRED_RE],
  ['connect', new RegExp(`NECP|${CONNECTION_FAILURE_RE.source}`, 'i')],
  ['key', /\b401\b|(invalid|incorrect).{0,20}api key|unauthorized|authentication_error/i],
  [
    'context',
    /context.length|context_length_exceeded|maximum context|prompt is too long|too many tokens/i,
  ],
  ['model', /\b404\b|model_not_found|\b403\b|not available in your region|does not exist/i],
  ['quota', /insufficient_quota|insufficient.balance|quota|billing|余额|额度/i],
  ['busy', /\b(429|503|529)\b|overloaded|no available accounts|rate.limit/i],
  ['timeout', /timed out|timeout|ETIMEDOUT/i],
  ['connect', { test: isUnansweredFetch }],
  ['provider', /\bmodel_error\b|\b[45]\d\d\b/],
];

export function turnErrorKind(message: string): TurnErrorKind {
  for (const [kind, re] of RULES) if (re.test(message)) return kind;
  return 'unknown';
}
