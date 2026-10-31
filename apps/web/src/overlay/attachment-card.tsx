import {
  Attachment,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from '../components/ui/attachment.js';
import { Spinner } from '../components/ui/spinner.js';
import { useI18n } from '../i18n/provider.js';
import { FileText } from '../icons/index.js';

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
        {uploading && (
          <AttachmentDescription className="flex items-center gap-1 text-meta text-content-tertiary">
            <Spinner className="size-3" />
            <span>{t('上传中')}</span>
          </AttachmentDescription>
        )}
      </AttachmentContent>
    </>
  );
}

export interface AttachmentCardProps {
  name: string;
  source: string;
  isImage: boolean;
  state: 'uploading' | 'done';
  onPreview?: (name: string, src: string) => void;
  testId?: string;
  triggerHookClassName?: string;
  imageHookClassName?: string;
}

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
