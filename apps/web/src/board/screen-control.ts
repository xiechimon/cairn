import { useEffect, useRef, useState } from 'react';
import type { useComputerControl } from '../api/use-computer-control.js';
import type { TFunc } from '../i18n/translate.js';

export type ComputerControl = ReturnType<typeof useComputerControl>;

export interface ScreenControl {
  held: boolean;
  want: (held: boolean) => void;
}

export function useScreenControl(control: ComputerControl): ScreenControl {
  const [request, setRequest] = useState<{ held: boolean } | null>(null);
  const latest = useRef(control);
  latest.current = control;
  const held = control.leaseId !== null;

  useEffect(() => {
    if (request === null || control.busy) return;
    setRequest(null);
    if (request.held !== held) latest.current.setHeld(request.held);
  }, [request, held, control.busy]);

  useEffect(
    () => () => {
      if (latest.current.leaseId !== null) latest.current.setHeld(false);
    },
    [],
  );

  const pending = request !== null || control.busy;
  const [shown, setShown] = useState(held);
  useEffect(() => {
    if (!pending) setShown(held);
  }, [pending, held]);

  return {
    held: request?.held ?? (pending ? shown : held),
    want: (next) => {
      setShown(next);
      setRequest({ held: next });
    },
  };
}

export function screenControlStatus(control: ComputerControl, held: boolean, t: TFunc): string {
  if (control.failed) {
    return control.failedAction === 'release'
      ? t('交还失败，请重试。')
      : t('未能接管，电脑没有响应');
  }
  if (held) return t('你在操作，Coordinator 先等着');
  return t('只看画面，Coordinator 照常工作');
}
