// 缝实现的宿主可见错误面（无引擎依赖——runner 等宿主模块可安全 import，
// 不触 @earendil-works/* 缝纪律）。

/** continueSession 解析失败（会话文件未落盘/异机）。双面语义（#1286）：
 * recover 面（journal 持久了 prompt）由 runner 捕获后降级 new session 重发；
 * 执行面直传 = 步可见 failed（#1260 语义）。调用方按自身所处面决定。 */
export class SessionNotResumableError extends Error {
  constructor(sessionId: string) {
    super(`session ${sessionId} not found on this machine (continue session impossible)`);
    this.name = 'SessionNotResumableError';
  }
}
