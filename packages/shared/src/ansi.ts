// ANSI 转义剥离（#1262）：工具输出（biome 等）带 SGR 颜色码 + OSC8 超链接
// 转义，daemon 捕获侧原样落 build.errorMessage，板面几百行转义垃圾。本函数
// 是剥离单源：daemon 落 errorMessage 前调用（写入侧），web 失败行/运行历史
// 渲染时调用（显示侧兜底，存量脏数据不迁移也 readable）。Multica 对照
// （sanitizeCLIOutput，server/pkg/agent/codearts.go:801）同域不同形：其
// OSC 分支 `[^\x07]*` 贪婪吞到最近的终止符，会把 OSC8 开/闭对之间的可见
// 标签（规则名）一起吃掉——本实现的 OSC 内容类排除 ESC，停在 ST 前，标签
// 保留（板面验收「首行即文件名:行号:规则」要求规则名在场）。

/**
 * CSI（含 SGR 颜色码、光标控制等）+ OSC（含 OSC8 超链接开/闭对、窗口标题）。
 * CSI：`ESC [` + 参数字节 `[0-?]*` + 中间字节 `[ -/]*` + 终止字节 `[@-~]`。
 * OSC：`ESC ]` + 内容（不含 BEL/ESC——保证停在 ST 的 ESC 前，不吞可见标签）
 *   + 终止（BEL `\x07` 或 ST `ESC \`）。
 */
const ANSI_ESCAPE_RE =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: 剥离器的本体就是控制字符——ESC/BEL 是 CSI/OSC 序列的定义字符，无可替代写法。
  /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

/** 剥 ANSI 转义（SGR + OSC8 等 CSI/OSC 全类），只留纯文本。幂等；无转义输入
 * 原样返回（含不构成 CSI/OSC 的孤立 ESC——剥离器不修复，只剥已知类）。 */
export function stripAnsiEscapes(text: string): string {
  return text.replace(ANSI_ESCAPE_RE, '');
}
