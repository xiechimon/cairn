// 缝实现的宿主可见错误面（无引擎依赖——runner 等宿主模块可安全 import，
// 不触 @earendil-works/* 缝纪律）。

/** continueSession 解析失败（会话文件未落盘，或会话在另一台机器）。
 * runner 捕获后降级 new session（#1286 recover；#1312 执行面同样降级，
 * 卡片注记区分「本机找不到」与「在另一台机器」）。journal 没有可重发
 * prompt 的 recover 仍显式失败。其它错误不进本类，执行面照旧失败。 */
export class SessionNotResumableError extends Error {
  constructor(sessionId: string) {
    super(`session ${sessionId} not found on this machine (continue session impossible)`);
    this.name = 'SessionNotResumableError';
  }
}
