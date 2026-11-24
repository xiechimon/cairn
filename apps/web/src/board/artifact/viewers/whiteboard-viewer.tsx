import { isExcalidrawScene } from '@cairn/shared';
import { FileWarning } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { EmptyState } from '../../../components/empty-state.js';
import { Skeleton } from '../../../components/ui/skeleton.js';
import { useI18n } from '../../../i18n/provider.js';
import type { SceneReader } from './whiteboard-canvas.js';

const WhiteboardCanvas = lazy(() => import('./whiteboard-canvas.js'));

export function WhiteboardViewer({
  text,
  editing,
  onReader,
}: {
  text: string;
  editing: boolean;
  onReader: (read: SceneReader | null) => void;
}) {
  const { t } = useI18n();
  if (!isExcalidrawScene(text))
    return (
      <EmptyState
        testId="artifact-whiteboard-error"
        icon={FileWarning}
        title={t('白板文件已损坏，请下载查看')}
        className="mt-[12vh]"
      />
    );
  return (
    <div
      data-testid="artifact-whiteboard"
      data-editing={editing || undefined}
      className="flex min-h-0 flex-1 flex-col"
    >
      <Suspense
        fallback={
          <Skeleton
            data-testid="artifact-whiteboard-loading"
            className="m-6 min-h-0 flex-1 rounded-(--radius-tile)"
          />
        }
      >
        <WhiteboardCanvas text={text} editing={editing} onReader={onReader} />
      </Suspense>
    </div>
  );
}
