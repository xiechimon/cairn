import { describe, expect, test } from 'vitest';
import {
  type AskUserQuestion,
  isUnsafeRecommendationOption,
  stripUnsafeRecommendations,
} from '../src/records/message.js';

describe('stripUnsafeRecommendations', () => {
  test('strips recommended from outward email/message, delete, pay, and publish options in English and Chinese', () => {
    const questions: AskUserQuestion[] = [
      {
        header: 'Email approval',
        question: 'Approve sending this email to customer@example.com?',
        options: [
          { label: 'Approve send', description: 'Send immediately', recommended: true },
          { label: 'Save draft only', description: 'Do not send yet' },
        ],
      },
      {
        header: '发邮件确认',
        question: '确认发出这封邮件吗？',
        options: [{ label: '批准发送邮件', recommended: true }, { label: '先别发' }],
      },
      {
        header: 'Cleanup',
        question: 'Remove old production records?',
        options: [{ label: 'Delete all records', recommended: true }, { label: 'Keep for now' }],
      },
      {
        header: '付款',
        question: '确认支付订阅费用？',
        options: [{ label: '确认付款', recommended: true }, { label: '取消' }],
      },
    ];

    const sanitized = stripUnsafeRecommendations(questions);
    for (const q of sanitized) {
      expect(q.options[0]?.recommended).toBeUndefined();
      expect(q.options.some((opt) => opt.recommended === true)).toBe(false);
    }
  });

  test('strips recommended when the question asks whether to approve sending/publishing even with brief affirmative labels', () => {
    const questions: AskUserQuestion[] = [
      {
        header: 'Confirm send',
        question: 'Should I send this email to Alice now?',
        options: [{ label: 'Yes, proceed', recommended: true }, { label: 'Hold off' }],
      },
    ];
    const [sanitized] = stripUnsafeRecommendations(questions);
    expect(sanitized?.options[0]?.recommended).toBeUndefined();
  });

  test('preserves recommended on safe, internal, or reversible choices', () => {
    const questions: AskUserQuestion[] = [
      {
        header: 'Layout',
        question: 'Which table width rule should we use?',
        options: [
          { label: 'Option A: size to content', recommended: true },
          { label: 'Option B: fixed columns' },
        ],
      },
      {
        header: '格式',
        question: '导出什么格式？',
        options: [{ label: 'CSV' }, { label: 'JSON', recommended: true }],
      },
      {
        header: '执行机',
        question: '当前执行机不可用，如何处理？',
        options: [{ label: '换执行机', recommended: true }, { label: '取消' }],
      },
      {
        header: 'Storage',
        question: 'Which store should local drafts use?',
        options: [
          {
            label: 'Use SQLite',
            description: 'Local only, no external push needed',
            recommended: true,
          },
          {
            label: 'Tailwind v4',
            description: 'Drop legacy CSS utilities',
            recommended: true,
          },
        ],
      },
      {
        header: 'Outbox',
        question: 'Send this email to lena@example.com?',
        options: [
          { label: 'Do not send email', recommended: true },
          { label: 'Cancel email send', recommended: true },
          { label: '不发送邮件，只存草稿', recommended: true },
        ],
      },
    ];
    const sanitized = stripUnsafeRecommendations(questions);
    expect(sanitized[0]?.options[0]?.recommended).toBe(true);
    expect(sanitized[1]?.options[1]?.recommended).toBe(true);
    expect(sanitized[2]?.options[0]?.recommended).toBe(true);
    expect(sanitized[3]?.options[0]?.recommended).toBe(true);
    expect(sanitized[3]?.options[1]?.recommended).toBe(true);
    expect(sanitized[4]?.options[0]?.recommended).toBe(true);
    expect(sanitized[4]?.options[1]?.recommended).toBe(true);
    expect(sanitized[4]?.options[2]?.recommended).toBe(true);
    expect(
      isUnsafeRecommendationOption(
        { label: 'Do not send email' },
        { header: 'Outbox', question: 'Send email?' },
      ),
    ).toBe(false);
    expect(
      isUnsafeRecommendationOption(
        { label: 'Save local draft' },
        { header: 'Draft', question: 'Save locally?' },
      ),
    ).toBe(false);
    expect(
      isUnsafeRecommendationOption(
        { label: '换执行机' },
        { header: '执行机', question: '选择执行机' },
      ),
    ).toBe(false);
    expect(
      isUnsafeRecommendationOption({ label: '批准执行' }, { header: '审批', question: '运行命令' }),
    ).toBe(true);
  });

  test('strips recommended for credentials, installs, messaging, and mixed defer-plus-unsafe labels', () => {
    const questions: AskUserQuestion[] = [
      {
        header: 'Packages',
        question: 'Install curl on the machine?',
        options: [{ label: 'Install packages', recommended: true }, { label: 'Skip' }],
      },
      {
        header: 'API Key',
        question: 'Use production API key?',
        options: [{ label: 'Yes, proceed', recommended: true }, { label: 'No' }],
      },
      {
        header: 'Cleanup',
        question: 'How should old logs be handled?',
        options: [
          { label: 'Keep latest and delete old data', recommended: true },
          { label: 'Keep everything' },
        ],
      },
      {
        header: 'Timing',
        question: 'When should we notify the customer?',
        options: [
          { label: 'Wait 5s and send', recommended: true },
          { label: '保留草稿并发送', recommended: true },
          { label: 'Approve send (not now)', recommended: true },
          { label: "Don't delete, but send email", recommended: true },
          { label: 'Skip draft and send now', recommended: true },
          { label: '不发邮件但删除草稿', recommended: true },
          { label: '不发送邮件，只存草稿' },
        ],
      },
    ];
    const sanitized = stripUnsafeRecommendations(questions);
    for (const q of sanitized) {
      expect(q.options.some((opt) => opt.recommended === true)).toBe(false);
    }
  });
});
