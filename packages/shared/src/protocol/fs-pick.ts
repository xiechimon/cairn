export const FS_PICK_ERROR_REASONS = ['unavailable', 'busy'] as const;
export type FsPickErrorReason = (typeof FS_PICK_ERROR_REASONS)[number];

export type FsPickResult = { path: string | null };

export const FS_PICK_ERROR_COPY: Record<FsPickErrorReason, string> = {
  unavailable: '此部署形态不支持系统对话框，请直接输入路径',
  busy: '已有一个选取对话框在进行中',
};
