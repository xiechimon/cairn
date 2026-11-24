import type { DesignPageRecord, DesignVersionRecord } from '@cairn/shared';
import { useEffect, useState } from 'react';
import { useDesignMutations, useDesignPages, useDesignVersions } from '../../api/hooks.js';
import { useLiveData } from '../../api/provider.js';
import { toastError } from '../../components/ui/toaster.js';
import { useI18n } from '../../i18n/provider.js';

export interface ArtifactVersions {
  page: DesignPageRecord | undefined;
  shareOrigin: string | null;
  pagesFailed: boolean;
  retryPages: () => void;
  versions: readonly DesignVersionRecord[];
  shown: DesignVersionRecord | undefined;
  viewingOld: boolean;
  pick: (version: DesignVersionRecord) => void;
  showCurrent: () => void;
  restoreShown: () => void;
  restoring: boolean;
}

export function useArtifactVersions(
  todoId: string,
  fileName: string,
  openedVersionId: string | null,
): ArtifactVersions {
  const { t } = useI18n();
  const { live } = useLiveData();
  const pagesQ = useDesignPages(todoId, live);
  const page = pagesQ.data?.pages.find((item) => item.fileName === fileName);
  const versionsQ = useDesignVersions(todoId, fileName, live);
  const [pickedId, setPickedId] = useState<string | null>(openedVersionId);
  const current = page?.current;
  useEffect(() => {
    if (current !== undefined && pickedId === current.id) setPickedId(null);
  }, [current, pickedId]);
  const versions = versionsQ.data ?? (current !== undefined ? [current] : []);
  const shown =
    (pickedId === null ? undefined : versions.find((v) => v.id === pickedId)) ?? current;
  const { restore } = useDesignMutations(todoId, fileName);
  return {
    page,
    shareOrigin: pagesQ.data?.shareOrigin ?? null,
    pagesFailed: pagesQ.isError,
    retryPages: () => void pagesQ.refetch(),
    versions,
    shown,
    viewingOld: shown !== undefined && current !== undefined && shown.id !== current.id,
    pick: (version) => setPickedId(version.id === current?.id ? null : version.id),
    showCurrent: () => setPickedId(null),
    restoreShown: () => {
      if (shown === undefined) return;
      restore.mutate(shown.id, {
        onSuccess: () => setPickedId(null),
        onError: (error) => toastError(t('未能切回这个版本'), error),
      });
    },
    restoring: restore.isPending,
  };
}
