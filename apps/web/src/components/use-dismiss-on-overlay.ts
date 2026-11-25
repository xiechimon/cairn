import { createElement, useEffect, useRef } from 'react';
import { useInRouterContext, useLocation } from 'react-router';

function isExternalDialog(node: Element): boolean {
  const role = node.getAttribute('role');
  if (role !== 'dialog' && role !== 'alertdialog') return false;
  return node.closest('[data-usage-popover="true"]') === null;
}

function hasExternalDialog(node: Node): boolean {
  if (!(node instanceof Element)) return false;
  if (isExternalDialog(node)) return true;
  return (
    node.querySelector(
      '[role="dialog"]:not([data-usage-popover="true"]), [role="alertdialog"]:not([data-usage-popover="true"])',
    ) !== null
  );
}

function RouterLocationEffect({ open, onClose }: { open: boolean; onClose: () => void }) {
  const location = useLocation();
  const routeKey = `${location.key}:${location.pathname}:${location.search}`;
  const openedAtRouteRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) {
      openedAtRouteRef.current = null;
      return;
    }
    if (openedAtRouteRef.current === null) {
      openedAtRouteRef.current = routeKey;
      return;
    }
    if (openedAtRouteRef.current !== routeKey) {
      onClose();
    }
  }, [open, routeKey, onClose]);

  return null;
}

export function PopoverDismissEffect({ open, onClose }: { open: boolean; onClose: () => void }) {
  const inRouter = useInRouterContext();

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        (event.key === ',' || event.key.toLowerCase() === 'k')
      ) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);

    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const added of record.addedNodes) {
          if (hasExternalDialog(added)) {
            onClose();
            return;
          }
        }
        if (
          record.type === 'attributes' &&
          record.target instanceof Element &&
          isExternalDialog(record.target)
        ) {
          onClose();
          return;
        }
      }
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['role', 'data-open', 'aria-modal'],
    });

    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      observer.disconnect();
    };
  }, [open, onClose]);

  return inRouter ? createElement(RouterLocationEffect, { open, onClose }) : null;
}
