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
import { reportFailedSend } from '../lib/report-failed-send.js';
import {
  createPastedNameCounter,
  filesFromClipboardData,
  joinDraft,
  type PastedNameCounter,
  type PendingAttachment,
  preparePastedFiles,
  splitDraft,
  takeAttachmentErrorReason,
} from './attachment-paste.js';
import {
  type CompletionRange,
  completionKeyIntent,
  detectCompletionToken,
  MENTION_COMPLETION_SPEC,
} from './completion.js';
import {
  createMentionRegistry,
  insertMentionDisplay,
  type MentionRegistry,
  toDisplay,
  toWire,
} from './mention-display.js';
import {
  buildInlineRows,
  type FileMentionEntry,
  type InlineCompletionRow,
  insertFileText,
  type MentionGroups,
  type MentionToken,
} from './mention-token.js';
import {
  applyOrderedListBackspace,
  applyOrderedListEnter,
  findListMarkers,
  lineStartAt,
} from './ordered-list.js';
import { usePendingAttachments } from './pending-attachments.js';

export interface ComposerWireOptions {
  editable?: boolean;
  draft?: string;
  onDraftChange?: (next: string) => void;
  onSend?: (text: string) => void | Promise<void>;
  onQueue?: (text: string) => void | Promise<void>;
  onStopAndSend?: (text: string) => void | Promise<void>;
  onAttachment?: (files: File[]) => string[] | Promise<string[]>;
  mentionGroups?: MentionGroups;
  mentionFiles?: FileMentionEntry[];
  stop?: {
    available: boolean;
    onStop?: () => void;
  };
  growCap?: number;
  active?: boolean;
  onPickProject?: (project: { id: string; label: string }) => void;
}

export interface ComposerWire {
  draft: string;
  setDraft: Dispatch<SetStateAction<string>>;
  tokens: string[];
  removeToken: (index: number) => void;
  send: () => void;
  queue: () => void;
  handleChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  handleKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  handleCaretMoved: () => void;
  handleCompositionStart: () => void;
  handleCompositionEnd: () => void;
  handleCompositionCancel: () => void;
  suppressedListLines: ReadonlySet<number> | null;
  handleBlur: () => void;
  textareaRef: MutableRefObject<HTMLTextAreaElement | null>;
  fileInputRef: RefObject<HTMLInputElement | null>;
  openFilePicker: () => void;
  attachFiles: (files: File[]) => void;
  dismissPending: (uid: string) => void;
  attaching: boolean;
  pendingAttachments: PendingAttachment[];
  onPickFiles: (event: ChangeEvent<HTMLInputElement>) => void;
  handlePaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  inlineOpen: boolean;
  inlineCaret: number | null;
  inlineQuery: string;
  inlineRows: InlineCompletionRow[];
  inlineHighlight: number | null;
  setInlineHighlight: (index: number | null) => void;
  inlineListboxId: string;
  inlineListboxRef: RefObject<HTMLDivElement | null>;
  acceptInlineRow: (row: InlineCompletionRow) => void;
  mentionRegistry: MentionRegistry;
}

function sameRange(a: CompletionRange, b: CompletionRange): boolean {
  return a.start === b.start && a.end === b.end && a.query === b.query;
}

export function useComposerWire(options: ComposerWireOptions): ComposerWire {
  const {
    editable = false,
    draft: draftProp,
    onDraftChange,
    onSend,
    onQueue,
    onStopAndSend,
    onAttachment,
    mentionGroups,
    mentionFiles,
    stop: stopOptions,
    growCap,
    active = true,
    onPickProject,
  } = options;

  const [internalDraft, setInternalDraft] = useState('');
  const controlled = draftProp !== undefined && onDraftChange !== undefined;
  const staticFace = draftProp !== undefined && onDraftChange === undefined;
  const wireDraft = controlled || staticFace ? (draftProp as string) : internalDraft;
  const registryRef = useRef<MentionRegistry | null>(null);
  if (registryRef.current === null) registryRef.current = createMentionRegistry();
  const registry = registryRef.current;
  const fullDraft = useMemo(() => toDisplay(wireDraft, registry), [wireDraft, registry]);
  const { tokens, text: draft } = useMemo(() => splitDraft(fullDraft), [fullDraft]);
  const writeFull = (display: string) => {
    if (staticFace) return;
    fullDraftRef.current = display;
    const parts = splitDraft(display);
    draftRef.current = parts.text;
    tokensRef.current = parts.tokens;
    const wire = toWire(display, registry);
    if (controlled) (onDraftChange as (value: string) => void)(wire);
    else setInternalDraft(wire);
  };
  const setDraft: Dispatch<SetStateAction<string>> = (next) => {
    const text = typeof next === 'function' ? next(draftRef.current) : next;
    writeFull(joinDraft(tokensRef.current, text));
  };
  const removeToken = (index: number) => {
    writeFull(
      joinDraft(
        tokensRef.current.filter((_, i) => i !== index),
        draftRef.current,
      ),
    );
  };

  const prevWireDraftRef = useRef(wireDraft);
  const draftRef = useRef(draft);
  const tokensRef = useRef(tokens);
  const fullDraftRef = useRef(fullDraft);
  if (wireDraft !== prevWireDraftRef.current) {
    prevWireDraftRef.current = wireDraft;
    draftRef.current = draft;
    tokensRef.current = tokens;
    fullDraftRef.current = fullDraft;
  }
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const inlineListboxRef = useRef<HTMLDivElement | null>(null);
  const [attaching, setAttaching] = useState(false);
  const {
    pending: pendingAttachments,
    track: trackPending,
    untrack: untrackPending,
    fail: failPending,
    clearFailed: clearFailedPending,
  } = usePendingAttachments();

  const [inlineRange, setInlineRange] = useState<CompletionRange | null>(null);
  const inlineRangeRef = useRef<CompletionRange | null>(null);
  const dismissedRangeRef = useRef<CompletionRange | null>(null);
  const [inlineHighlight, setInlineHighlight] = useState<number | null>(null);
  const inlineListboxId = useId();
  const entityCount =
    (mentionGroups?.agent.length ?? 0) +
    (mentionGroups?.skill.length ?? 0) +
    (mentionGroups?.project.length ?? 0) +
    (mentionGroups?.machine.length ?? 0);
  const fileCount = mentionFiles?.length ?? 0;
  const inlineOpen = inlineRange !== null && entityCount + fileCount > 0;

  const pastedNameCounterRef = useRef<PastedNameCounter | null>(null);
  if (pastedNameCounterRef.current === null)
    pastedNameCounterRef.current = createPastedNameCounter();
  const attachInFlightRef = useRef(0);

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
    }
    inlineRangeRef.current = next;
    setInlineRange(next);
    setInlineHighlight(null);
  }, []);

  const closeInline = useCallback(() => {
    applyRange(null);
  }, [applyRange]);

  const reevaluate = useCallback(() => {
    if (!editable) return;
    const ta = textareaRef.current;
    if (ta == null) return;
    const caret = ta.selectionStart ?? ta.value.length;
    applyRange(detectCompletionToken(ta.value, caret, MENTION_COMPLETION_SPEC));
  }, [editable, applyRange]);

  const reevaluateFromChange = useCallback(() => {
    dismissedRangeRef.current = null;
    reevaluate();
  }, [reevaluate]);

  const inlineRows: InlineCompletionRow[] = useMemo(() => {
    if (inlineRange === null || mentionGroups == null) return [];
    return buildInlineRows(inlineRange.query, mentionGroups, mentionFiles);
  }, [inlineRange, mentionGroups, mentionFiles]);

  const escapeAt = useRef<number | null>(null);
  const composingRef = useRef(false);
  const [suppressedListLines, setSuppressedListLines] = useState<ReadonlySet<number> | null>(null);
  const resetComposition = useCallback(() => {
    composingRef.current = false;
    setSuppressedListLines(null);
  }, []);
  const sending = useRef(false);
  const sendAfterUploadRef = useRef<typeof onSend>(undefined);
  const uploadFailedRef = useRef(false);
  const submit = (callback: typeof onSend) => {
    if (attachInFlightRef.current > 0) {
      sendAfterUploadRef.current = callback;
      return;
    }
    if (sending.current) return;
    const fullDraft = fullDraftRef.current;
    const text = toWire(fullDraft, registry).trim();
    if (text === '' && !editable) {
      callback?.(text);
      return;
    }
    if (text === '' || callback === undefined) return;
    let result: ReturnType<typeof callback>;
    try {
      result = callback(text);
    } catch (error) {
      reportFailedSend(error, null);
      return;
    }
    if (result instanceof Promise) {
      sending.current = true;
      void result
        .then(() => {
          clearFailedPending();
          if (fullDraftRef.current === fullDraft) writeFull('');
        })
        .catch((error) => {
          setTimeout(() => reportFailedSend(error, error), 0);
        })
        .finally(() => {
          sending.current = false;
        });
    } else {
      clearFailedPending();
      writeFull('');
    }
  };

  const send = () => submit(onSend);
  const queue = () => submit(onQueue);

  const openFilePicker = () => fileInputRef.current?.click();

  const runAttachment = (files: File[], also?: () => void) => {
    if (!onAttachment) {
      also?.();
      return;
    }
    if (attachInFlightRef.current === 0) uploadFailedRef.current = false;
    attachInFlightRef.current += 1;
    setAttaching(true);
    const pendingUids = trackPending(files);
    const uploadOne = async (file: File, uid: string) => {
      const tokens = await Promise.resolve(onAttachment([file])).catch((err: unknown) => {
        console.error('attachment delegate failed', err);
        return [] as string[];
      });
      if (tokens.length === 0) {
        uploadFailedRef.current = true;
        failPending(uid, takeAttachmentErrorReason(file));
        return;
      }
      writeFull(joinDraft([...tokensRef.current, ...tokens], draftRef.current));
      untrackPending([uid]);
    };
    void files
      .reduce(
        (chain, file, index) => chain.then(() => uploadOne(file, pendingUids[index] ?? '')),
        Promise.resolve(),
      )
      .finally(() => {
        attachInFlightRef.current = Math.max(0, attachInFlightRef.current - 1);
        if (attachInFlightRef.current === 0) setAttaching(false);
        also?.();
        const deferred = sendAfterUploadRef.current;
        if (attachInFlightRef.current === 0 && deferred !== undefined) {
          sendAfterUploadRef.current = undefined;
          if (!uploadFailedRef.current) submit(deferred);
        }
      });
  };

  const onPickFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) return;
    runAttachment(files);
  };

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (!onAttachment) return;
    const files = filesFromClipboardData(event.clipboardData);
    if (files.length === 0) return;
    event.preventDefault();
    closeInline();
    const counter = pastedNameCounterRef.current as PastedNameCounter;
    counter.begin(draftRef.current.trim() === '');
    runAttachment(preparePastedFiles(files, counter), () => counter.end());
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
    if (growCap == null || !active) return;
    const ta = textareaRef.current;
    if (ta == null) return;
    const grow = () => {
      ta.style.height = '';
      const grown = Math.min(ta.scrollHeight, growCap);
      if (grown > ta.clientHeight) ta.style.height = `${grown}px`;
    };
    grow();
    let width = ta.clientWidth;
    const observer = new ResizeObserver(() => {
      if (ta.clientWidth === width) return;
      width = ta.clientWidth;
      grow();
    });
    observer.observe(ta);
    return () => observer.disconnect();
  }, [draft, growCap, active]);

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
        const result = insertMentionDisplay(value, token, registry, caret, rest);
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
      },
    ]);
  };

  const insertFileAt = (path: string, range: CompletionRange | null) => {
    applyTextInsert((current, at, end) => insertFileText(current, path, at, end), range);
  };

  const insertFile = (path: string) => {
    insertFileAt(path, inlineOpen ? inlineRangeRef.current : null);
  };
  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    if ((event.nativeEvent as InputEvent | undefined)?.isComposing === false) {
      resetComposition();
    }
    const next = event.target.value;
    setDraft(next);
    if (!editable) return;
    reevaluateFromChange();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const isComposing = event.nativeEvent.isComposing || composingRef.current;
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
    if (
      event.key === 'Escape' &&
      (isComposing || event.repeat) &&
      (stopOptions?.available || escapeAt.current !== null)
    ) {
      if (!isComposing) event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.key === 'Escape' && !isComposing && !event.repeat) {
      const now = Date.now();
      const secondEscape = escapeAt.current !== null && now - escapeAt.current <= 500;
      if (secondEscape && onStopAndSend !== undefined) {
        event.preventDefault();
        event.stopPropagation();
        escapeAt.current = null;
        submit(onStopAndSend);
        return;
      }
      if (stopOptions?.available && stopOptions.onStop !== undefined) {
        event.preventDefault();
        event.stopPropagation();
        escapeAt.current = now;
        stopOptions.onStop();
        return;
      }
    } else if (event.key !== 'Escape') {
      escapeAt.current = null;
    }
    if (
      event.key === 'Backspace' &&
      !isComposing &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey
    ) {
      const ta = textareaRef.current;
      if (ta != null && (ta.selectionStart ?? 0) === (ta.selectionEnd ?? 0)) {
        const cut = applyOrderedListBackspace(ta.value, ta.selectionStart ?? 0);
        if (cut !== null) {
          event.preventDefault();
          pendingInsertRef.current = { value: cut.value, caret: cut.caret };
          setDraft(cut.value);
          return;
        }
      }
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
        submit((event.metaKey || event.ctrlKey) && onQueue !== undefined ? onQueue : onSend);
      }
    }
  };

  useEffect(() => {
    if (!inlineOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target == null) return;
      const ta = textareaRef.current;
      if (ta?.contains(target)) return;
      const box = inlineListboxRef.current;
      if (box?.contains(target)) return;
      closeInline();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [inlineOpen, closeInline]);

  const handleCompositionStart = useCallback(() => {
    composingRef.current = true;
    const ta = textareaRef.current;
    if (ta == null) return;
    const start = lineStartAt(ta.value, ta.selectionStart ?? ta.value.length);
    const hasMarker = findListMarkers(ta.value).some((marker) => marker.lineStart === start);
    if (!hasMarker) setSuppressedListLines(new Set([start]));
  }, []);

  const endComposition = useCallback(() => {
    resetComposition();
    reevaluate();
  }, [resetComposition, reevaluate]);

  const handleBlur = useCallback(() => {
    closeInline();
    resetComposition();
  }, [closeInline, resetComposition]);

  useEffect(() => {
    const onCompositionCancel = (event: Event) => {
      if (event.target === textareaRef.current) {
        endComposition();
      }
    };
    window.addEventListener('blur', resetComposition);
    document.addEventListener('visibilitychange', resetComposition);
    document.addEventListener('compositioncancel', onCompositionCancel, true);
    return () => {
      window.removeEventListener('blur', resetComposition);
      document.removeEventListener('visibilitychange', resetComposition);
      document.removeEventListener('compositioncancel', onCompositionCancel, true);
    };
  }, [resetComposition, endComposition]);

  return {
    draft,
    setDraft,
    tokens,
    removeToken,
    send,
    queue,
    handleChange,
    handleKeyDown,
    handleCaretMoved: reevaluate,
    handleCompositionStart,
    handleCompositionEnd: endComposition,
    handleCompositionCancel: endComposition,
    suppressedListLines,
    handleBlur,
    textareaRef,
    fileInputRef,
    openFilePicker,
    attachFiles: (files: File[]) => {
      if (files.length > 0) runAttachment(files);
    },
    dismissPending: (uid: string) => untrackPending([uid]),
    attaching,
    pendingAttachments,
    onPickFiles,
    handlePaste,
    inlineOpen,
    inlineCaret: inlineRange?.start ?? null,
    inlineQuery: inlineRange?.query ?? '',
    inlineRows,
    inlineHighlight,
    setInlineHighlight,
    inlineListboxId,
    inlineListboxRef,
    acceptInlineRow,
    mentionRegistry: registry,
  };
}
