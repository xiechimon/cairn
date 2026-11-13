# Composer voice input

Status: shelved by the owner on 2026-11-11; not built. The implementation that was built and removed is archived outside the repository as a patch; nothing in the app ships voice input.

## Reference behaviour

From the reference's dictation recording (`ce68f66d-capture-small.mp4`, 2026-11-11):

- Idle: under the field, `+`, a microphone glyph and a small `⌄` (voice options). The microphone's tooltip is `Press and hold to record`; a click toggles dictation and pressing and holding records while held.
- Listening: the microphone is replaced in place by a blue-tinted rounded pill holding an animated level indicator that moves between three dots (silence) and three bars (speech). Its tooltip is `Stop dictation`.
- A slim banner sits directly above the field, same width and family as the field: `Say "okay send" to send` with a dismiss `×` at the right; dismissing it keeps dictation running. It appears when dictation starts and goes when it stops.
- Recognised text is written straight into the input at the caret as ordinary text, live; the placeholder shows until the first words arrive and the text stays editable while dictating.
- An utterance ending in the send phrase (`Okay, send.`) sends the message with the phrase stripped, clears the input, and dictation returns to idle. Repeated or misheard `send` words inside the text are just text.

## Intended design (when unshelved)

- One `VoiceSource` seam (`start(handlers)`, `stop()`, interim/final/error events) consumed by the composer; a scripted fixture source for scenarios and tests; no source in the browser means a disabled microphone with a reason.
- The browser's Web Speech API was approved by the owner as an interim source. In Chrome and Safari it sends the microphone audio to the browser vendor's speech service; the planned replacement is a local open-source speech model run by the daemon or server behind the same interface, with the model selectable.
- Send phrase: `OK，发送`, `OK send`, `Okay, send`, `好，发送`, only at the very end of a final transcript and only as its own phrase; failures (permission, device, silence, network, source) stop listening, keep the draft and show one toast.

## Backend contract for the local model (to do)

The replacement source streams audio to cairn instead of the browser vendor and receives the same interim/final/error events.

- Transport: a WebSocket on the server, `GET /api/teams/:teamId/voice/stream` upgraded, authenticated by the session cookie like the other team routes (same-origin only); the server may relay to a daemon on a machine the owner chose.
- Client → server: one JSON `start` frame `{ "type": "start", "language": "zh-CN" | "en-US" | "auto", "model": "<model id>" | null, "sampleRate": 16000 }`, then binary frames of 16 kHz mono 16-bit little-endian PCM (the browser downsamples from `AudioWorklet`), 20–100 ms each, then `{ "type": "stop" }`.
- Server → client: `{ "type": "interim", "text": "…" }`, `{ "type": "final", "text": "…" }` (punctuated, one per utterance), `{ "type": "error", "kind": "permission" | "device" | "silence" | "network" | "source" | "busy" | "model", "message": "…" }`, `{ "type": "end" }`.
- Models: listed by `GET /api/teams/:teamId/voice/models` (`id`, `name`, `languages`, `runsOn: "server" | "daemon"`, `ready`); the selection is a team setting.
- Limits: one stream per user at a time; a stream ends after 60 s of silence or 10 min total with `end`.
- Privacy: audio is processed in memory and never stored or logged; transcripts are not stored until the owner sends the message; no third-party service is called.
- Errors on the server side map to the same `kind` values so the composer's handling does not change.
