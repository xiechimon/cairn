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

Whether a gateway accepts images is often unknowable in advance, so capability is a guess that the server corrects after a request has run. There is no owner override: the provider editor has no per-model image setting.

The initial guess resolves in one place, `resolveModelInput` in `packages/shared`: the saved model's `input` (written only by the server, see below), else the `input` the preset catalog declares for the same model id (`PROVIDER_PRESET_DEFAULTS`, shared so the server reads the same table as the UI), else text-only. Saved models usually carry no `input`, so the catalog lookup is what keeps Claude and other known vision models image-capable.

- A model id unknown to the catalog and without a saved `input` is text-only. The old default (`['text','image']`) made text-only gateway models receive full-screen base64 PNGs, and the gateway hung until it timed out.
- Known gap: a catalog entry can be wrong for a given gateway (the owner's workbuddy deepseek-v4.1-flash hung about 200 s on images). The adaptive flow below turns that into one bounded failure, then a text-only model.

### Adaptive flow for image-bearing requests

Every in-server model request goes through the single `streamSimple` wrapper in `apps/server/src/coordinator/runtime/models.ts`. It acts only when the model is believed image-capable and the request context contains an image:

1. The request runs with a bounded timeout (90 s, no SDK retries) unless the caller set one.
2. If it fails before any content streamed (provider error or the timeout; not a caller abort, and not 401, 403, 429 or quota errors, which are not about images), the same request runs once more with every image replaced by the text `screenshot omitted: this model did not accept images`.
3. If that retry succeeds, the server marks the model text-only: it sets `input: ['text']` on the provider's model record (`markProviderModelTextOnly`, the only writer of `input`) and on the model of every open conversation. Later turns and other threads skip images, and `computer_observe` and `computer_act` return the text-only error below.
4. A request that succeeds with images records nothing. A retry that also fails records nothing and returns its own error.

- At tool time the tool reads the current model of the conversation (`api.agent()` then `api.models.getModel`), so a model switch mid-thread takes effect on the next call.

## What a text-only model gets

- `computer_observe` and `computer_act`: no relay to the computer, so nothing is clicked or typed blind. The result is a tool error (`isError`) with one plain line: the current model cannot see screenshots, use `browser_*` or `desktop_*` tools, and if they cannot do it, report that the step needs an image-capable model. No image block.
- Screenshot-only actions are never the first choice for any model: the prompt orders browser and text tools first.
- pi-ai also replaces images with "(see attached image)" for text-only models; with the correct capability that protection now applies, and the tool no longer produces the image in the first place.

## No separate computer-use model

Decided by ian on 2026-11-18: no separate vision "computer-use model" setting. Layers 1 and 2 (agent-browser, agent-desktop) carry the work in text. When only layer 3 would help, a main model that can see images uses it; a text-only main model gets an error from the screenshot tools and reports that the step needs an image-capable model (owner decision, ian, 2026-11-18). `request_takeover` stays for logins and 2FA only. Revisit only if real runs show text-only models blocked on screenshot-only steps often.

## Failure paths

| Case | Behavior |
|---|---|
| Model not in the catalog (provider removed mid-turn) | treated as text-only |
| `computer_observe` or `computer_act` from a text-only model | tool error, one line, no relay, nothing executed |
| Image-capable model | unchanged: text plus bounded PNG |
| Image request fails or times out, retry without images succeeds | the turn continues on the retry; the model is marked text-only, so the next screenshot call gets the text-only error |
| Image request fails and the retry also fails | the retry's error is the turn's error; nothing is recorded |
| Owner holds control | unchanged: `computer_observe` is refused by the handoff gate |
