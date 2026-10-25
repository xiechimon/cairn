import type { ClipboardEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertDialog, AlertDialogContent } from '../components/ui/alert-dialog.js';
import { Button } from '../components/ui/button.js';
import {
  DIALOG_HEAD_CLS,
  DIALOG_PANEL_CLS,
  DIALOG_PRIMARY_BUTTON,
  DIALOG_TEXT_BUTTON,
  DIALOG_TITLE_CLS,
  DialogFootRow,
  DialogShell,
  dialogWidth,
} from '../components/ui/dialog-shell.js';
import { Kbd } from '../components/ui/kbd.js';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover.js';
import { Textarea } from '../components/ui/textarea.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip.js';
import { PROJECT_ID, PROJECT_NAME } from '../fixtures/fixtures.js';
import { useI18n } from '../i18n/provider.js';
import { Check, ChevronDown, Grid2x2, Paperclip, X } from '../icons/index.js';
import { isEditableTarget, useChordHotkey, useProjectCycleHotkey } from '../overlays/hotkeys.js';
import { safeLocalStorage } from '../safe-storage.js';
import {
  createPastedNameCounter,
  filesFromClipboardData,
  insertAttachmentTokens,
  type PastedNameCounter,
  preparePastedFiles,
} from './attachment-paste.js';
import { AttachmentStrip } from './attachment-strip.js';
import { type MentionGroups, MentionPicker } from './mention-picker.js';
import { insertMentionText, type MentionToken } from './mention-token.js';
import { applyOrderedListEnter } from './ordered-list.js';
import { usePendingAttachments } from './pending-attachments.js';

const PROJECT_CHIP_CLS =
  "new-task-project flex h-auto min-w-0 cursor-pointer items-center justify-start gap-2 border-none bg-transparent p-0 font-normal text-(--foreground) hover:bg-transparent hover:text-(--foreground) dark:hover:bg-transparent aria-expanded:bg-transparent aria-expanded:text-(--foreground) active:not-aria-[haspopup]:translate-y-0 [&_svg]:text-(--text-tertiary) [&_svg:not([class*='size-'])]:size-auto";

const PROJECT_MENU_CLS = 'new-task-project-menu w-55 gap-0 rounded-lg p-1';

const OPTION_ROW_CLS =
  'new-task-project-row flex h-8 w-full cursor-pointer items-center justify-start gap-2 rounded-md border-none bg-transparent px-2 text-left text-ui font-normal text-foreground aria-expanded:bg-transparent active:not-aria-[haspopup]:translate-y-0 disabled:pointer-events-auto';

const DISCARD_PANEL_CLS = `new-task-discard grid-rows-[auto_auto] data-[size=default]:max-w-none data-[size=default]:sm:max-w-none ${DIALOG_PANEL_CLS}`;

const SPEC_TEMPLATE_LINES = [
  '我想要的结果：',
  '现在的情况：',
  '需要保留或避免：',
  '我会这样确认完成：',
  '我希望收到：',
];

interface ProjectOption {
  id: string;
  name: string;
}

export const NEW_TASK_PROJECT_STORAGE_KEY = 'cairn.newTaskProjectId';

function readRememberedProject(storage: Storage | null): string | null {
  try {
    return storage?.getItem(NEW_TASK_PROJECT_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

function writeRememberedProject(storage: Storage | null, projectId: string): void {
  try {
    storage?.setItem(NEW_TASK_PROJECT_STORAGE_KEY, projectId);
  } catch {}
}

const DEFAULT_PROJECT: ProjectOption = { id: PROJECT_ID, name: PROJECT_NAME };

const isEditableOutsideDialog = (target: EventTarget | null): boolean =>
  isEditableTarget(target) &&
  !(target instanceof HTMLElement && target.closest('.new-task-dialog') !== null);

const START_SHORTCUT_LABEL = '⌘↵';

export interface NewTaskDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (spec: string, projectId?: string) => void;
  onSaveAndStart?: (spec: string, projectId?: string) => void;
  projects?: ProjectOption[];
  spec?: string;
  onSpecChange?: (next: string) => void;
  onAttachment?: (files: File[]) => string[] | Promise<string[]>;

  mentionGroups?: MentionGroups;

  rememberProject?: boolean;
}

export function NewTaskDialog({
  open,
  onClose,
  onSave,
  onSaveAndStart,
  projects,
  spec: specProp,
  onSpecChange,
  onAttachment,

  mentionGroups,
  rememberProject = false,
}: NewTaskDialogProps) {
  const { t } = useI18n();
  const [internalSpec, setInternalSpec] = useState('');
  const specControlled = specProp !== undefined && onSpecChange !== undefined;
  const spec = specControlled ? (specProp as string) : internalSpec;
  const setSpec: React.Dispatch<React.SetStateAction<string>> = specControlled
    ? (next) =>
        (onSpecChange as (s: string) => void)(typeof next === 'function' ? next(spec) : next)
    : setInternalSpec;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(() =>
    rememberProject ? readRememberedProject(safeLocalStorage()) : null,
  );
  const gestureConsumedRef = useRef(false);
  const markGestureConsumed = () => {
    if (gestureConsumedRef.current) return;
    gestureConsumedRef.current = true;
    const clear = () => {
      gestureConsumedRef.current = false;
      document.removeEventListener('pointerdown', clear, true);
      document.removeEventListener('keydown', clear, true);
    };
    document.addEventListener('pointerdown', clear, true);
    document.addEventListener('keydown', clear, true);
  };
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [attaching, setAttaching] = useState(false);
  const {
    pending: pendingAttachments,
    track: trackPending,
    untrack: untrackPending,
  } = usePendingAttachments();
  const pastedNameCounterRef = useRef<PastedNameCounter | null>(null);
  if (pastedNameCounterRef.current === null) {
    pastedNameCounterRef.current = createPastedNameCounter();
  }
  const attachInFlightRef = useRef(0);
  const pendingCaretRef = useRef<number | null>(null);
  const specMirrorRef = useRef(spec);
  specMirrorRef.current = spec;
  const rows = projects ?? [DEFAULT_PROJECT];
  const selected = rows.find((row) => row.id === projectId) ?? rows[0];
  const projectName = selected?.name;

  const dirty = spec.trim() !== '';
  const returnFocusToInvoker = () => {
    const el = returnFocusRef.current;
    returnFocusRef.current = null;
    if (el && el !== document.body && document.contains(el)) el.focus();
  };
  const gateRef = useRef({
    discardOpen: false,
    pickerOpen: false,
    projectOpen: false,
    dirty: false,
  });
  gateRef.current = { discardOpen, pickerOpen, projectOpen, dirty };
  const requestClose = () => {
    if (gestureConsumedRef.current) return;
    const gate = gateRef.current;
    if (gate.discardOpen) {
      markGestureConsumed();
      closeDiscard();
      return;
    }
    if (gate.pickerOpen) {
      markGestureConsumed();
      setPickerOpen(false);
      return;
    }
    if (gate.projectOpen) {
      markGestureConsumed();
      setProjectOpen(false);
      return;
    }
    if (gate.dirty) {
      markGestureConsumed();
      setDiscardOpen(true);
      return;
    }
    returnFocusToInvoker();
    onClose();
  };
  useEffect(() => {
    if (!open) {
      setProjectOpen(false);
      setDiscardOpen(false);
      setPickerOpen(false);
      setSpec('');
    }
  }, [open]);
  const specRef = useRef<HTMLTextAreaElement | null>(null);
  const focusSpecRef = useCallback((el: HTMLTextAreaElement | null) => {
    specRef.current = el;
    el?.focus();
  }, []);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open) {
      returnFocusRef.current = document.activeElement as HTMLElement | null;
      return;
    }
    returnFocusToInvoker();
  }, [open]);
  const keepBtnRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (discardOpen) keepBtnRef.current?.focus();
  }, [discardOpen]);
  const closeDiscard = () => {
    setDiscardOpen(false);
    specRef.current?.focus();
  };

  const cycleProject = useCallback(() => {
    if (rows.length < 2) return;
    const index = rows.findIndex((row) => row.id === selected?.id);
    const next = rows[(index + 1) % rows.length];
    if (next === undefined) return;
    setProjectId(next.id);
    if (rememberProject) writeRememberedProject(safeLocalStorage(), next.id);
  }, [rows, selected?.id, rememberProject]);
  useProjectCycleHotkey(open && !discardOpen && rows.length > 1, cycleProject);

  const runAttachment = (files: File[], caret: number | null, also?: () => void) => {
    if (!onAttachment) {
      also?.();
      return;
    }
    attachInFlightRef.current += 1;
    setAttaching(true);
    const pendingUids = trackPending(files);
    void Promise.resolve(onAttachment(files))
      .then((tokens) => {
        if (tokens.length === 0) return;
        const inserted = insertAttachmentTokens(specMirrorRef.current, tokens, caret);
        pendingCaretRef.current = inserted.caret;
        setSpec(inserted.value);
        requestAnimationFrame(() => {
          const ta = specRef.current;
          const next = pendingCaretRef.current;
          pendingCaretRef.current = null;
          if (ta != null && next != null && document.activeElement === ta) {
            ta.setSelectionRange(next, next);
          }
        });
      })
      .catch((err) => {
        console.error('attachment delegate failed', err);
      })
      .finally(() => {
        untrackPending(pendingUids);
        attachInFlightRef.current = Math.max(0, attachInFlightRef.current - 1);
        if (attachInFlightRef.current === 0) setAttaching(false);
        also?.();
      });
  };

  const onPickFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;
    runAttachment(files, null);
  };

  const handleSpecPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (!onAttachment) return;
    const files = filesFromClipboardData(event.clipboardData);
    if (files.length === 0) return;
    event.preventDefault();
    const counter = pastedNameCounterRef.current as PastedNameCounter;
    counter.begin(specMirrorRef.current.trim() === '');
    const caret = event.currentTarget.selectionStart ?? specMirrorRef.current.length;
    runAttachment(preparePastedFiles(files, counter), caret, () => counter.end());
  };

  const handleSpecKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter') return;
    if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.nativeEvent.isComposing) return;
    const ta = event.currentTarget;
    const continued = applyOrderedListEnter(ta.value, ta.selectionStart ?? ta.value.length);
    if (continued === null) return;
    event.preventDefault();
    setSpec(continued.value);
    const nextCaret = continued.caret;
    requestAnimationFrame(() => {
      if (document.activeElement === ta) ta.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const save = () => {
    if (attachInFlightRef.current > 0) return;
    onSave(spec, selected?.id);
  };

  const saveAndStart = () => {
    if (attachInFlightRef.current > 0) return;
    if (spec.trim() === '') return;
    if (onSaveAndStart) onSaveAndStart(spec, selected?.id);
    else save();
  };
  useChordHotkey('enter', isEditableOutsideDialog, saveAndStart, open && !discardOpen);

  const discardAndClose = () => {
    setDiscardOpen(false);
    setSpec('');
    onClose();
  };

  const insertTokens = (tokens: MentionToken[]) => {
    if (tokens.length === 0) return;
    const ta = specRef.current;
    if (ta == null) {
      setSpec((current) => {
        let value = current;
        for (const token of tokens) value = insertMentionText(value, token, null).value;
        return value;
      });
      return;
    }
    const start = ta.selectionStart ?? spec.length;
    const pending = { caret: start };
    setSpec((current) => {
      let value = current;
      let at = start;
      for (const token of tokens) {
        const result = insertMentionText(value, token, at);
        value = result.value;
        pending.caret = result.caret;
        at = result.caret;
      }
      return value;
    });
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(pending.caret, pending.caret);
    });
  };

  const groups = mentionGroups ?? {
    todo: [],
    skill: [],
    agent: [],
    project: [],
    machine: [],
  };

  return (
    <>
      <DialogShell
        bare
        open={open}
        onClose={requestClose}
        zIndex="var(--z-panel-low)"
        className="new-task-dialog"
        title={t('新建任务')}
        size="l"
        height={439}
      >
        <div
          className="relative flex h-11 flex-none items-center border-b border-border pr-1 pl-3"
          data-testid="new-task-head"
        >
          <span className="relative flex items-center">
            {projectName !== undefined && (
              <Popover
                open={projectOpen}
                onOpenChange={(next: boolean, details) => {
                  if (!next && details.reason === 'outside-press') markGestureConsumed();
                  setProjectOpen(next);
                }}
              >
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <PopoverTrigger
                        render={
                          <Button
                            variant="ghost"
                            type="button"
                            className={PROJECT_CHIP_CLS}
                            data-testid="new-task-project-chip"
                            aria-haspopup="listbox"
                          />
                        }
                      />
                    }
                  >
                    <span className="size-5 rounded-(--radius-control) bg-(--project-avatar-bg) text-center text-caption leading-5 uppercase text-(--project-avatar-fg)">
                      {projectName.charAt(0).toLowerCase()}
                    </span>
                    <span className="new-task-project-name min-w-0 max-w-55 truncate text-ui leading-4 text-foreground">
                      {projectName}
                    </span>
                    <ChevronDown width={12} height={12} />
                  </TooltipTrigger>
                  <TooltipContent side="right" sideOffset={8}>
                    <Kbd>Tab</Kbd>
                  </TooltipContent>
                </Tooltip>
                <PopoverContent
                  side="bottom"
                  align="start"
                  sideOffset={8}
                  initialFocus={false}
                  role="listbox"
                  aria-label={t('项目')}
                  className={PROJECT_MENU_CLS}
                >
                  {rows.map((row) => (
                    <Button
                      key={row.id}
                      variant="ghost"
                      type="button"
                      className={OPTION_ROW_CLS}
                      role="option"
                      aria-selected={row.id === selected?.id}
                      onClick={() => {
                        setProjectId(row.id);
                        if (rememberProject) writeRememberedProject(safeLocalStorage(), row.id);
                        setProjectOpen(false);
                      }}
                    >
                      <span className="size-4 flex-none rounded-(--radius-control) bg-(--project-avatar-bg) text-center text-caption leading-4 uppercase text-(--project-avatar-fg)">
                        {row.name.charAt(0).toLowerCase()}
                      </span>
                      <span className="new-task-project-row-name min-w-0 truncate">{row.name}</span>
                      {row.id === selected?.id && (
                        <span className="ml-auto flex text-(--card-button)">
                          <Check width={14} height={14} />
                        </span>
                      )}
                    </Button>
                  ))}
                </PopoverContent>
              </Popover>
            )}
          </span>
          <div className="pointer-events-none absolute inset-x-0 text-center font-heading text-heading font-medium text-foreground">
            {t('新建任务')}
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="new-task-close ml-auto size-7 text-content-tertiary"
            aria-label={t('关闭')}
            onClick={requestClose}
          >
            <X />
          </Button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col px-4 pt-4 [&>.attachment-strip]:flex-none [&>.attachment-strip]:pb-2 [&_[data-slot=attachment]]:bg-transparent">
          <Textarea
            ref={focusSpecRef}
            data-testid="new-task-spec"
            className="new-task-spec min-h-0 flex-1 resize-none border-0 bg-transparent p-0 text-ui leading-5 tabular-nums text-foreground field-sizing-fixed placeholder:text-content-tertiary focus-visible:border-transparent focus-visible:ring-0 focus-visible:outline-none dark:bg-transparent md:text-ui"
            placeholder={SPEC_TEMPLATE_LINES.map((line) => t(line)).join('\n')}
            value={spec}
            onChange={(e) => setSpec(e.target.value)}
            onKeyDown={handleSpecKeyDown}
            onPaste={handleSpecPaste}
          />
          {/* deliberate-native: hidden file picker trigger (display:none, opened programmatically); the visible skin is the attachment Button */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={onPickFiles}
            accept="text/*,image/*,application/json,application/pdf,application/xml"
          />
          <AttachmentStrip draft={spec} pending={pendingAttachments} />
        </div>
        <div className="flex-none p-3">
          <div className="flex h-8 items-center">
            <div className="flex items-center gap-1" data-testid="new-task-tools">
              <Button
                variant="ghost"
                size="icon"
                className="size-7.5 text-content-tertiary"
                aria-label={t('添加附件')}
                disabled={attaching || !onAttachment}
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-7.5 text-content-tertiary"
                aria-label={t('提及')}
                onClick={() => setPickerOpen((value) => !value)}
              >
                <Grid2x2 />
              </Button>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <Button
                variant="ghost"
                size="default"
                className={`new-task-save ${DIALOG_TEXT_BUTTON}`}
                disabled={spec.trim() === ''}
                onClick={save}
              >
                {t('保存')}
              </Button>
              <Button
                size="default"
                className={`new-task-start ${DIALOG_PRIMARY_BUTTON}`}
                disabled={spec.trim() === ''}
                onClick={saveAndStart}
              >
                {t('保存并开始')}
                <Kbd
                  aria-hidden="true"
                  className="h-4 min-w-0 rounded-sm bg-primary-foreground/15 px-1 text-caption font-normal text-primary-foreground/80"
                >
                  {START_SHORTCUT_LABEL}
                </Kbd>
              </Button>
            </div>
          </div>
        </div>
      </DialogShell>
      <AlertDialog
        open={discardOpen}
        onOpenChange={(next: boolean) => {
          if (!next) {
            markGestureConsumed();
            closeDiscard();
          }
        }}
      >
        <AlertDialogContent
          className={DISCARD_PANEL_CLS}
          style={{ width: dialogWidth('s') }}
          aria-label={t('放弃新建任务？未保存的内容将丢失。')}
        >
          <div data-testid="dialog-head" className={DIALOG_HEAD_CLS}>
            <div className={DIALOG_TITLE_CLS}>{t('放弃新建任务？未保存的内容将丢失。')}</div>
          </div>
          <DialogFootRow>
            <Button
              variant="ghost"
              className={`new-task-discard-keep ${DIALOG_TEXT_BUTTON}`}
              ref={keepBtnRef}
              onClick={closeDiscard}
            >
              {t('继续编辑')}
            </Button>
            <Button
              variant="destructive"
              className={DIALOG_PRIMARY_BUTTON}
              onClick={discardAndClose}
            >
              {t('放弃并关闭')}
            </Button>
          </DialogFootRow>
        </AlertDialogContent>
      </AlertDialog>
      <MentionPicker
        open={pickerOpen}
        onClose={() => {
          markGestureConsumed();
          setPickerOpen(false);
        }}
        groups={groups}
        onInsert={(tokens) => {
          insertTokens(tokens);
          setPickerOpen(false);
        }}
      />
    </>
  );
}
