# #1256 合并硬阻闸——测试实物（2026-10-13 16:30 本地复跑）

命令（apps/server 工作区）：

    pnpm vitest run test/chief-dispatch.test.ts test/mcp-face.test.ts

输出尾：

    Test Files  2 passed (2)
          Tests  19 passed (19)
       Start at  16:30:55
       Duration  2.13s

覆盖：chief relay 面 merge_builds 硬阻（拒绝文案指认人工出口）/ MCP face 同闸 /
既有派工与读工具面不回退。集成栈 m4b-watch-wake 的 CI 超时另在诊断（疑似 flake，
与本闸单测面独立）。
