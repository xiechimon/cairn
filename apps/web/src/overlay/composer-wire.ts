import type {
  ChangeEvent,
  ClipboardEvent,
  Dispatch,
  KeyboardEvent,
  MutableRefObject,
  RefObject,
  SetStateAction,
} from 'react';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useI18n } from '../i18n/provider.js';
import {
  createPastedNameCounter,
  filesFromClipboardData,
  insertAttachmentTokens,
  type PastedNameCounter,
  type PendingAttachment,
  preparePastedFiles,
} from './attachment-paste.js';
import {
  type CompletionRange,
  completionKeyIntent,
  detectCompletionToken,
  MENTION_COMPLETION_SPEC,
} from './completion.js';
import type { MentionGroups } from './mention-picker.js';
import {
  buildInlineRows,
  type FileMentionEntry,
  type InlineCompletionRow,
  insertFileText,
  insertMentionText,
  type MentionToken,
} from './mention-token.js';
import { applyOrderedListEnter } from './ordered-list.js';
import { usePendingAttachments } from './pending-attachments.js';
import {
  type BuiltinSlashName,
  buildSlashSections,
  insertSlashText,
  isMessageStart,
  resolveSlashAccept,
  SLASH_COMPLETION_SPEC,
  type SlashRow,
  type SlashSection,
} from './slash-commands.js';

export interface ComposerWireOptions {
  editable?: boolean;
  draft?: string;
  onDraftChange?: (next: string) => void;
  onSend?: (text: string) => void | Promise<void>;
  onAttachment?: (files: File[]) => string[] | Promise<string[]>;
  mentionGroups?: MentionGroups;
  mentionFiles?: FileMentionEntry[];
  slash?: {
    reviewAvailable: boolean;
    stopAvailable: boolean;
    onReview?: () => void;
    onStop?: () => void;
  };
  growCap?: number;
  onPickProject?: (project: { id: string; label: string }) => void;
}

export interface ComposerWire {
  draft: string;
  setDraft: Dispatch<SetStateAction<string>>;
  send: () => void;
  handleChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  handleKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  handleCaretMoved: () => void;
  handleCompositionEnd: () => void;
  handleBlur: () => void;
  textareaRef: MutableRefObject<HTMLTextAreaElement | null>;
  fileInputRef: RefObject<HTMLInputElement | null>;
  openFilePicker: () => void;
  attaching: boolean;
  pendingAttachments: PendingAttachment[];
  onPickFiles: (event: ChangeEvent<HTMLInputElement>) => void;
  handlePaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  pickerOpen: boolean;
  togglePicker: () => void;
  closePicker: () => void;
  inlineOpen: boolean;
  inlineCaret: number | null;
  inlineQuery: string;
  inlineRows: InlineCompletionRow[];
  inlineHighlight: number | null;
  setInlineHighlight: (index: number | null) => void;
  inlineListboxId: string;
  inlineListboxRef: RefObject<HTMLDivElement | null>;
  closeInline: () => void;
  acceptInlineRow: (row: InlineCompletionRow) => void;
  slashOpen: boolean;
  slashQuery: string;
  slashCaret: number | null;
  slashSections: SlashSection[];
  slashRows: SlashRow[];
  slashHighlight: number | null;
  setSlashHighlight: (index: number | null) => void;
  slashListboxId: string;
  slashListboxRef: RefObject<HTMLDivElement | null>;
  closeSlash: () => void;
  acceptSlashRow: (row: SlashRow, via: 'enter' | 'tab') => void;
  helpOpen: boolean;
  closeHelp: () => void;
  helpRows: SlashRow[];
  helpSkillCount: number;
  insertTokens: (tokens: MentionToken[]) => void;
  groups: MentionGroups;
}

const EMPTY_GROUPS: MentionGroups = {
  todo: [],
  skill: [],
  agent: [],
  project: [],
  machine: [],
};

function sameRange(a: CompletionRange, b: CompletionRange): boolean {
  return a.start === b.start && a.end === b.end && a.query === b.query;
}

export function useComposerWire(options: ComposerWireOptions): ComposerWire {
  const {
    editable = false,
    draft: draftProp,
    onDraftChange,
    onSend,
    onAttachment,
    mentionGroups,
    mentionFiles,
    slash: slashOptions,
    growCap,
    onPickProject,
  } = options;
  const { t } = useI18n();

  const [internalDraft, setInternalDraft] = useState('');
  const controlled = draftProp !== undefined && onDraftChange !== undefined;
  const staticFace = draftProp !== undefined && onDraftChange === undefined;
  const draft = controlled || staticFace ? (draftProp as string) : internalDraft;
  const setDraft: Dispatch<SetStateAction<string>> = controlled
    ? (next) =>
        (onDraftChange as (value: string) => void)(typeof next === 'function' ? next(draft) : next)
    : staticFace
      ? () => {}
      : setInternalDraft;

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const inlineListboxRef = useRef<HTMLDivElement | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const {
    pending: pendingAttachments,
    track: trackPending,
    untrack: untrackPending,
  } = usePendingAttachments();

  const [inlineRange, setInlineRange] = useState<CompletionRange | null>(null);
  const inlineRangeRef = useRef<CompletionRange | null>(null);
  const dismissedRangeRef = useRef<CompletionRange | null>(null);
  const [inlineHighlight, setInlineHighlight] = useState<number | null>(null);
  const inlineListboxId = useId();
  const entityCount =
    (mentionGroups?.agent.length ?? 0) +
    (mentionGroups?.todo.length ?? 0) +
    (mentionGroups?.skill.length ?? 0) +
    (mentionGroups?.project.length ?? 0) +
    (mentionGroups?.machine.length ?? 0);
  const fileCount = mentionFiles?.length ?? 0;
  const inlineOpen = inlineRange !== null && entityCount + fileCount > 0;

  const [slashRange, setSlashRange] = useState<CompletionRange | null>(null);
  const slashRangeRef = useRef<CompletionRange | null>(null);
  const dismissedSlashRef = useRef<CompletionRange | null>(null);
  const [slashHighlight, setSlashHighlight] = useState<number | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const slashListboxId = useId();
  const slashListboxRef = useRef<HTMLDivElement | null>(null);
  const slashEnabled = editable && slashOptions !== undefined;

  const draftRef = useRef(draft);
  draftRef.current = draft;
  const pastedNameCounterRef = useRef<PastedNameCounter | null>(null);
  if (pastedNameCounterRef.current === null)
    pastedNameCounterRef.current = createPastedNameCounter();
  const attachInFlightRef = useRef(0);
  const pendingAttachRef = useRef<{ value: string; caret: number } | null>(null);

  const applyRange = useCallback((next: CompletionRange | null) => {
    const prev = inlineRangeRef.current;
    if (prev === next) return;
    if (prev !== null && next !== null && sameRange(prev, next)) return;
    if (next !== null) {
      const dismissed = dismissedRangeRef.current;
      if (dismissed !== null) {
        if (sameRange(dismissed, next)) return;
        dismissedRangeRef.current = null;
      }
      slashRangeRef.current = null;
      setSlashRange(null);
      setSlashHighlight(null);
    }
    inlineRangeRef.current = next;
    setInlineRange(next);
    setInlineHighlight(null);
  }, []);

  const closeInline = useCallback(() => {
    applyRange(null);
  }, [applyRange]);

  const applySlashRange = useCallback((next: CompletionRange | null) => {
    const prev = slashRangeRef.current;
    if (prev === next) return;
    if (prev !== null && next !== null && sameRange(prev, next)) return;
    if (next !== null) {
      const dismissed = dismissedSlashRef.current;
      if (dismissed !== null) {
        if (sameRange(dismissed, next)) return;
        dismissedSlashRef.current = null;
      }
      inlineRangeRef.current = null;
      setInlineRange(null);
      setInlineHighlight(null);
    }
    slashRangeRef.current = next;
    setSlashRange(next);
    setSlashHighlight(null);
  }, []);

  const closeSlash = useCallback(() => {
    applySlashRange(null);
  }, [applySlashRange]);

  const closeHelp = useCallback(() => {
    setHelpOpen(false);
  }, []);

  const reevaluate = useCallback(() => {
    if (!editable) return;
    const ta = textareaRef.current;
    if (ta == null) return;
    const caret = ta.selectionStart ?? ta.value.length;
    if (slashEnabled) {
      const slash = detectCompletionToken(ta.value, caret, SLASH_COMPLETION_SPEC);
      if (slash !== null) {
        applySlashRange(slash);
        return;
      }
      applySlashRange(null);
    }
    applyRange(detectCompletionToken(ta.value, caret, MENTION_COMPLETION_SPEC));
  }, [editable, slashEnabled, applySlashRange, applyRange]);

  const reevaluateFromChange = useCallback(() => {
    dismissedRangeRef.current = null;
    dismissedSlashRef.current = null;
    reevaluate();
  }, [reevaluate]);

  const inlineRows: InlineCompletionRow[] = useMemo(() => {
    if (inlineRange === null || mentionGroups == null) return [];
    return buildInlineRows(inlineRange.query, mentionGroups, mentionFiles);
  }, [inlineRange, mentionGroups, mentionFiles]);

  const slashSections: SlashSection[] = useMemo(() => {
    if (slashRange === null || !slashEnabled) return [];
    return buildSlashSections({
      query: slashRange.query,
      available: {
        review: slashOptions?.reviewAvailable === true,
        stop: slashOptions?.stopAvailable === true,
      },
      skills: (mentionGroups?.skill ?? []).map((s) => ({
        id: s.id,
        name: s.label,
        ...(s.subtitle != null ? { description: s.subtitle } : {}),
      })),
    });
  }, [slashRange, slashEnabled, slashOptions, mentionGroups]);
  const slashRows = useMemo(() => slashSections.flatMap((s) => s.rows), [slashSections]);
  const slashOpen = slashRange !== null && slashEnabled;
  const slashQuery = slashRange?.query ?? '';
  const helpSkillCount = mentionGroups?.skill.length ?? 0;
  const helpRows = useMemo(
    () =>
      buildSlashSections({
        query: '',
        available: {
          review: slashOptions?.reviewAvailable === true,
          stop: slashOptions?.stopAvailable === true,
        },
        skills: [],
      }).flatMap((s) => s.rows),
    [slashOptions],
  );

  const send = () => {
    if (attachInFlightRef.current > 0) return;
    const text = draft.trim();
    if (text === '' && !editable) {
      onSend?.(text);
      return;
    }
    if (text === '') return;
    const result = onSend?.(text);
    if (result instanceof Promise) {
      void result.then(() => setDraft('')).catch(() => {});
    } else {
      setDraft('');
    }
  };

  const openFilePicker = () => fileInputRef.current?.click();

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
        const inserted = insertAttachmentTokens(draftRef.current, tokens, caret);
        pendingAttachRef.current = inserted;
        setDraft(inserted.value);
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

  const onPickFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) return;
    runAttachment(files, null);
  };

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (!onAttachment) return;
    const files = filesFromClipboardData(event.clipboardData);
    if (files.length === 0) return;
    event.preventDefault();
    closeInline();
    const counter = pastedNameCounterRef.current as PastedNameCounter;
    counter.begin(draftRef.current.trim() === '');
    const caret = event.currentTarget.selectionStart ?? draftRef.current.length;
    runAttachment(preparePastedFiles(files, counter), caret, () => counter.end());
  };

  const pendingInsertRef = useRef<{ value: string; caret: number } | null>(null);

  useLayoutEffect(() => {
    const pending = pendingInsertRef.current;
    if (pending == null) return;
    pendingInsertRef.current = null;
    if (pending.value !== draft) return;
    const ta = textareaRef.current;
    if (ta == null) return;
    ta.focus();
    ta.setSelectionRange(pending.caret, pending.caret);
  }, [draft]);

  useLayoutEffect(() => {
    const pending = pendingAttachRef.current;
    if (pending == null) return;
    pendingAttachRef.current = null;
    if (pending.value !== draft) return;
    const ta = textareaRef.current;
    if (ta == null || document.activeElement !== ta) return;
    ta.setSelectionRange(pending.caret, pending.caret);
  }, [draft]);

  useLayoutEffect(() => {
    if (growCap == null) return;
    const ta = textareaRef.current;
    if (ta == null) return;
    ta.style.height = '';
    const grown = Math.min(ta.scrollHeight, growCap);
    if (grown > ta.clientHeight) ta.style.height = `${grown}px`;
  }, [draft, growCap]);

  const applyTextInsert = (
    produce: (
      current: string,
      at: number,
      end: number | undefined,
    ) => { value: string; caret: number },
    range: CompletionRange | null,
  ) => {
    const ta = textareaRef.current;
    if (ta == null) {
      setDraft((current) => produce(current, current.length, undefined).value);
      return;
    }
    const start = range !== null ? range.start : (ta.selectionStart ?? ta.value.length);
    const replaceEnd = range !== null ? range.end : undefined;
    closeInline();
    closeSlash();
    pendingInsertRef.current = null;
    setDraft((current) => {
      const result = produce(current, start, replaceEnd);
      pendingInsertRef.current = { value: result.value, caret: result.caret };
      return result.value;
    });
  };

  const insertTokensAt = (tokens: MentionToken[], range: CompletionRange | null) => {
    if (tokens.length === 0) return;
    applyTextInsert((current, at, end) => {
      let value = current;
      let caret = at;
      let rest = end;
      for (const token of tokens) {
        const result = insertMentionText(value, token, caret, rest);
        value = result.value;
        caret = result.caret;
        rest = undefined;
      }
      return { value, caret };
    }, range);
  };

  const insertTokens = (tokens: MentionToken[]) => {
    insertTokensAt(tokens, inlineOpen ? inlineRangeRef.current : null);
  };

  const acceptInlineRow = (row: InlineCompletionRow) => {
    if (row.kind === 'file') {
      insertFile(row.label);
      return;
    }
    if (row.kind === 'project' && onPickProject !== undefined) {
      applyTextInsert(
        (current, at, end) => ({
          value: current.slice(0, at) + current.slice(end ?? at),
          caret: at,
        }),
        inlineOpen ? inlineRangeRef.current : null,
      );
      onPickProject({ id: row.id, label: row.label });
      return;
    }
    insertTokens([
      {
        kind: row.kind,
        id: row.id,
        label: row.label,
        ...(row.seq !== undefined ? { seq: row.seq } : {}),
      },
    ]);
  };

  const insertFileAt = (path: string, range: CompletionRange | null) => {
    applyTextInsert((current, at, end) => insertFileText(current, path, at, end), range);
  };

  const insertFile = (path: string) => {
    insertFileAt(path, inlineOpen ? inlineRangeRef.current : null);
  };
  const runBuiltin = (name: BuiltinSlashName) => {
    closeSlash();
    switch (name) {
      case 'clear':
        setDraft('');
        toast.success(t('已清空'));
        break;
      case 'attach':
        openFilePicker();
        break;
      case 'mention':
        setPickerOpen(true);
        break;
      case 'review':
        slashOptions?.onReview?.();
        break;
      case 'stop':
        slashOptions?.onStop?.();
        break;
      case 'help':
        setHelpOpen(true);
        break;
    }
  };

  const insertSlashLiteral = (name: string) => {
    const range = slashRangeRef.current;
    if (range === null) return;
    closeSlash();
    pendingInsertRef.current = null;
    setDraft((current) => {
      const start = Math.max(0, Math.min(range.start, current.length));
      const end = Math.max(start, Math.min(range.end, current.length));
      const inserted = insertSlashText(current, { start, end, query: range.query }, name);
      pendingInsertRef.current = { value: inserted.value, caret: inserted.caret };
      return inserted.value;
    });
  };

  const acceptSlashRow = (row: SlashRow, via: 'enter' | 'tab') => {
    const range = slashRangeRef.current;
    if (range === null) return;
    const ta = textareaRef.current;
    const value = ta?.value ?? '';
    const action = resolveSlashAccept({
      name: row.name,
      kind: row.kind,
      atStart: isMessageStart(value, range.start),
      via,
    });
    if (action === 'run' && row.builtin !== undefined) {
      runBuiltin(row.builtin);
      return;
    }
    if (action === 'insert-token' && row.skillId !== undefined) {
      const skill = mentionGroups?.skill.find((s) => s.id === row.skillId);
      insertTokensAt([{ kind: 'skill', id: row.skillId, label: skill?.label ?? row.name }], range);
      return;
    }
    insertSlashLiteral(row.name);
  };

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const next = event.target.value;
    setDraft(next);
    if (!editable) return;
    reevaluateFromChange();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const isComposing = event.nativeEvent.isComposing;
    if (slashOpen) {
      const slashIntent = completionKeyIntent(
        { key: event.key, shiftKey: event.shiftKey, isComposing },
        { open: true, highlight: slashHighlight, matchCount: slashRows.length },
      );
      if (slashIntent.kind !== 'ignore') event.preventDefault();
      if (slashIntent.kind === 'dismiss') {
        dismissedSlashRef.current = slashRangeRef.current;
        closeSlash();
        return;
      }
      if (slashIntent.kind === 'navigate') {
        setSlashHighlight(slashIntent.index);
        return;
      }
      if (slashIntent.kind === 'accept') {
        const picked = slashRows[slashIntent.index];
        if (picked != null) {
          acceptSlashRow(picked, event.key === 'Tab' ? 'tab' : 'enter');
        }
        return;
      }
    }
    const intent = completionKeyIntent(
      { key: event.key, shiftKey: event.shiftKey, isComposing },
      { open: inlineOpen, highlight: inlineHighlight, matchCount: inlineRows.length },
    );
    if (intent.kind !== 'ignore') event.preventDefault();
    if (intent.kind === 'dismiss') {
      dismissedRangeRef.current = inlineRangeRef.current;
      closeInline();
      return;
    }
    if (intent.kind === 'navigate') {
      setInlineHighlight(intent.index);
      return;
    }
    if (intent.kind === 'accept') {
      const picked = inlineRows[intent.index];
      if (picked !== undefined) acceptInlineRow(picked);
      return;
    }
    if (event.key === 'Enter' && !isComposing) {
      if (
        event.shiftKey &&
        event.metaKey !== true &&
        event.ctrlKey !== true &&
        event.altKey !== true
      ) {
        const ta = textareaRef.current;
        if (ta != null) {
          const continued = applyOrderedListEnter(ta.value, ta.selectionStart ?? ta.value.length);
          if (continued !== null) {
            event.preventDefault();
            pendingInsertRef.current = { value: continued.value, caret: continued.caret };
            setDraft(continued.value);
            return;
          }
        }
        return;
      }
      if (!event.shiftKey) {
        event.preventDefault();
        send();
      }
    }
  };

  useEffect(() => {
    if (!inlineOpen && !slashOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target == null) return;
      const ta = textareaRef.current;
      if (ta?.contains(target)) return;
      const box = inlineListboxRef.current;
      if (box?.contains(target)) return;
      const slashBox = slashListboxRef.current;
      if (slashBox?.contains(target)) return;
      closeInline();
      closeSlash();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [inlineOpen, slashOpen, closeInline, closeSlash]);

  const groups = mentionGroups ?? EMPTY_GROUPS;

  return {
    draft,
    setDraft,
    send,
    handleChange,
    handleKeyDown,
    handleCaretMoved: reevaluate,
    handleCompositionEnd: reevaluate,
    handleBlur: () => {
      closeInline();
      closeSlash();
    },
    textareaRef,
    fileInputRef,
    openFilePicker,
    attaching,
    pendingAttachments,
    onPickFiles,
    handlePaste,
    pickerOpen,
    togglePicker: () => setPickerOpen((value) => !value),
    closePicker: () => setPickerOpen(false),
    inlineOpen,
    inlineCaret: inlineRange?.start ?? null,
    inlineQuery: inlineRange?.query ?? '',
    inlineRows,
    inlineHighlight,
    setInlineHighlight,
    inlineListboxId,
    inlineListboxRef,
    closeInline,
    acceptInlineRow,
    insertTokens,
    groups,
    slashOpen,
    slashQuery,
    slashCaret: slashRange?.start ?? null,
    slashSections,
    slashRows,
    slashHighlight,
    setSlashHighlight,
    slashListboxId,
    slashListboxRef,
    closeSlash,
    acceptSlashRow,
    helpOpen,
    closeHelp,
    helpRows,
    helpSkillCount,
  };
}
