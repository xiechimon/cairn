import { eq } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { machine } from '../src/db/schema.js';
import { bootServer, insertMachine } from './helpers.js';

test('shared machine factory seeds a complete confinement-ready capability report', () => {
  const s = bootServer();
  const id = insertMachine(s);
  const row = s.db.select().from(machine).where(eq(machine.id, id)).get();
  expect(row?.capabilities).toMatchObject({
    mcpServers: [],
    skills: [],
    confinement: {
      state: 'ready',
      invocation: expect.stringMatching(/^[0-9a-f-]{36}$/),
      generation: 1,
      revision: 1,
    },
  });
});
