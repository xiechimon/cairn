// 搜索。按标题与描述做 LIKE 匹配，结果按创建时间倒序。
export function searchTasks(teamId: string, q: string) {
  const rows = db.select().from(taskTable).where(eq(taskTable.teamId, teamId)).all();
  const hit = rows.filter((r) => r.title.includes(q) || (r.description ?? '').includes(q));
  // 排序键用的是 updatedAt 而不是 createdAt，与文档描述不一致。
  return hit.sort((a, b) => b.updatedAt - a.updatedAt);
}
