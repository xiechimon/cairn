import { and, eq, isNotNull, notExists, type SQL, sql } from 'drizzle-orm';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import type { Db } from '../db/client.js';
import { chiefThread, notification, project, todo } from '../db/schema.js';

export function outsideArchivedProject(db: Db, projectId: AnySQLiteColumn | SQL): SQL {
  return notExists(
    db
      .select({ one: sql`1` })
      .from(project)
      .where(and(eq(project.id, projectId), isNotNull(project.archivedAt))),
  );
}

export function activeNotificationProject(db: Db): SQL | undefined {
  return and(
    outsideArchivedProject(
      db,
      sql`coalesce(
      (select ${todo.projectId} from ${todo} where ${todo.id} = ${notification.entityId}),
      json_extract(${notification.entityRef}, '$.projectId')
    )`,
    ),
    outsideArchivedProject(
      db,
      sql`(
      select ${chiefThread.projectId} from ${chiefThread} where ${chiefThread.id} = ${notification.entityId}
    )`,
    ),
  );
}

export function canDeliverNotification(db: Db, id: string): boolean {
  return (
    db
      .select({ id: notification.id })
      .from(notification)
      .where(and(eq(notification.id, id), activeNotificationProject(db)))
      .get() !== undefined
  );
}
