# Empty-state and arrival art: where the brand moment lives after history accumulates

Date: 2026-11-17. Question: how do chat/agent products handle their signature empty-state / arrival / brand illustration once a conversation accumulates history?

Evidence tags: `实测` = read or operated firsthand (this repo's captures and screenshots count); `推断` = derived from firsthand evidence; `猜测` = unverified.

## What cairn does today (`实测`, this repo)

- The ink spiral is an overlay on the Coordinator home, rendered only while the global channel has never had a turn: `!narrow && fallbackOnly && projectId === null && archived === null` in `apps/web/src/board/home-c.tsx:582-584`. `fallbackOnly` means the stream holds only the client-synthesized greeting (`home-c.tsx:287-289`), gated by `chiefFresh` (`apps/web/src/chief/use-chief-surface.ts:319-322`). It also hides below 700px window height (`home-spiral.tsx:69`).
- The Coordinator channel is one persistent thread per scope (global, plus one per project; `docs/design/coordinator-project-channels.md`). The first owner message retires the moment permanently — once-ever, not per-session.
- The spiral is also navigation: up to six project hangs plus a `新建项目` tail (`home-spiral.tsx`, `SPIRAL_MAX_PROJECTS = 6`). The project picker dies with the empty state.
- Rule V16 (`apps/web/DESIGN.md` rule index, owner 2026-11-16) reserves ink grain for exactly two surfaces — the empty Coordinator home and the first-run welcome side (`first-run-setup.tsx:490-495`) — enforced by `apps/web/test/anti-slop-foundations.test.ts:54-61`, an allow-list of files containing `<InkSpiral`. V16 gates *where grain may appear*, not that it must appear only once.
- Already in the tree, unused for this: `ChiefConversation` has a `lead` slot rendered at the very top of `MessageScrollerContent` (`chief-conversation.tsx:217,658`) plus unused `hero`/`below`/`heroCollapsed`/`day` props; `EarlierLoader` auto-loads earlier pages when `scrollTop <= 200` (`components/chat/earlier-loader.tsx`); `chiefData.hasEarlier === false` means the true beginning is loaded (`use-chief-surface.ts:244,256`); `TranscriptColumn` + `ThreadLead` already implement a scrollback-top reveal in task threads (`side-chat.tsx:446-453`, `showSpec={!chat.hasEarlier}`).
- `EmptyState.media` exists (`components/empty-state.tsx:11`) but no production caller passes the designed `SpiralMark` texture (`docs/design/surfaces/chrome.md`; `components/texture/texture.tsx:223` is used only under `design/`).
- A small brand mark survives history today: `ChiefStatusMark` floats top-center (`home-c.tsx:581`); `BrandGlyph`/`ChiefSpiralFace` carry the mark in sidebar and avatars (`DESIGN.md:149-154`).

## Comparison

| Source | How it does it | Trade-offs | Link |
|---|---|---|---|
| Claude.ai (named reference) | Ephemeral: every New chat resets to "Good evening, {name}" + spark + composer + quiet artifact strip. The moment recurs for free because each chat starts empty. Repo captures `docs/design/references/coordinator-chat/` and `claude-ai-spec.md` are `实测`. | Zero cost per return; impossible under a persistent thread | repo files; greeting strings scraped from claude.ai JS: https://gist.github.com/Posandu/e97d3cd20a671749ce7162a2a4f51fee (`推断`) |
| ChatGPT | Ephemeral: each New chat shows a rotating one-liner ("What can I help with?", "Ready when you are.") with suggested prompts before the first message | Same as Claude.ai | https://assets.nextleap.app/submissions/ProductTeardown-ChatGPTSuggestedPrompts-63ff7cb5-aaf5-48fb-bd73-9f8bab35c75f.pdf (`推断`); clone teardown describing observed rotation https://www.vibecodeapp.com/templates/chatgpt-web (`猜测`) |
| Gemini | Ephemeral: rotating greeting ("the mic is yours", "Where should we start?") changes each restart; suggestion chips | Same | https://www.androidauthority.com/gemini-app-android-redesign-3668250/ (`推断`; their teardown, not ours) |
| Perplexity | Ephemeral: "What do you want to know?" — the composer is the entire empty state; recurs per new thread | Same | https://swipefile.design/ref/perplexity-chat/ (`推断`) |
| Slack | Persistent: "This is the very beginning of the #channel channel" intro block (creator, date, description, invite CTA) sits permanently at scrollback top | Reachable forever, but costs a scroll-up through all history; the marker doubles as channel metadata | firsthand scroll https://www.mtioutput.com/entry/slack-move-head (`实测`); description placement https://slack.green/en/blog/slack-channel-topic-vs-description (`实测`); https://oh-my-design.kr/design-systems/slack (`推断`) |
| Discord | Persistent: "Welcome to #channel! / This is the start of the #channel channel." header block (big # icon, description, Edit channel) permanently tops every channel history; Wumpus illustrations on true-empty states; a spinning-Clyde splash marks cold app launch — on the launch surface, not in chat | Same scroll-up cost; per-cold-open brand moment exists but lives outside the conversation | reimplementation shows the header rendered unconditionally at list top https://github.com/spacebarchat/client (`实测`); https://oh-my-design.kr/design-systems/discord (`推断`); spinning-Clyde launch animation https://support.discord.com/hc/en-us/articles/360040613412 (`实测` doc) |
| WhatsApp | Persistent: the end-to-end-encryption notice card tops every chat forever | Marker is informational, not decorative | https://talklio.app/guides/end-to-end-encrypted-message-meaning (`实测`); https://sotvo.app/guides/what-does-encrypted-message-mean/ (`实测`) |
| Telegram | Persistent: "Channel created" service message is the first row of channel history (`ChatService.ChannelCreated`) | Minimal: one grey line, no art | https://github.com/TelegramMessenger/Telegram-iOS Localizable.strings (`实测`); https://translations.telegram.org (`实测`) |
| iMessage | Persistent: nothing at the top but a date/time header — no brand or "beginning" marker | The null example: a persistent chat can also mark nothing | https://www.macobserver.com/iphone/see-first-message-imessage-without-scrolling/ (`推断`); https://terachat.co/blog/how-to-see-the-first-message-in-a-chat/ (`推断`) |
| Claude Duet (closest structural twin) | Persistent "Everything" thread — the model cairn's Coordinator follows; nothing public shows an arrival or scrollback illustration | Our closest reference ships no documented answer to this question | `docs/design/duet-shaped-clients.md` (Read/Seen); https://support.claude.com/en/articles/17631495-get-started-with-claude-duet (`推断`) |
| Amp (named reference) | Empty thread = composer carrying the missing state ("Connect a machine" chip + exact command); no illustration anywhere | Brand carried by function, not art; recurs because threads are ephemeral | repo `docs/design/references/README.md` first-run (`实测`); https://ampcode.com/manual (`实测` in repo notes) |
| t3code (named reference) | "No threads yet" one-line empty sidebar; empty pages = icon + one sentence + one action; no brand art | Same as Amp | repo references thread-list-sidebar/settings (`实测`) |
| Linear | Empty views recur (inbox zero, no matching issues, empty roadmaps): quiet line + link, a few carry an illustration | Brand art attaches to surfaces that re-empty, not to a once-ever moment | https://www.saasui.design/pattern/empty-state/linear (`实测` captures); https://www.northbase.design/systems/linear/empty-states (`推断`) |
| Todoist / Things 3 | Todoist: "All clear" illustrated empty state per view (Inbox, Today) — re-earned whenever a view empties. Things 3: evidence found is publisher previews only | Illustration as a recurring reward for clearing a surface | https://medium.com/design-bootcamp/todoist-reviewed-30e951e6de18 (`推断`); Things 3 specific claims `猜测` |

## The pattern that fits cairn, and why

Three mechanisms cover the field:

1. **Ephemeral-chat products recur the moment for free** — the empty state is the start of a new conversation, so the greeting/illustration returns on every new chat. Cairn cannot copy this: its Coordinator thread is permanent by accepted design (`coordinator-project-channels.md`), and its greeting is already a real stored turn.
2. **Persistent-channel products park the moment at the beginning of scrollback** — Slack's "very beginning" block, Discord's "Welcome to #channel" header, WhatsApp's encryption card, Telegram's "Channel created" all sit at the top of history, reachable by scrolling to the true start. No mainstream product replays a brand moment inside a populated transcript or overlays it per session; cold-open brand moments (Discord's Clyde, Slack's loading quips) live on the app-launch surface only.
3. **Brand art that recurs attaches to surfaces that re-empty** — Linear inbox zero, Todoist "All clear". Cairn has those surfaces (no projects, no threads, keys, usage) and already has unused art for them (`SpiralMark`, `EmptyState.media`).

So: the scrollback-top "beginning" marker is the only mainstream pattern that survives history in a persistent conversation — and cairn already ships the mechanics (`lead` slot, `hasEarlier === false`, the `ThreadLead` precedent).

## Candidate directions

| Option | Precedent | Fit for cairn |
|---|---|---|
| (a) Spiral as scrollback-top header, revealed when all history is loaded | Slack, Discord, WhatsApp; internally `ThreadLead` does exactly this | Strong. Keeps the once-ever overlay for the truly-empty home and adds a reachable "very beginning" with the project hangs intact; zero noise — visible only at scroll-to-top |
| (b) Transient arrival overlay on each cold open | Discord splash / Slack quips — but only on app launch, never inside a conversation | Weak. Novel inside a chat; delays the "what is waiting for me" read that is the home's job; collides with greeting and status mark |
| (c) Spiral pinned beside the chat column on wide viewports | None among the references | Weak. Permanent decoration against "clear and simple"; exists only in ultrawide gutters |
| (d) Status quo; `BrandGlyph`/status mark carries the brand after | iMessage is the null precedent | Defensible but wastes the asset: the illustration *and* its project-nav function become unreachable to every existing user |
| (e) Brand art on re-emptying surfaces (`SpiralMark` on `EmptyState.media`: no projects, no threads, keys, usage) | Linear, Todoist | Real complement, not a substitute — doesn't touch the Coordinator moment. Project channels are deliberately bare by owner decision (`coordinator-project-channels.md:57`) |

## Recommendation

Adopt **(a)** — a "beginning of the conversation" mark at the top of the global Coordinator scrollback — with **(e)** as a cheap second step already sanctioned by `DESIGN.md:410`.

- Render through the existing `lead` prop on `home-c.tsx`'s `ChiefConversation` call: show only when `!narrow && projectId === null && archived === null && !fallbackOnly && chiefData.hasEarlier === false`. It lands at the top of `MessageScrollerContent` (`chief-conversation.tsx:658`), scrolls away naturally, needs no overlay positioning. The `!fallbackOnly` clause is required — without it the mark would duplicate the overlay spiral on the fresh greeting-only stream.
- New `board/chief-beginning-mark.tsx` reusing `InkSpiral` + `spiralProjects`/`waitingIds` from `home-spiral.tsx` as an in-flow block at column width, with a one-line beginning caption (Slack's "very beginning" is the copy model; e.g. `t('这是与 Coordinator 对话的起点')`); keep the same narrow / `max-height:700px` guards and the `home-spiral-project`/`home-spiral-new-project` hangs so the nav function survives.
- `hasEarlier === false` is the reveal trigger; while pages remain above, render nothing (Slack semantics). `EarlierLoader` already walks the user up; `newestPageOnly` (`use-chief-surface.ts:190-217`) means the mark re-hides on channel re-entry until fully scrolled — matching Slack and Discord.
- Leave the `fallbackOnly` overlay path untouched.
- Gate updates: V16 wording gains a third named place and `anti-slop-foundations.test.ts:56-60` gains the new file in its `<InkSpiral` allow-list — an owner-visible rule change to call out in the commit. `icon-stroke.test.ts` needs nothing (same component file).
- Tests: e2e asserting the mark renders at scroll top for a fully-loaded global channel and is absent while `hasEarlier` (fixture `chief.hasEarlier` toggles both cases), plus narrow/700px hiding; extend `chief-home-spiral.spec.ts` patterns.
- Step (e): pass `media={<SpiralMark />}` on the large `EmptyState`s named in `DESIGN.md:410` (no projects / no threads / keys / usage). No V16 conflict — `texture/texture.tsx` renders canvas dither, not `feTurbulence`/`InkSpiral`. Keep it out of project channels (deliberately bare) and out of the Coordinator column.

Not recommended: (b) and (c) — no mainstream precedent places a repeat brand moment inside a populated conversation.

## Limits

No product was operated live this round; external claims cite repo captures or named third-party sources, tagged per claim. `agent-reach` was unavailable in this session, so firsthand re-walks (claude.ai, Slack, Discord on the owner's Chrome) remain possible follow-ups before the UI brief.

## Landed (2026-11-17)

The owner rejected (a) on use: there is no practical reason to scroll a long
history back to its top. A second prototype round compared four directions;
the status-mark click-to-open peek shipped to a live verify stack, was tried,
and was cut on review — its payload duplicates the sidebar's project list, so
the overlay was a museum button. What shipped: the boot splash only —
`public/boot-skeleton.js` draws the brand spiral with the same grain filter
while the bundle loads (theme/locale/reduced-motion aware), `main.tsx` fades
it out after mount. Returning users now meet the spiral every launch, on all
widths. The status mark went back to a pure status indicator.
