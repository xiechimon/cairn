---
类别: shared 新导出追加在文件末尾，未遵循字母排序
首次来源: #1511 (2026-10-23)
级别: 2
防护: Biome organizeExports 与从 shared 包入口导入的 trajectory-pack 测试
拦截: 1
复发: 0
备注: 真实负例为 trajectory-pack 导出排在 webhook 后；移动导出时匹配了错误的冒号，曾漏掉导出，由包入口测试拦住；改用实际文本锚点后复验
---
