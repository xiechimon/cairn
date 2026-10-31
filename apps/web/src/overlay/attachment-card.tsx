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

function fileKind(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toUpperCase() : 'FILE';
}

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
          <FileText width={18} height={18} className="text-icon" />
        )}
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle className="text-ui font-medium">{name}</AttachmentTitle>
        {uploading ? (
          <AttachmentDescription className="flex items-center gap-1 text-meta text-content-tertiary">
            <Spinner className="size-3" />
            <span>{t('上传中')}</span>
          </AttachmentDescription>
        ) : (
          <AttachmentDescription className="text-meta text-content-tertiary">
            {fileKind(name)}
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

const CARD_CLS = 'min-w-0 max-w-64 bg-card shadow-(--e1) border-0 rounded-(--radius-card)';

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
  const trigger =
    isImage && onPreview !== undefined ? (
      <AttachmentTrigger
        aria-label={name}
        title={name}
        className={`cursor-pointer rounded-(--radius-card)${triggerHookClassName != null ? ` ${triggerHookClassName}` : ''}`}
        onClick={() => onPreview(name, source)}
      />
    ) : (
      <AttachmentTrigger
        aria-label={name}
        title={name}
        render={<a href={source} target="_blank" rel="noopener noreferrer" />}
        className={`rounded-(--radius-card)${triggerHookClassName != null ? ` ${triggerHookClassName}` : ''}`}
      />
    );
  return (
    <Attachment state={state} data-testid={testId} className={CARD_CLS}>
      <CardBody
        name={name}
        source={source}
        isImage={isImage}
        uploading={uploading}
        imageHookClassName={imageHookClassName}
        t={t}
      />
      {trigger}
    </Attachment>
  );
}
