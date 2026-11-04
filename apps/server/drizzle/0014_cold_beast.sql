-- spec 13 #368：mcp_server 表退役——MCP 面改本机 ~/.claude.json 只读投影
-- （server 读本机供 UI、daemon 读本机供执行），登记制撤除。
-- 数据语句（非 schema diff，snapshot 不受影响；drizzle-kit 再生成不重写本文件）：
-- drop 前把 agent.mcpServers 清为 '[]'（旧值 = mcp_server 表 slug，随登记制失效，
-- 死引用不留；用户按本地 config 源重新勾选）。旧行保底导出发生在 migrate 应用
-- 本文件**之前**（db/legacy-export.ts → <legacyExportDir>/legacy-export-<ts>.json，
-- SQL 面写不了 JSON 文件，导出钩子在 TS 侧）。
-- 注：本文件由 drizzle-kit 生成（0014_cold_beast，撞号重排自 lane 期
-- 0012_mcp-local-config），UPDATE 语句与头注为手工补回。
UPDATE `agent` SET `mcpServers` = '[]';--> statement-breakpoint
DROP TABLE `mcp_server`;