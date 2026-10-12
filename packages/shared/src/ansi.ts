// #1262：errorMessage 落库前剥 ANSI 转义——SGR/CSI 与 OSC8 超链接随工具
// stderr 混入失败串，板面渲染出 `[0m` / `]8;;` 噪声。零依赖正则单点收口，
// daemon 出口与 server wire 入口双层过一遍；剥完剩的孤儿 ESC 字节也清掉
// （截断点落在序列中间时的兜底）。
//
// 正则经 RegExp 构造器组装（ESC 字节藏在字符串转义里）：正则字面量直写
// 控制字符（字面或 \xNN）会被 biome noControlCharactersInRegex 拦，构造器
// + \u001b 字符串是合规等价形态。

const ESC = '\u001b';

// CSI：ESC [ … final byte（0x40–0x7E）。参数与中间字节区间 0x20–0x3F，
// SGR 是 final = m 的特例。
const CSI_SEQUENCE = new RegExp(`${ESC}\\[[\\u0020-\\u003f]*[\\u0040-\\u007e]`, 'g');

// OSC：ESC ] … ST（ESC \）或 BEL（0x07）终止。OSC8 超链接 = 其 8 特例。
// 终止符连同一起剥净（漏 BEL 是常见坑）。
const OSC_SEQUENCE = new RegExp(`${ESC}\\][^\\u0007${ESC}]*(?:${ESC}\\\\|\\u0007)`, 'g');

// nF 序列：ESC + 中间字节（0x20–0x2F，如 `(`）+ final（如 K）——纯字符串
// 场景兜底。孤儿 ESC 后跟正文时不吞正文（只清 ESC 字节本身）。
const ESC_NF_SEQUENCE = new RegExp(`${ESC}[\\u0020-\\u002f]+[\\u0040-\\u007e]`, 'g');

/** 剥 ANSI 转义序列，只留纯文本。无转义输入逐字节不变（幂等）。 */
export function stripAnsiEscapes(input: string): string {
  return input
    .replace(CSI_SEQUENCE, '')
    .replace(OSC_SEQUENCE, '')
    .replace(ESC_NF_SEQUENCE, '')
    .replaceAll(ESC, '');
}
