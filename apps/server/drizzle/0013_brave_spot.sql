-- spec 13 #367：skill 表退役——技能改本地目录现扫只读投影（不入库）。
-- 数据语句（非 schema diff，snapshot 不受影响；drizzle-kit 再生成不重写本文件）：
-- drop 前把 agent.skills 清为 '[]'（旧 id 随表失效，死引用不留）；旧行保底导出
-- 发生在 migrate 应用本文件**之前**（db/legacy-export.ts → <home>/legacy-export-<ts>.json，
-- SQL 面写不了 JSON 文件，导出钩子在 TS 侧）。
-- 注：本文件由 drizzle-kit 生成（0013_brave_spot，撞号重排自 lane 期 0012_eminent_santa_claus），
-- UPDATE 语句与头注为手工补回。
UPDATE `agent` SET `skills` = '[]';--> statement-breakpoint
DROP TABLE `skill`;
