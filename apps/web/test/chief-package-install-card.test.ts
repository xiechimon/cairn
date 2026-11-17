import {
  INSTALL_PACKAGES_TOOL,
  PACKAGES_DECLINED,
  PACKAGES_INSTALLED_PREFIX,
  PACKAGES_NOT_ANSWERED,
} from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { type MessageRow, mapChiefStream } from '../src/api/mappers.js';

const NOW = 1_758_000_000_000;

function installCall(id: string, finished?: { text: string; isError?: boolean }): MessageRow {
  return {
    id,
    role: 'assistant',
    content: {
      kind: 'toolcall',
      call: {
        id: `c-${id}`,
        name: INSTALL_PACKAGES_TOOL,
        arguments: { packages: ['ffmpeg', 'libpq-dev'] },
        startedAt: NOW,
        ...(finished !== undefined
          ? {
              endedAt: NOW + 60_000,
              result: [{ type: 'text', text: finished.text }],
              ...(finished.isError !== undefined ? { isError: finished.isError } : {}),
            }
          : {}),
      },
    },
    createdAt: NOW,
  } as MessageRow;
}

const cards = (rows: MessageRow[]) =>
  mapChiefStream(rows).filter((entry) => entry.kind === 'package-install');

describe('install_packages in the Coordinator conversation', () => {
  test('a running request is a waiting card naming the packages', () => {
    expect(cards([installCall('m1')])).toEqual([
      {
        kind: 'package-install',
        id: 'm1',
        packages: ['ffmpeg', 'libpq-dev'],
        outcome: 'waiting',
      },
    ]);
  });

  test.each([
    [`${PACKAGES_INSTALLED_PREFIX} ffmpeg libpq-dev.\nSetting up ffmpeg`, 'installed'],
    [PACKAGES_DECLINED, 'declined'],
    [PACKAGES_NOT_ANSWERED, 'not-answered'],
    ['computer error: apt-get exited with 100: E: Unable to locate package (the action may have partially run)', 'failed'],
  ])('a finished request reads %#', (text, outcome) => {
    expect(cards([installCall('m1', { text })])[0]).toMatchObject({ outcome });
  });

  test('an errored call is never shown as installed', () => {
    expect(
      cards([installCall('m1', { text: `${PACKAGES_INSTALLED_PREFIX} ffmpeg.`, isError: true })])[0],
    ).toMatchObject({ outcome: 'failed' });
  });

  test('the request is a card, not a tool pill', () => {
    expect(JSON.stringify(mapChiefStream([installCall('m1')]))).not.toContain(
      INSTALL_PACKAGES_TOOL,
    );
  });
});
