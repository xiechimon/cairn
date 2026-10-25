// Composer (issue #56, r7 §3.4): box anchored x737 w687 h76 → min-h84
// (#860: 3-line textarea + auto-grow), placeholder
// per phase, toolbar 添加附件/AI 审核/提及 @ pitch 36, the 32×32
// send button, and the streaming stop button (r7 16). The 总管 FAB
// overlaps the send button in every capture (r7 §3.4), so the page renders
// the FAB after the composer and it covers the send pixels.
// XMON-55 P5: the stop is no longer a 14×14 bare red square — it is the send
// button's sibling (32×32, same fill, same bottom axis, 8px apart) carrying a
// 10px --stop glyph; the send lights up on the brand solid once a draft
// exists. Geometry and rationale live in detail.css.
//
// M7 #310 附件 wire 改（#625 起实现住 overlay/composer-wire 的
// useComposerWire，本文件只消费；契约不变）：
//   - draft 受控（live editable 面父持 state，附件 token 由父 setDraft 注入；
//     非 editable/fixture 静态 div 面，父不传 draft/onDraftChange → 内部
//     useState fallback，零行为差）
//   - 附件钮 = 原生文件多选触发器，选中文件 → onAttachment(files) 委托；
//     父组件负责 grant + upload + 拿到 token 后 setDraft 拼到 draft
//   - 覆盖层 chip 留 Task 6（detail 渲染面），此处只接管"选文件→返回 token"
//     的 wire，不动 textarea 几何
//
// #311: the 提及 button now opens a MentionPicker popover and the
// textarea tracks `@`-prefixed token positions to expose an inline
// agents-only listbox (r9 §3.2). Both paths route through
// insertMentionText so the picked mention lands at the caret position
// without losing focus (#625: both paths live in useComposerWire, this
// file renders the popover/inline skins). The picker is data-source
// agnostic — the caller (todo-detail-page) feeds in MentionGroups
// derived from either live REST hooks or the fixture set.

import { useLayoutEffect, useState } from 'react';
import { Button } from '../components/ui/button.js';
import { Textarea } from '../components/ui/textarea.js';
import { useI18n } from '../i18n/provider.js';
import { ArrowUp, Grid2x2, Paperclip, SearchPlus } from '../icons/index.js';
import { AttachmentStrip } from '../overlay/attachment-strip.js';
import { useComposerWire } from '../overlay/composer-wire.js';
import { type MentionGroups, MentionInline, MentionPicker } from '../overlay/mention-picker.js';
import type { FileMentionEntry } from '../overlay/mention-token.js';
import { SlashHelp, SlashMenu } from '../overlay/slash-menu.js';
import { ComposerChips } from './composer-chips.js';

// #945（detail.css 清零）：composer 卡皮肤迁 token utilities——中心列唯一
// 卡（One Card Per Screen，#366）：min-h84 + 方角 + 1px 缝线 +
// --surface-secondary 底 + --card-shadow 卡级抬升（#775 阴影管层次），
// 16px 侧/底 margin = 列 inset 律（#472 in-flow）。
const COMPOSER_CARD =
  'composer relative mx-4 mb-4 flex-none rounded-(--radius-composer) border-0 bg-(--secondary) shadow-(--shadow-composer) transition-[box-shadow] duration-[220ms] ease-(--ease-out-expo) hover:shadow-(--shadow-composer-hover) focus-within:shadow-(--shadow-composer-focus)';
// 占位行/输入行共用几何：12px/16px 内衬 + text-ui 墨（#470：一档压正文
// text-card-title）。84px 最小高走卡片本体。占位字用 ink-2：卡底是
// --secondary，ink-3 在上面不够 4.5:1（DESIGN.md 对比度条，#1442）。
const COMPOSER_PLACEHOLDER = 'px-4 pt-3 text-ui';
// 真输入面（M5 live）：48px 基高（3×16 行盒，#860）向 --composer-max-h 384px wire cap 自增
// （grow 由 useComposerWire 的 inline height 承载），内部滚动。老
// textarea.composer-input 的自定义字体栈（--font-inter + Inter/system-ui/
// PingFang SC 后备列）逐项保留——caret/镜像几何依赖它。Textarea 件底座
// 差额逐条中和：方角已同形，field-sizing 回 fixed（JS grow 律），边框/
// focus 环/暗底/过渡清零到老 UA 裸面形。
const COMPOSER_INPUT =
  "field-sizing-fixed h-12 min-h-0 max-h-(--composer-max-h) overflow-y-auto resize-none border-none bg-transparent px-4 pt-3 pb-0 [font-family:var(--font-inter),Inter,system-ui,-apple-system,'PingFang_SC','Microsoft_YaHei',sans-serif] text-ui text-(--foreground) tabular-nums transition-none outline-none placeholder:text-(--text-secondary) focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent";
// 工具钮（30px 盒，XMON-55 P5 光学左缘 10px 由 toolbar 锚承载）：ghost
// 七通道中和 + #860 hover 增亮律（tertiary → secondary，只动墨色）。
const COMPOSER_TOOL =
  'flex size-7.5 cursor-pointer items-center justify-center border-none bg-transparent p-0 text-(--text-tertiary) hover:bg-transparent hover:text-(--text-secondary) dark:hover:bg-transparent dark:hover:text-(--text-secondary) active:not-aria-[haspopup]:translate-y-0';
// 发送/停止（XMON-55 P5 同胞对：32×32、同底、同轴、8px 间隔）共享的定位/
// 盒形串——漆面（bg/text/hover）不进本串：tailwind-merge 后写者胜，共享串
// 排消费端漆面之后会压掉 --ready 态的品牌实底。idle 底 --seg-active
// （#860），停止的红只住 10px glyph。
const COMPOSER_SQUARE =
  'absolute bottom-3 flex size-8 cursor-pointer items-center justify-center rounded-[8px] border-none p-0 active:not-aria-[haspopup]:translate-y-0';

interface ComposerProps {
  placeholder: string;
  /** AI 审核 button joins the toolbar on writable review surfaces
   *  (r7 §4.1); planning shows the three base tools (r7 16). */
  aiReview: boolean;
  /** Live run: red stop square replaces the send affordance (r7 16). */
  streaming: boolean;
  /** Send click (issue #75 reject chain); absent = static capture face.
   *  M5: the text argument carries the typed draft on editable (live)
   *  faces; fixture callers ignore it. 返回 Promise = 异步发送（W3 #280
   *  steer 面：rejected 时 draft 保留不丢字）；同步 void = 发后即清（原语义）。 */
  onSend?: (text: string) => void | Promise<void>;
  /** M5 live 面：占位行换成真 textarea（同几何类名 + input 复位类；
   * fixture 面保持静态 div，DOM 不变）。 */
  editable?: boolean;
  /** M7 #310（#729 契约收窄）：附件钮选中 / 剪贴板粘贴后调
   * onAttachment(files)，父组件负责 grant + upload，返回成功文件的
   * token；注入 draft（行原子、粘贴落 caret 位）由 useComposerWire 统一
   * 做。父组件在 live 编辑面下应同时传 draft/onDraftChange 才能接住注入。 */
  onAttachment?: (files: File[]) => string[] | Promise<string[]>;
  /** M7 #310：受控 draft（live 面由父持 state，附件 token 才能注入）。 */
  draft?: string;
  onDraftChange?: (next: string) => void;
  /** #311：实体集合。live = 父级用 useMembers/useTodos/useSkills/useProjects/useMachines
   *  投影；fixture = 父级从 fixture.todos / fixture.resources 提取。
   *  缺省 = 所有分组空（弹层仍可开但只显 0 计数）。 */
  mentionGroups?: MentionGroups;
  /** #760：文件候选（`GET /api/projects/:id/files` 投影）。缺省/空 = #728
   *  agents-only 内联面，字节行为不变。 */
  mentionFiles?: FileMentionEntry[];
  /** 停止钮点击（M7 #308，r9 §3.3：确认弹层入口）；缺省 = 静态捕获面
   * （fixture 按钮不接线，DOM 字节不变）。 */
  onStop?: () => void;
  /** AI 审核钮点击（M7 #312，r8 §3.1：发起 AI 审核模态入口）；缺省 =
   * 静态捕获面（fixture 按钮不接线，DOM 字节不变）。 */
  onReview?: () => void;
}

export function Composer({
  placeholder,
  aiReview,
  streaming,
  onSend,
  editable,
  onAttachment,
  draft: draftProp,
  onDraftChange,
  mentionGroups,
  mentionFiles,
  onStop,
  onReview,
}: ComposerProps) {
  const { t } = useI18n();
  // #625：输入逻辑层单源——draft / 发送（异步被拒保留 draft）/ 提及双路 /
  // 附件选件 wire 全住 overlay/composer-wire 的 useComposerWire，chief 抽屉
  // 消费同一 hook；本文件只剩 detail 皮肤（节点、几何、工具条三钮）。
  const {
    draft,
    send,
    handleChange,
    handleKeyDown,
    handleCaretMoved,
    handleCompositionEnd,
    handleBlur,
    textareaRef,
    fileInputRef,
    openFilePicker,
    attaching,
    pendingAttachments,
    onPickFiles,
    handlePaste,
    pickerOpen,
    togglePicker,
    closePicker,
    inlineOpen,
    inlineCaret,
    inlineQuery,
    inlineRows,
    inlineHighlight,
    setInlineHighlight,
    inlineListboxId,
    inlineListboxRef,
    insertToken,
    insertTokens,
    insertFile,
    groups,
    // #731 `/` slash completion: availability mirrors the toolbar buttons'
    // own display conditions (a command with no live action is omitted,
    // never a dead row).
    slashOpen,
    slashQuery,
    slashCaret,
    slashSections,
    slashHighlight,
    setSlashHighlight,
    slashListboxId,
    slashListboxRef,
    acceptSlashRow,
    helpOpen,
    closeHelp,
    helpRows,
    helpSkillCount,
  } = useComposerWire({
    editable,
    draft: draftProp,
    onDraftChange,
    onSend,
    onAttachment,
    mentionGroups,
    mentionFiles,
    slash: {
      reviewAvailable: aiReview && onReview !== undefined,
      stopAvailable: streaming && onStop !== undefined,
      ...(onReview !== undefined ? { onReview } : {}),
      ...(onStop !== undefined ? { onStop } : {}),
    },
    // #860: textarea follows the content up to 6 lines (16px), scrolling
    // internally beyond it; the card rides min-height (detail.css).
    growCap: 384,
  });

  const [multiLine, setMultiLine] = useState(false);
  useLayoutEffect(() => {
    const ta = textareaRef.current;
    if (ta == null) {
      setMultiLine(false);
      return;
    }
    const trailingBlank = draft.length - draft.replace(/\n+$/, '').length;
    const measure = () => {
      const cs = getComputedStyle(ta);
      const visualLines = Math.floor(
        (ta.scrollHeight - Number.parseFloat(cs.paddingTop)) / Number.parseFloat(cs.lineHeight),
      );
      setMultiLine(visualLines - trailingBlank >= 2);
    };
    measure();
    let width = ta.clientWidth;
    const observer = new ResizeObserver(() => {
      if (ta.clientWidth === width) return;
      width = ta.clientWidth;
      measure();
    });
    observer.observe(ta);
    return () => observer.disconnect();
  }, [draft, textareaRef]);

  return (
    <div
      className={`${COMPOSER_CARD} min-h-21 ${multiLine ? 'pb-12' : ''}`}
      data-testid="composer-card"
    >
      {editable ? (
        <div>
          {/* #728 combobox wiring: while the inline listbox is open the
              textarea announces itself as the combobox and points
              aria-activedescendant at the highlighted row — it keeps DOM
              focus the whole time (the listbox rows are non-focusable).
              keyup/click/select re-judge the token after caret-only moves
              (a change event never fires for those).
              #945：裸 textarea 收编 components/ui Textarea（#851 账）——
              皮肤差额全在 COMPOSER_INPUT 中和串，wire 的 ref/grow/键盘链
              原样直通。 */}
          <Textarea
            ref={textareaRef}
            className={`composer-placeholder composer-input ${COMPOSER_INPUT}`}
            placeholder={t(placeholder)}
            value={draft}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            // #729: clipboard images/files ride the #310 attachFile chain;
            // a text-only paste never reaches the handler's preventDefault.
            onPaste={handlePaste}
            onKeyUp={handleCaretMoved}
            onClick={handleCaretMoved}
            onSelect={handleCaretMoved}
            onCompositionEnd={handleCompositionEnd}
            onBlur={handleBlur}
            {...(inlineOpen
              ? {
                  role: 'combobox',
                  'aria-expanded': true,
                  'aria-controls': inlineListboxId,
                  'aria-autocomplete': 'list' as const,
                }
              : {})}
            {...(inlineOpen && inlineHighlight != null
              ? { 'aria-activedescendant': `${inlineListboxId}-opt-${inlineHighlight}` }
              : {})}
          />
          <MentionInline
            open={inlineOpen}
            rows={inlineRows}
            caret={inlineCaret}
            query={inlineQuery}
            highlight={inlineHighlight}
            onHover={setInlineHighlight}
            onPick={(row) => {
              if (row.kind === 'file') {
                insertFile(row.label);
              } else {
                // #848: every entity kind inserts through serializeMention.
                insertToken({
                  kind: row.kind,
                  id: row.id,
                  label: row.label,
                  ...(row.seq !== undefined ? { seq: row.seq } : {}),
                });
              }
            }}
            listboxRef={inlineListboxRef}
            listboxId={inlineListboxId}
          />
          {/* #731 `/` slash menu: same combobox anchor/geometry as the `@`
              listbox above. Click = Enter-with-highlight semantics. */}
          <SlashMenu
            open={slashOpen}
            sections={slashSections.map((s) => ({
              title: s.section === 'builtin' ? t('命令') : t('技能'),
              rows: s.rows,
            }))}
            caret={slashCaret}
            query={slashQuery}
            highlight={slashHighlight}
            onHover={setSlashHighlight}
            onPick={(row) => acceptSlashRow(row, 'enter')}
            listboxRef={slashListboxRef}
            listboxId={slashListboxId}
          />
        </div>
      ) : (
        <div
          className={`composer-placeholder ${COMPOSER_PLACEHOLDER} text-(--text-secondary)`}
          data-testid="composer-placeholder"
        >
          {t(placeholder)}
        </div>
      )}
      {/* #757 附件 strip + #812 提及 strip：同一浮列挂盒外上方（盒底沿
          min-84 起随内容增高，浮列与 listbox 同锚无布局位移）。共列即天然上下叠放，
          两面永不互盖；各 strip 空时零节点，列空即零高度不绘制。
          #948：浮列定位规则自 attachment-strip.css 迁入（该文件退役）——
          局部 z30 沿旧值（composer 内部层级，#688 阶梯外）；chips 的 static
          覆写带 !：detail.css 的 .composer-chips{position:absolute} 是
          unlayered 规则，layered utility 常态压不过（#688 层序教训），过渡期
          用 important 顶住，detail.css 清零（#945）后 `!` 可降级；strip 的
          pointer-events auto 复原预览点击（列本身永不拦截）。 */}
      <div
        data-testid="composer-float"
        className="pointer-events-none absolute inset-x-0 bottom-[calc(100%+6px)] z-30 flex flex-col gap-1.5 [&>.attachment-strip]:pointer-events-auto [&>.composer-chips]:static!"
      >
        <ComposerChips draft={draft} files={mentionFiles} suspended={inlineOpen || slashOpen} />
        <AttachmentStrip draft={draft} pending={pendingAttachments} />
      </div>
      {/* deliberate-native（#855）：隐藏的文件选择触发器（display:none，
          编程式打开），可见皮肤在附件 Button 上；Input 原语是可见输入框皮肤，
          此处无可收编之物。 */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={onPickFiles}
        // 客户端 mime 守门（与服务层 ALLOWED_MIME_* 镜像）；note accept 只是
        // hint，用户 OS 文件选择器仍可给其他类型，最终由 server 强拒兜底。
        accept="text/*,image/*,application/json,application/pdf,application/xml"
      />
      {/* XMON-55 P5 光学左缘 10px（纸夹墨迹对齐 placeholder 首字符）；
          bottom 12 与 send/stop 同轴（cy 687）。 */}
      <div
        className="composer-toolbar absolute bottom-3 left-2.5 flex items-center"
        data-testid="composer-toolbar"
      >
        {/* #304 C5 裁决:语音输入功能不做(local-first 无语音面)——原站
            首钮移除不渲染,不留死钮;添加附件/AI 审核/提及原样。
            XMON-24 三工具钮 shadcn ghost 底座不变；#945 皮肤从
            .composer-tool per-face 迁 COMPOSER_TOOL 中和串；附件钮可
            disabled，老面无禁用降档（无 :disabled 规则）→ opacity/
            pointer-events 双双中性化；svg 免底座强制 16px（图标默认
            18px 属性）。 */}
        <Button
          variant="ghost"
          className={`composer-tool ${COMPOSER_TOOL} mr-1.5 font-normal disabled:pointer-events-auto disabled:opacity-100 [&_svg:not([class*='size-'])]:size-auto`}
          aria-label={t('添加附件')}
          disabled={attaching || !onAttachment}
          onClick={openFilePicker}
        >
          <Paperclip width={16} height={16} />
        </Button>
        {aiReview && (
          <Button
            variant="ghost"
            className={`composer-tool ${COMPOSER_TOOL} mr-1.5 font-normal [&_svg:not([class*='size-'])]:size-auto`}
            aria-label={t('AI 审核')}
            onClick={onReview}
          >
            <SearchPlus width={16} height={16} />
          </Button>
        )}
        <Button
          variant="ghost"
          className={`composer-tool ${COMPOSER_TOOL} mr-1.5 font-normal [&_svg:not([class*='size-'])]:size-auto`}
          aria-label={t('提及')}
          onClick={togglePicker}
        >
          <Grid2x2 width={16} height={16} />
        </Button>
      </div>
      {streaming && (
        // XMON-24 停止钮 shadcn ghost 底座不变；#945 漆底/定位/尺寸迁
        // utilities（right 53 = send right 13 + width 32 + gap 8，XMON-55
        // P5 同胞律）；红只住 10px glyph（--stop 墨）。
        <Button
          variant="ghost"
          className={`composer-stop ${COMPOSER_SQUARE} right-13 bg-(--seg-active) text-(--destructive) hover:bg-(--seg-active) hover:text-(--destructive) dark:hover:bg-(--seg-active) dark:hover:text-(--destructive) [&_svg:not([class*='size-'])]:size-auto`}
          aria-label={t('停止')}
          onClick={onStop}
        >
          <span className="size-2.5 rounded-[2px] bg-current" />
        </Button>
      )}
      {/* XMON-24 发送钮 shadcn ghost 底座不变；#945 漆底/过渡钉迁
          utilities——过渡只动 bg/color 两属性、150ms cubic-bezier(0.2,0,
          0,1)（逐键状态不抢注意力，better-ui 动效克制）；draft 在场翻
          --card-button 品牌实底（XMON-55 P5「有东西可发」可见化）。
          ArrowUp 属性 14px，svg 免底座强制 16px。 */}
      <Button
        variant="ghost"
        className={`composer-send ${COMPOSER_SQUARE} right-3 transition-[background-color,color] duration-(--dur-fast) ease-[cubic-bezier(0.2,0,0,1)] ${
          draft.trim() === ''
            ? 'bg-(--seg-active) text-(--text-tertiary) hover:bg-(--seg-active) hover:text-(--text-tertiary) dark:hover:bg-(--seg-active) dark:hover:text-(--text-tertiary)'
            : 'bg-(--card-button) text-(--text-on-accent) hover:bg-(--card-button) hover:text-(--text-on-accent) dark:hover:bg-(--card-button) dark:hover:text-(--text-on-accent)'
        } [&_svg:not([class*='size-'])]:size-auto`}
        aria-label={t('发送')}
        onClick={send}
      >
        <ArrowUp width={14} height={14} />
      </Button>
      <MentionPicker
        open={pickerOpen}
        onClose={closePicker}
        groups={groups}
        onInsert={(tokens) => {
          insertTokens(tokens);
          closePicker();
        }}
      />
      {/* #731 `/help` panel: read-only FloatingShell over the available
          builtins. */}
      <SlashHelp
        open={helpOpen}
        onClose={closeHelp}
        commands={helpRows}
        skillCount={helpSkillCount}
      />
    </div>
  );
}
