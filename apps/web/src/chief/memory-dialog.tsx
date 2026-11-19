import { useRef } from 'react';
import { useLiveData } from '../api/provider.js';
import { DialogShell } from '../components/ui/dialog-shell.js';
import { useI18n } from '../i18n/provider.js';
import { MemoryPanel } from './memory-panel.js';

export function ChiefMemoryDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { live, teamId } = useLiveData();
  const contentRef = useRef<HTMLDivElement>(null);
  return (
    <DialogShell
      open={open}
      onClose={onClose}
      title={t('记忆')}
      subtitle={t('Coordinator 的长期记忆')}
      initialFocus={contentRef}
      width="var(--settings-w)"
      className="h-(--settings-h) [&_[data-testid=dialog-body]]:pb-0"
    >
      <div
        ref={contentRef}
        tabIndex={-1}
        className="mx-auto flex min-h-full w-192 max-w-full flex-col outline-none"
      >
        <MemoryPanel live={live} teamId={teamId} project={null} />
      </div>
    </DialogShell>
  );
}
