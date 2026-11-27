import { expect, test } from 'vitest';
import { turnErrorCopy } from '../src/api/mappers.js';

test('a disk-full runner failure is explained as a machine problem with a retry', () => {
  expect(
    turnErrorCopy(
      {
        message:
          'Runner error: ENOSPC: no space left on device, open \'/Users/runner/.cairn/outbox/step-example.json\'',
      },
      false,
    ),
  ).toMatchObject({
    kind: 'disk',
    title: '执行机磁盘已满',
    why: 'Cairn 无法写入本轮记录。请在这台执行机上腾出磁盘空间后重试。',
    actions: ['retry'],
  });
});

test('a non-runner disk-full failure uses source-neutral copy', () => {
  expect(
    turnErrorCopy(
      {
        message: 'Coordinator turn ended: model_error "ENOSPC: no space left on device"',
      },
      false,
    ),
  ).toMatchObject({
    kind: 'disk',
    title: '磁盘空间不足',
    why: '运行环境磁盘空间不足，无法继续写入。清理对应设备空间后再重试。',
    actions: ['retry'],
  });
});
