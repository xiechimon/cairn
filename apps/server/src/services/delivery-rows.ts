import { DONE_ROW } from '@cairn/shared';

export { DONE_ROW };

export const prClosedUnmergedRow = (prNumber: number) =>
  `PR #${prNumber} 已在 GitHub 关闭且未合并，多半是有人决定不要这次改动。是否重做由人决定；重启任务会新开分支与 PR。`;
