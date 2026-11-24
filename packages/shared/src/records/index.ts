import type { z } from 'zod';
import { apiKeyRecordSchema } from './api-key.js';
import { buildRecordSchema } from './build.js';
import { chiefRecordSchema, chiefThreadSchema } from './chief.js';
import { githubLabelRecordSchema } from './github-label.js';
import { machineRecordSchema } from './machine.js';
import { memoryRecordSchema } from './memory.js';
import { messageRecordSchema } from './message.js';
import { notificationRecordSchema } from './notification.js';
import { planRecordSchema } from './plan.js';
import { projectRecordSchema } from './project.js';
import { providerRecordSchema } from './provider.js';
import { scheduleRecordSchema } from './schedule.js';
import { secretRecordSchema } from './secret.js';
import { stepRecordSchema } from './step.js';
import { teamRecordSchema } from './team.js';
import { todoRecordSchema } from './todo.js';
import { tokenUsageSchema } from './token-usage.js';
import { userRecordSchema } from './user.js';

export * from '../failure-review.js';
export * from './agent.js';
export * from './api-key.js';
export * from './artifact.js';
export * from './backup-status.js';
export * from './build.js';
export * from './capabilities.js';
export * from './chat-block.js';
export * from './chat-chart.js';
export * from './chief.js';
export * from './claude-login.js';
export * from './claude-rate-limit.js';
export * from './common.js';
export * from './composio.js';
export * from './daily-usage.js';
export * from './deploy-status.js';
export * from './design.js';
export * from './diff-glance.js';
export * from './document-diff.js';
export * from './github.js';
export * from './github-label.js';
export * from './machine.js';
export * from './machine-capabilities.js';
export * from './mcp-connector.js';
export * from './mcp-server.js';
export * from './memory.js';
export * from './merge-gate.js';
export * from './message.js';
export * from './model-source.js';
export * from './needs-you.js';
export * from './notification.js';
export * from './plan.js';
export * from './project.js';
export * from './prompts.js';
export * from './provider.js';
export * from './provider-model-input.js';
export * from './provider-preset-data.js';
export * from './provider-presets.js';
export * from './push.js';
export * from './quick-replies.js';
export * from './recording-trigger.js';
export * from './report.js';
export * from './research-prompts.js';
export * from './review.js';
export * from './routing-rule.js';
export * from './schedule.js';
export * from './secret.js';
export * from './skill.js';
export * from './step.js';
export * from './system-row.js';
export * from './task-request.js';
export * from './tasks.js';
export * from './team.js';
export * from './terminal-claims.js';
export * from './thread-pr.js';
export * from './ticket-dedupe.js';
export * from './todo.js';
export * from './token-usage.js';
export * from './top-models.js';
export * from './turn-error.js';
export * from './user.js';
export * from './verify.js';
export * from './work-policy.js';
export * from './worker-brief-text.js';

export const RECORD_SCHEMAS = {
  user: userRecordSchema,
  team: teamRecordSchema,
  project: projectRecordSchema,
  todo: todoRecordSchema,
  github_label: githubLabelRecordSchema,
  build: buildRecordSchema,
  step: stepRecordSchema,
  message: messageRecordSchema,
  plan: planRecordSchema,
  schedule: scheduleRecordSchema,
  notification: notificationRecordSchema,
  agent_memory: memoryRecordSchema,
  provider: providerRecordSchema,
  secret: secretRecordSchema,
  api_key: apiKeyRecordSchema,
  machine: machineRecordSchema,
  token_usage: tokenUsageSchema,
  chief: chiefRecordSchema,
  chief_thread: chiefThreadSchema,
  chief_message: messageRecordSchema,
} as const satisfies Record<string, z.ZodType>;

export type RecordTableName = keyof typeof RECORD_SCHEMAS;
