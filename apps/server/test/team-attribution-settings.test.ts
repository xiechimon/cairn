import { expect, test } from 'vitest';
import { readTeamAttributionSettings } from '../src/services/team-attribution-settings.js';
import { bootServer, req } from './helpers.js';

test('absent team settings use attribution defaults', () => {
  const s = bootServer();
  try {
    expect(readTeamAttributionSettings(s.db, 'absent')).toEqual({
      coAuthorTrailer: true,
      requestInstructorReview: false,
    });
  } finally {
    s.dispose();
  }
});

test('existing team defaults and persisted attribution opt-outs', async () => {
  const s = bootServer();
  try {
    const teams = await (await req(s.app, 'GET', '/api/teams')).json();
    expect(teams).toMatchObject([{ coAuthorTrailer: true, requestInstructorReview: false }]);
    const response = await req(s.app, 'PATCH', `/api/teams/${s.team.id}`, {
      coAuthorTrailer: false,
      requestInstructorReview: true,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      coAuthorTrailer: false,
      requestInstructorReview: true,
    });
    const reread = await (await req(s.app, 'GET', '/api/teams')).json();
    expect(reread).toMatchObject([{ coAuthorTrailer: false, requestInstructorReview: true }]);
  } finally {
    s.dispose();
  }
});

test.each(['coAuthorTrailer', 'requestInstructorReview'])(
  '%s rejects non-booleans',
  async (key) => {
    const s = bootServer();
    try {
      for (const value of ['false', 0, null, [], {}]) {
        const response = await req(s.app, 'PATCH', `/api/teams/${s.team.id}`, {
          autonomyPaused: false,
          [key]: value,
        });
        expect(response.status).toBe(400);
      }
    } finally {
      s.dispose();
    }
  },
);
