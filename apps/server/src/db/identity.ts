import type { Db } from './client.js';

const identities = new WeakMap<Db, Db>();

export function databaseIdentity(db: Db): Db {
  return identities.get(db) ?? db;
}

export function registerDatabaseIdentity(alias: Db, source: Db): void {
  identities.set(alias, databaseIdentity(source));
}
