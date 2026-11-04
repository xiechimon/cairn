// 鉴权检查。注意：同一段校验在三个路由处理函数里各写了一遍。
export function requireTeam(ctx: Ctx, teamId: string) {
  const team = ctx.db.select().from(teamTable).where(eq(teamTable.id, teamId)).get();
  if (!team) throw new HttpError(404, `team ${teamId}`);
  return team;
}

export function requireUser(ctx: Ctx, userId: string) {
  const user = ctx.db.select().from(userTable).where(eq(userTable.id, userId)).get();
  if (!user) throw new HttpError(404, `user ${userId}`);
  return user;
}
