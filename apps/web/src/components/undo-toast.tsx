import { Check, Undo2 } from 'lucide-react';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { Button } from './ui/button.js';

export interface UndoToastProps {
  text: string;
  onUndo: () => void;
}

export function UndoToast({ text, onUndo }: UndoToastProps) {
  return (
    <div
      role="status"
      data-slot="undo-toast"
      className="flex w-max max-w-[calc(100vw-1.5rem)] items-center gap-3 rounded-xl bg-primary py-2 pr-2 pl-3.5 text-ui text-primary-foreground shadow-(--e2)"
    >
      <Check className="size-3.5 flex-none" />
      <span className="min-w-0 truncate">{text}</span>
      <Button
        variant="ghost"
        onClick={onUndo}
        className="h-7 font-semibold text-primary-foreground hover:bg-primary-foreground/12 hover:text-primary-foreground dark:hover:bg-primary-foreground/12"
      >
        <Undo2 className="size-3.5" />
        Undo
      </Button>
      <span className="flex-none font-mono text-caption text-primary-foreground/70">⌘Z</span>
    </div>
  );
}

function LiveUndoToast({ id, text, onUndo }: UndoToastProps & { id: string | number }) {
  const undo = () => {
    onUndo();
    toast.dismiss(id);
  };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        undo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });
  return <UndoToast text={text} onUndo={undo} />;
}

export function toastUndo(text: string, onUndo: () => void): void {
  toast.custom((id) => <LiveUndoToast id={id} text={text} onUndo={onUndo} />, { duration: 6000 });
}
