# Paper API keys and schedules

`capture.mjs` loads each page from a fixture build served by `vite preview`
at 1440x900, DPR 2, in light and dark. `before` is `origin/main` at
9a50236c, `after` is this branch (same page code as on the merged tree;
#1388 does not touch these files). File names are
`<label>-<theme>-<shot>.png`.

| shot | URL | what it shows |
| --- | --- | --- |
| `api-keys-empty` / `api-keys-list` | `/app/api-keys` / `/app/api-keys?scenario=api-keys-created` | empty state; one-time block + key row |
| `schedules-empty` / `schedules-list` | `/app/schedules?scenario=11` / `/app/schedules?scenario=r3-93` | empty state; one schedule row |
| `dialog-schedule` | `/app/schedules?scenario=r3-92` | `新建定时` dialog |

Before: schedules empty state on the registry Empty with a grey icon tile and
a 12px hint icon; schedules rows as 92px cards with a clock tile and two meta
lines; API key rows as 62px cards (14px corners) with a chevron that opened
nothing; the one-time block a 14px-corner card with `text-[13px]` mono and a
small solid `复制`; the `新建定时` footer an outline `取消` + primary.

After: schedules empty state = `EmptyState` (bare ink-3 clock, one primary,
hint line). Schedules and API keys lists = one settings card of 52px rows
(title + one meta line left; status chip and `更多` right for schedules).
The one-time key block is a 10px-corner card with an outline `复制`. The
`新建定时` form rows are 32px boxed controls and the footer is `FormActions`
(text `取消` + `保存`). The API key create dialog (live only, no fixture) uses
`FormField` / `FormActions` and drops `min-w-[320px]`, `max-h-[264px]`,
`py-[3px]` and `text-[13px]`.
