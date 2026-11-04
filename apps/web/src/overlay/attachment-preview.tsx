import { useState } from 'react';
import { DialogShell } from '../components/ui/dialog-shell.js';

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
      <div className="flex items-center justify-center p-3">
        {broken ? (
          <div className="px-4 py-8 text-ui text-content-secondary">{name}</div>
        ) : (
          <img
            src={src}
            alt={name}
            className="max-h-96 max-w-full rounded-(--radius-control) object-contain"
            onError={() => setBroken(true)}
          />
        )}
      </div>
    </DialogShell>
  );
}
