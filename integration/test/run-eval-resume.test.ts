import { describe, expect, test } from 'vitest';
import { evalResumeArmKey, evalResumeDoneKey } from '../eval/chief-dispatch/resume-key.mts';

describe('eval resume keys', () => {
  test('learn rows resume with the learn arm written into meta.arm', () => {
    const written = evalResumeArmKey({ isLearn: true, learnArm: 'all' });
    const scheduled = evalResumeArmKey({ isLearn: true, learnArm: 'all' });
    expect(written).toBe('all');
    expect(scheduled).toBe(written);
    expect(evalResumeDoneKey('learn-001', 0, scheduled)).toBe(
      evalResumeDoneKey('learn-001', 0, written),
    );
  });

  test('learn resume does not collapse to an empty arm the way planArm-only keys did', () => {
    const writtenArm = evalResumeArmKey({ isLearn: true, learnArm: 'correction' });
    const brokenScheduleArm = evalResumeArmKey({ isLearn: false, planArm: undefined });
    expect(writtenArm).toBe('correction');
    expect(brokenScheduleArm).toBe('');
    expect(evalResumeDoneKey('learn-001', 0, brokenScheduleArm)).not.toBe(
      evalResumeDoneKey('learn-001', 0, writtenArm),
    );
    const fixedScheduleArm = evalResumeArmKey({ isLearn: true, learnArm: 'correction' });
    expect(evalResumeDoneKey('learn-001', 0, fixedScheduleArm)).toBe(
      evalResumeDoneKey('learn-001', 0, writtenArm),
    );
  });

  test('plan revision arms keep feedback and no-feedback distinct', () => {
    const feedback = evalResumeArmKey({ isLearn: false, planArm: 'feedback' });
    const control = evalResumeArmKey({ isLearn: false, planArm: 'no-feedback' });
    expect(feedback).toBe('feedback');
    expect(control).toBe('no-feedback');
    expect(evalResumeDoneKey('rev-001', 0, feedback)).not.toBe(
      evalResumeDoneKey('rev-001', 0, control),
    );
  });
});
