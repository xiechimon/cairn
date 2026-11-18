# Computer operation layers

Owner decision (ian, 2026-11-18): agents operate computers text-first. Screenshots with coordinate actions are the fallback, not the default.

## The three layers

| Layer | Tool | Reads | Acts | State |
|---|---|---|---|---|
| 1. Web pages | agent-browser (`browser_navigate`, `browser_snapshot`, `browser_act`) | accessibility snapshot with refs plus page text | click, fill, press by ref | shipped |
| 2. Desktop apps | agent-desktop (accessibility tree of native windows) | tree of windows, controls and their text | act on a control by id | being added to the VM image by another slice; the Coordinator tools follow it |
| 3. Screenshot fallback | `computer_observe`, `computer_act` | full-screen PNG | pixel coordinates, keys | shipped, last resort |

Order of use: layer 1 for anything in a browser, layer 2 for a native window, layer 3 only when the text layers fail or the target has no accessibility tree (canvas, games, remote desktops). Tool descriptions and the Coordinator prompt state this order; layer 3 descriptions say "last resort".

## How image capability is known

The capability is the model's declared `input` in its provider model record (`ProviderModel.input`, persisted with the provider).

- A preset keeps the `input` its catalog declares.
- A custom provider model with no declared `input` is text-only. The old default (`['text','image']`) made text-only gateway models receive full-screen base64 PNGs, and the gateway hung until it timed out.
- The owner ticks the "supports images" checkbox of a custom model in the provider editor (Settings, Models, provider); that writes `input: ['text','image']` into the model record, unmarking writes `['text']`.
- At tool time the tool reads the current model of the conversation (`api.agent()` then `api.models.getModel`), so a model switch mid-thread takes effect on the next call.

## What a text-only model gets

- `computer_observe`: no relay to the computer at all. The result is one line: this model cannot see screenshots; use `browser_snapshot` and other text tools first; if only a screenshot would help, call `request_takeover`.
- `computer_act`: the actions still run (keys and typing do not need coordinates), the result text carries a line saying no screenshot is attached and pointing to text tools or `request_takeover`. No image block.
- Screenshot-only actions are never the first choice for any model: the prompt orders browser and text tools first.
- pi-ai also replaces images with "(see attached image)" for text-only models; with the correct capability that protection now applies, and the tool no longer produces the image in the first place.

## Owner takeover fallback

When only a screenshot would help and the model cannot see images, the model calls the existing `request_takeover` (the handoff path: the owner gets control, hands it back, the model continues from a fresh `browser_snapshot`). The tool result names this explicitly so the model never retries silently.

## Optional computer-use model (next slice, not built here)

A separate vision model setting, "computer-use model", unset by default. When set, layer 3 sends the screenshot to that model and returns its text description and target coordinates to the main model, so a text-only main model can still use layer 3. When unset: a main model that can see images handles layer 3 itself, otherwise it asks the owner to take over. The setting needs its own persisted field, provider picker and cost accounting; none of that exists in this slice.

## Failure paths

| Case | Behavior |
|---|---|
| Model not in the catalog (provider removed mid-turn) | treated as text-only |
| `computer_observe` from a text-only model | one-line message, no relay, no image |
| `computer_act` from a text-only model | actions run, text result, no image |
| Image-capable model | unchanged: text plus bounded PNG |
| Owner holds control | unchanged: `computer_observe` is refused by the handoff gate |
