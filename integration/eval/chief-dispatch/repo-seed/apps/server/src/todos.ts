// 任务列表查询。当前实现把全部行取回后在内存里过滤，任务量大时会明显变慢。
export function listTodos(db: Db, teamId: string) {
  const all = db.select().from(todoTable).all();
  return all.filter((t) => t.teamId === teamId);
}
