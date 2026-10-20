// Chief 域 utility 配方单源（#950 per-face 清零：chief.css 退役，皮肤全部
// 改挂 token utility）。跨文件共用的配方住这里单源（RES/parts.tsx 同律）；
// 单文件私有的就地内联。

/** 24px 头像槽（XMON-105 律单源，旧 .chief-avatar / .chief-avatar--img
 *  等值）：glyph 形只出墨色与不伸缩；img 形图即 24 圆盘（SeededAvatar Root
 *  定尺盒——几何由 Root 的 className 与 wrapper 的 [&_img] 同值承载，
 *  #1003）。 */
export const AVATAR_SLOT_CLS = 'flex-none text-(--text-tertiary)';
export const AVATAR_IMG_CLS =
  'flex-none text-(--text-tertiary) [&_img]:block [&_img]:size-6 [&_img]:rounded-full';
