import { z } from 'zod';
import {
  type ArtifactAnchor,
  artifactAnchorSchema,
  artifactKindSchema,
  describeAnchor,
} from './artifact.js';

export const DESIGN_LIMITS = {
  noteChars: 2000,
  textChars: 160,
  htmlHintChars: 180,
  selectorChars: 1000,
  labelChars: 80,
  elementIdChars: 200,
  styleValueChars: 120,
  commentsPerSend: 50,
  markBytes: 5 * 1024 * 1024,
} as const;

export const DESIGN_VIEWPORTS = ['desktop', 'tablet', 'mobile'] as const;
export const designViewportSchema = z.enum(DESIGN_VIEWPORTS);
export type DesignViewport = z.infer<typeof designViewportSchema>;

export const designVersionSourceSchema = z.enum(['agent', 'restore', 'user']);
export type DesignVersionSource = z.infer<typeof designVersionSourceSchema>;

export const designCommentStatusSchema = z.enum(['open', 'sent', 'resolved']);
export type DesignCommentStatus = z.infer<typeof designCommentStatusSchema>;

export const designRectSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().min(0),
  height: z.number().finite().min(0),
});
export type DesignRect = z.infer<typeof designRectSchema>;

export const DESIGN_STYLE_KEYS = [
  'color',
  'backgroundColor',
  'fontSize',
  'fontWeight',
  'fontFamily',
  'lineHeight',
] as const;
export const designStyleSchema = z
  .object(
    Object.fromEntries(
      DESIGN_STYLE_KEYS.map((key) => [
        key,
        z.string().max(DESIGN_LIMITS.styleValueChars).optional(),
      ]),
    ) as Record<(typeof DESIGN_STYLE_KEYS)[number], z.ZodOptional<z.ZodString>>,
  )
  .strict();
export type DesignStyle = z.infer<typeof designStyleSchema>;

export const designTargetSchema = z.object({
  elementId: z.string().max(DESIGN_LIMITS.elementIdChars),
  selector: z.string().max(DESIGN_LIMITS.selectorChars),
  label: z.string().max(DESIGN_LIMITS.labelChars),
  text: z.string().max(DESIGN_LIMITS.textChars),
  htmlHint: z.string().max(DESIGN_LIMITS.htmlHintChars),
  position: designRectSchema,
  style: designStyleSchema.nullable(),
});
export type DesignTarget = z.infer<typeof designTargetSchema>;

export const designVersionRecordSchema = z.object({
  id: z.string(),
  todoId: z.string(),
  fileName: z.string(),
  seq: z.number().int().min(1),
  attachmentId: z.string(),
  sizeBytes: z.number().int().min(0),
  source: designVersionSourceSchema,
  restoredFromSeq: z.number().int().min(1).nullable(),
  createdAt: z.number().int(),
});
export type DesignVersionRecord = z.infer<typeof designVersionRecordSchema>;

export const designPageRecordSchema = z.object({
  fileName: z.string(),
  kind: artifactKindSchema,
  current: designVersionRecordSchema,
  versionCount: z.number().int().min(1),
  openComments: z.number().int().min(0),
  shareToken: z.string().nullable(),
});
export type DesignPageRecord = z.infer<typeof designPageRecordSchema>;

export const designCommentRecordSchema = designTargetSchema.extend({
  id: z.string(),
  todoId: z.string(),
  fileName: z.string(),
  versionId: z.string(),
  versionSeq: z.number().int().min(1),
  pin: z.number().int().min(1),
  viewport: designViewportSchema,
  note: z.string(),
  markAttachmentId: z.string().nullable(),
  status: designCommentStatusSchema,
  messageId: z.string().nullable(),
  anchor: artifactAnchorSchema.nullable(),
  sentAt: z.number().int().nullable(),
  handledSeq: z.number().int().min(1).nullable(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type DesignCommentRecord = z.infer<typeof designCommentRecordSchema>;

const designCommentTargetSchema = designTargetSchema.extend({
  versionId: z.string().min(1),
  viewport: designViewportSchema,
  anchor: artifactAnchorSchema.nullable().optional(),
});

function hasTarget(v: { selector: string; anchor?: ArtifactAnchor | null | undefined }): boolean {
  return v.selector !== '' || (v.anchor ?? null) !== null;
}

export const designCommentRetargetSchema = designCommentTargetSchema.refine(
  hasTarget,
  'a comment needs an element or an anchor',
);
export type DesignCommentRetarget = z.infer<typeof designCommentRetargetSchema>;

export const designCommentCreateSchema = designCommentTargetSchema
  .extend({
    note: z.string().trim().min(1).max(DESIGN_LIMITS.noteChars),
    markAttachmentId: z.string().min(1).optional(),
  })
  .refine(hasTarget, 'a comment needs an element or an anchor');
export type DesignCommentCreate = z.infer<typeof designCommentCreateSchema>;

export const designCommentPatchSchema = z
  .object({
    note: z.string().trim().min(1).max(DESIGN_LIMITS.noteChars).optional(),
    status: z.enum(['open', 'resolved']).optional(),
    retarget: designCommentRetargetSchema.optional(),
  })
  .refine(
    (v) => [v.note, v.status, v.retarget].filter((x) => x !== undefined).length === 1,
    'change one thing at a time',
  );
export type DesignCommentPatch = z.infer<typeof designCommentPatchSchema>;

export const designCommentIdsSchema = z
  .array(z.string().min(1))
  .min(1)
  .max(DESIGN_LIMITS.commentsPerSend);

export const designShareRecordSchema = z.object({
  token: z.string(),
  path: z.string(),
  createdAt: z.number().int(),
});
export type DesignShareRecord = z.infer<typeof designShareRecordSchema>;

export function designPagePath(versionId: string): string {
  return `/api/design/versions/${encodeURIComponent(versionId)}/page`;
}

export function designSharePath(token: string): string {
  return `/s/${encodeURIComponent(token)}`;
}

function oneLine(value: string): string {
  return Array.from(value, (ch) => {
    const code = ch.charCodeAt(0);
    return code < 0x20 || code === 0x7f || code === 0x2028 || code === 0x2029 ? ' ' : ch;
  }).join('');
}

type BlockComment = Pick<
  DesignCommentRecord,
  | 'fileName'
  | 'versionSeq'
  | 'pin'
  | 'label'
  | 'elementId'
  | 'selector'
  | 'text'
  | 'note'
  | 'markAttachmentId'
  | 'anchor'
>;

function targetOf(c: BlockComment): string {
  if (c.anchor !== null) {
    const inSlide = c.anchor.type === 'slide' && c.elementId !== '';
    const where = describeAnchor(c.anchor);
    return inSlide ? `${where} · ${oneLine(c.label)}[data-od-id="${oneLine(c.elementId)}"]` : where;
  }
  if (c.elementId !== '') return `${oneLine(c.label)}[data-od-id="${oneLine(c.elementId)}"]`;
  if (c.markAttachmentId !== null) return '页面标注（画在下面的标注图上）';
  return oneLine(c.selector);
}

export function renderDesignCommentBlock(input: {
  todoRef: string;
  comments: readonly BlockComment[];
  markTokens?: ReadonlyMap<string, string>;
}): string {
  const lines = [
    `【批注 · ${input.todoRef}】只改这些批注点到的位置；别的改动先列成后续建议，不要顺手改。`,
  ];
  for (const c of input.comments) {
    const text = c.text !== '' ? `（当前文字：「${oneLine(c.text)}」）` : '';
    lines.push(`${c.pin}. ${c.fileName} v${c.versionSeq} · ${targetOf(c)}${text}：${c.note}`);
    const mark =
      c.markAttachmentId === null ? undefined : input.markTokens?.get(c.markAttachmentId);
    if (mark !== undefined) lines.push('   标注图：', mark);
  }
  return lines.join('\n');
}

const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';

function pinMark(pin: number): string {
  return pin >= 1 && pin <= CIRCLED.length ? (CIRCLED[pin - 1] as string) : `(${pin})`;
}

export function renderArtifactCommentSummary(
  comments: readonly Pick<
    DesignCommentRecord,
    'fileName' | 'versionSeq' | 'pin' | 'text' | 'note'
  >[],
): string {
  const files = [...new Set(comments.map((c) => `${c.fileName} 第 ${c.versionSeq} 版`))];
  const lines = [`批注 ${comments.length} 条 · ${files.join('、')}`];
  for (const c of comments) {
    lines.push(`${pinMark(c.pin)} ${oneLine(c.note)}`);
    if (c.text !== '') lines.push(`「${oneLine(c.text)}」`);
  }
  return lines.join('\n');
}
