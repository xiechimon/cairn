// Composer attachment strip (issue #757): the visible face for both ends of
// the paste→upload→token window. While a grant/upload is in flight the draft
// holds no token yet — the strip renders one placeholder card per pending
// file (image bytes via blob URL at chip size, so landing the token never
// moves layout). Once tokens land, the same strip renders the settled chips
// parsed whole-line off the draft (parseAttachmentTokens — the renderer never
// chip-ifies an inline token, and neither does this). The draft text itself
// is never touched for placeholders (ATTACHMENT_LINE anchoring would break).
//
// Clicking an image card — in-flight or settled — opens the preview lightbox
// (AttachmentPreview, DialogShell at the default --z-dialog tier, above the
// new-task low-tier panel and the docked chief drawer). Non-image chips keep
// their transcript link shape: there is no viewer for them.
//
// Reuse audit (ticket asks to reuse before building new):
//   - settled chip = AttachmentChip (detail/chat-markdown.tsx:179) with its
//     #757 onPreview branch — same geometry the transcript renders;
//   - the project-page file tab is a file-name list with row select, not an
//     image viewer — verified, no reusable preview there; transcript/docpane
//     and dir-browser have no image viewer either. The lightbox below is new.
// Placement: the strip itself is in-flow static; each face positions it —
// detail composer floats it below its fixed 76px box (the above-box slot is
// the #812 mention strip's), chief and new-task take it in flow.
// #948 per-face 清零：attachment-strip.css 退役——本件自带的基础行规则迁
// 本文件 utility；三个宿主面的定位规则迁到各自消费点（detail composer 的
// float 列、chief 抽屉的流内垫、new-task body 的
// 停靠垫），卡片几何由 .spec-chip 家族单源承载（#945 起 = chat-markdown 的
// SPEC_CHIP utility 常量，detail.css 已退役），占位/落定两卡 boundingBox
// 全等（attachment-strip.spec 钉）不靠本文件复制任何 chip 几何，只补 40px
// 退化尺寸下限与 preview 钮的 UA chrome 清零。

import { useMemo, useState } from 'react';
import { DialogShell } from '../components/ui/dialog-shell.js';
import { attachmentIdFromKey } from '../detail/chat-markdown.js';
import { useI18n } from '../i18n/provider.js';
import { AttachmentCard } from './attachment-card.js';
import { type PendingAttachment, parseAttachmentTokens } from './attachment-paste.js';

interface PreviewTarget {
  name: string;
  src: string;
}

/** Image preview lightbox (#757 B). DialogShell owns Esc / outside-press /
//  focus-return; the src snapshot is taken at open time so a token landing
//  (or failing) underneath never yanks the open picture. A dead src (deleted
//  attachment) falls back to the file name instead of a blank panel. */
export function AttachmentPreview({
  name,
  src,
  onClose,
}: {
  name: string;
  src: string;
  onClose: () => void;
}) {
  const [broken, setBroken] = useState(false);
  return (
    <DialogShell title={name} onClose={onClose} size="l">
      {/* 原 .attachment-preview-body：图片 contain 进面板、永不撑爆——面板宽
          随 DialogShell（640），高图滚 dlg-body（100vh−48px 封顶律）。 */}
      <div className="flex items-center justify-center p-3">
        {broken ? (
          <div className="px-4 py-8 text-ui text-content-secondary">{name}</div>
        ) : (
          <img
            src={src}
            alt={name}
            className="max-h-[60vh] max-w-full rounded-(--radius-control) object-contain"
            onError={() => setBroken(true)}
          />
        )}
      </div>
    </DialogShell>
  );
}

/** 占位卡（在途文件）：皮肤 = .spec-chip 家族单源（detail.css，unlayered
 *  恒压 utility——正是「落定换牌零位移」要的：两卡共享同一份 chip 几何）。
 *  Button 件配方在此面逐位中和（#908 裁决 3 七通道）：h-auto（旧卡高随
 *  内容，不吃件 size 档 32px）、font-normal、press 位移禁掉；appearance
 *  清零沿旧 .spec-chip--preview（UA 按钮 chrome 不许漏进 chip 面）。 */

/** 在途角标（原 .attachment-pending-badge）：黑 veil 55% 是无 token 槽的
 *  一次性字面量（--overlay-scrim 是 60% 的模态 scrim，值不同不混用）；墨色
 *  --text-on-veil 正典槽。静止 veil、无假进度（#757）。 */

export function AttachmentStrip({
  draft,
  pending,
}: {
  /** Live draft text — settled chips parse off this, read-only. */
  draft: string;
  /** Uploads in flight (usePendingAttachments) — placeholder cards. */
  pending: PendingAttachment[];
}) {
  const { t } = useI18n();
  const settled = useMemo(() => parseAttachmentTokens(draft), [draft]);
  const [preview, setPreview] = useState<PreviewTarget | null>(null);
  if (pending.length === 0 && settled.length === 0) return null;
  return (
    // 原 .attachment-strip 基础行 + 退化尺寸下限（1px 追踪 gif / 裸 ICO 也
    // 画出可点卡：min 对占位与落定同时生效，落定换牌不动布局）。
    <div
      className="attachment-strip flex flex-wrap gap-1.5 [&_.spec-chip-img]:min-h-10 [&_.spec-chip-img]:min-w-10"
      role="status"
      aria-label={t('附件')}
    >
      {pending.map((entry) => (
        <AttachmentCard
          key={entry.uid}
          name={entry.name}
          source={entry.url ?? ''}
          isImage={entry.url !== null}
          state="uploading"
          testId="attachment-pending"
          {...(entry.url !== null
            ? {
                onPreview: (n: string, src: string) => setPreview({ name: n, src }),
              }
            : {})}
        />
      ))}
      {settled.map((token, index) => (
        <AttachmentCard
          key={`${token.key}#${index}`}
          name={token.name}
          source={`/api/attachments/${encodeURIComponent(attachmentIdFromKey(token.key))}`}
          isImage={/\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(token.key)}
          state="done"
          onPreview={(n, src) => setPreview({ name: n, src })}
        />
      ))}
      {preview !== null && (
        <AttachmentPreview name={preview.name} src={preview.src} onClose={() => setPreview(null)} />
      )}
    </div>
  );
}
