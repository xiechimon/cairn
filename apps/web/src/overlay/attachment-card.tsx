// Attachment card (#1009 B): one card shape over the registry Attachment
// primitive serves both ends of the paste -> upload -> token window —
// `state="uploading"` for the in-flight placeholder, `state="done"` for the
// settled attachment. Landing the token therefore moves nothing: the
// placeholder box and the settled box are the same bytes, which is the
// geometry-continuity contract attachment-strip.spec pins.
//
// The 上传中 marker is an absolutely positioned badge, never an in-flow
// AttachmentDescription: an extra line while uploading would change the box
// and break that contract.

import {
  Attachment,
  AttachmentContent,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from '../components/ui/attachment.js';
import { useI18n } from '../i18n/provider.js';
import { FileText } from '../icons/index.js';

/** 在途角标：黑 veil 55% 是无 token 槽的一次性字面量（--overlay-scrim 是
 *  60% 的模态 scrim，值不同不混用）；墨色 --text-on-veil 正典槽。静止 veil、
 *  无假进度（#757）。 */
const PENDING_BADGE_CLS =
  'absolute bottom-1 left-1 rounded-(--radius-control) bg-[rgb(0_0_0/0.55)] px-1 text-caption whitespace-nowrap text-(--text-on-veil)';

/** 卡片内的媒体 + 标题（两态共用同一份字节，见文件头注）。 */
function CardBody({
  name,
  source,
  isImage,
  uploading,
  imageHookClassName,
  t,
}: {
  name: string;
  source: string;
  isImage: boolean;
  uploading: boolean;
  imageHookClassName?: string | undefined;
  t: (s: string) => string;
}) {
  return (
    <>
      <AttachmentMedia variant={isImage ? 'image' : 'icon'}>
        {isImage ? (
          <img
            src={source}
            alt={name}
            className={`block max-h-40 max-w-full object-cover${imageHookClassName != null ? ` ${imageHookClassName}` : ''}`}
          />
        ) : (
          <FileText width={16} height={16} />
        )}
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>{name}</AttachmentTitle>
      </AttachmentContent>
      {uploading && <span className={PENDING_BADGE_CLS}>{t('上传中')}</span>}
    </>
  );
}

export interface AttachmentCardProps {
  /** 文件名（也作可访问名——读屏与 e2e 的角色定位共用它）。 */
  name: string;
  /** 在途 = blob URL；落定 = 服务端 GET /api/attachments/{id}。 */
  source: string;
  isImage: boolean;
  state: 'uploading' | 'done';
  /** 图片卡的预览出口（#757）：缺省 = 链接形（新标签打开，消息体内的旧链形）。 */
  onPreview?: (name: string, src: string) => void;
  /** 在飞卡的载体钩子（button/div 双形无恒 role，attachment-strip.spec 钉）。 */
  testId?: string;
  /** 零规则钩子类（.spec-chip 族）：挂在触发钮/链接上——spec-brief-card /
   *  chief-composer-tools 的类定位子（a.spec-chip / button.spec-chip）按 #910
   *  裁定 3 原样存活，不逼一次载体重钉。 */
  triggerHookClassName?: string;
  /** 卡内图片的零规则钩子类（.spec-chip-img）。 */
  imageHookClassName?: string;
}

/** 卡片外框：原语默认 rounded-xl + card 底 + 缝线；B 段只钉回本域既有的
 *  行内尺度（原语 size 档的 padding 由 has-data-[slot=...] 规则承载）。 */
// border-0：原语 root 自带 1px 缝线，会让 root 盒比触发钮盒每边大 1px（占位
// 卡读 root、落定卡读触发钮 → 2px 落差，破坏「落定零位移」）。外框缝线随
// registry 无边框卡面退役——几何由触发钮单点决定，两态盒恒等。
const CARD_CLS = 'h-auto cursor-pointer border-0 font-normal';

export function AttachmentCard({
  name,
  source,
  isImage,
  state,
  onPreview,
  testId,
  triggerHookClassName,
  imageHookClassName,
}: AttachmentCardProps) {
  const { t } = useI18n();
  const uploading = state === 'uploading';
  const hook = triggerHookClassName != null ? ` ${triggerHookClassName}` : '';
  const body = (
    <CardBody
      name={name}
      source={source}
      isImage={isImage}
      uploading={uploading}
      imageHookClassName={imageHookClassName}
      t={t}
    />
  );
  // 预览出口：图片卡走 Button 形（#757），其余保持链接形（transcript 旧链形
  // 字节不变）。
  if (isImage && onPreview !== undefined) {
    return (
      <Attachment state={state} data-testid={testId} className={CARD_CLS}>
        <AttachmentTrigger
          aria-label={name}
          title={name}
          className={`flex cursor-pointer items-center gap-2 text-left${hook}`}
          onClick={() => onPreview(name, source)}
        >
          {body}
        </AttachmentTrigger>
      </Attachment>
    );
  }
  if (isImage) {
    return (
      <Attachment state={state} data-testid={testId} className={CARD_CLS}>
        <AttachmentTrigger
          aria-label={name}
          title={name}
          render={<a href={source} target="_blank" rel="noopener noreferrer" />}
          className={`flex items-center gap-2${hook}`}
        >
          {body}
        </AttachmentTrigger>
      </Attachment>
    );
  }
  return (
    <Attachment state={state} data-testid={testId} className={CARD_CLS}>
      <AttachmentTrigger
        aria-label={name}
        title={name}
        render={<a href={source} target="_blank" rel="noopener noreferrer" />}
        className={`flex items-center gap-2${hook}`}
      >
        {body}
      </AttachmentTrigger>
    </Attachment>
  );
}
