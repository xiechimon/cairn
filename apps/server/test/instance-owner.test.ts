import { afterEach, expect, test } from 'vitest';
import { user } from '../src/db/schema.js';
import { isOwner } from '../src/services/instance-owner.js';
import { bootServer, type TestServer } from './helpers.js';

let server: TestServer | undefined;
afterEach(() => server?.dispose());

test('instance ownership remains the first inserted user, not lexical order', () => {
  server = bootServer();
  server.db.insert(user).values({ id: 'a-member', displayName: 'Member' }).run();
  expect(isOwner(server.db, server.user.id)).toBe(true);
  expect(isOwner(server.db, 'a-member')).toBe(false);
  expect(isOwner(server.db, 'missing')).toBe(false);
  server.db.delete(user).run();
  expect(isOwner(server.db, server.user.id)).toBe(false);
});
