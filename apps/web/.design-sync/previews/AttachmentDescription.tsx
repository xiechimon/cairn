import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from '@cairn/web';

const FileIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
  </svg>
);

const ImageIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="9" cy="9" r="2" />
    <path d="m21 15-5-5L5 21" />
  </svg>
);

const CloseIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

const DownloadIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
  </svg>
);

const FileRow = ({
  state = "done",
  title,
  description,
}: {
  state?: "idle" | "uploading" | "processing" | "error" | "done";
  title: string;
  description: string;
}) => (
  <Attachment state={state}>
    <AttachmentMedia>
      <FileIcon />
    </AttachmentMedia>
    <AttachmentContent>
      <AttachmentTitle>{title}</AttachmentTitle>
      <AttachmentDescription>{description}</AttachmentDescription>
    </AttachmentContent>
    <AttachmentActions>
      <AttachmentAction aria-label="Remove attachment">
        <CloseIcon />
      </AttachmentAction>
    </AttachmentActions>
  </Attachment>
);


export const Done = () => <FileRow title="build-104.log" description="Implementer · 18 KB" />;

export const Failed = () => (
  <FileRow state="error" title="trace-run-311.zip" description="Exceeds 25 MB limit" />
);
