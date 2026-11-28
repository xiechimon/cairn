# WeChat inbound images and honest IM turn failures — plan, 2026-11-29

## User scenario

Someone who installed Cairn and paired their WeChat in Settings → Chat apps sends the Coordinator a picture from their phone ("what is wrong with this receipt?"). Today Cairn never downloads the picture: the iLink message carries an AES-encrypted CDN reference, the bridge drops it (`dataBase64: null`), and the Coordinator is told "1 attachment was not fetched". When the Coordinator runtime also fails during that turn, WeChat only receives the old generic "this turn failed, try again later" sentence with no cause. After this change the picture reaches the Coordinator as a normal chat attachment it can open with its attachment tool (a vision model sees it; a text-only Coordinator gets the existing caption/OCR description), and any failed turn replies with one plain sentence naming the actual cause. No new account, key, setting or storage path is needed: the picture lands in the existing per-team `attachments` store exactly like a web upload.

## Scope

1. WeChat inbound images: `createWechatAdapter().connect` downloads each `image_item` from the iLink CDN and decrypts AES-128-ECB/PKCS7 with the key carried in `media.aes_key` (base64 of 16 raw bytes, or base64 of the 32-char hex string) or top-level `aeskey`/`aes_key` (32-char hex). It fetches `media.full_url` only when that URL is exactly on `https://novac2c.cdn.weixin.qq.com`; otherwise it builds `https://novac2c.cdn.weixin.qq.com/c2c/download?encrypted_query_param=<encoded>` from `encrypt_query_param`, so an upstream-chosen host is never fetched. Accepted magic is JPEG, PNG, GIF and WebP; the decrypted bytes reach `im/core.ts` as a normal `ImInboundFile`, become an `attachment` row, and appear in the turn prompt as `attachment=<id>`.
2. Bounded, non-fatal media failure: more than 10 MiB (rejected from `content-length` before reading, then enforced while streaming), a missing `encrypt_query_param`/key, an unrecognized key encoding, non-2xx, a 15 s per-image timeout, unknown magic or bad PKCS7 are counted as a missing attachment (the existing "N attachments were not fetched" line) and never fail the turn; text and later images in the same message are still delivered. A batch that contains one slow image can delay later messages in that same batch by at most the per-image bound; a text-only batch is unchanged.
3. Cursor safety: the whole batch is delivered, including its image downloads, before `get_updates_buf` is saved, so a restart cannot acknowledge an image the bridge never stored.
4. IM turn failure copy: when a chief turn finishes `failed`, `im/core.ts` reads that turn's recorded `chief-err-<stepId>` message (today's only writer is `coordinator-steps.ts` after `finishChiefTurn`) and replies in one plain sentence naming the cause for ACP initialization timeout, MCP servers not ready, ACP disconnect and skills distribution unreachable. The fallback takes the first line only, removes URLs, absolute paths and control characters, collapses whitespace and caps 120 characters; if nothing remains it says no reason was recorded. The stored message is already secret-scrubbed when written. The same hook serves every IM channel; the shared core tests exercise it through the Telegram fake, and WeChat adds no failure copy of its own.
5. Unchanged: text and voice handling, pairing, card replies, outbound sends, Telegram/Slack/iMessage media paths, non-image WeChat item types (files, videos and stickers stay ignored for now), stopped and mixed IM/web turns, the `attachment` tool and its caption/OCR fallback. The owner's report makes the honest failure text part of this same bug, so the two repairs land together.

## Edge cases

| Edge case | What the user sees | Proving test | Slice/Status |
|---|---|---|---|
| `media.full_url` points at another host or plain `http` | That URL is never fetched; the CDN URL is rebuilt from `encrypt_query_param`; without one the picture counts as missing | `apps/server/test/im-wechat.test.ts` | this change |
| Image whose `media.aes_key` is base64 of 16 raw bytes | Coordinator receives the decrypted picture as an attachment and answers about it | `apps/server/test/im-wechat.test.ts` | this change |
| Image whose `media.aes_key` is base64 of the 32-char hex string, and image whose top-level `aeskey` is plain hex | Same as above; all three key encodings decrypt | `apps/server/test/im-wechat.test.ts` | this change |
| Image plus text in one WeChat message | Text prompt preserved and the image listed as `attachment=<id>` | `apps/server/test/im-wechat.test.ts` | this change |
| Image-only message whose download succeeds | Coordinator prompt carries the attachment and no text; the turn succeeds | `apps/server/test/im-core.test.ts` | this change |
| Missing `encrypt_query_param` or key, CDN non-2xx, timeout, bad padding, unknown magic, or over 10 MiB | Message still reaches the Coordinator; prompt counts the picture as missing; no turn failure | `apps/server/test/im-wechat.test.ts` | this change |
| One image fails while a later image in the same message succeeds | Later image is still downloaded, decrypted and stored, in order | `apps/server/test/im-wechat.test.ts` | this change |
| Image download in a poll batch | Both messages are delivered before `get_updates_buf` advances; the image bytes are present | `apps/server/test/im-wechat.test.ts` | this change |
| Attachment store rejects the image (quota or validation) | Counted as missing; text survives; no turn failure | `apps/server/test/im-core.test.ts` | this change |
| Chief turn fails with a recorded ACP/MCP/disconnect error | WeChat replies with one sentence naming that cause instead of the old generic failure sentence | `apps/server/test/im-core.test.ts` | this change |
| Chief turn fails because the skills service is unreachable | Reply names the skills service, not the generic line | `apps/server/test/im-core.test.ts` | this change |
| Chief turn fails with no recorded error, or with a long multi-line error carrying URLs or absolute paths | Explicit "no reason recorded" sentence, or the first error line with URLs/paths removed and capped; no stack dump | `apps/server/test/im-core.test.ts` | this change |
| A stopped turn, or a turn mixed with a web reply | Unchanged: no failure reply for a stopped turn, normal mixed routing for a shared turn | `apps/server/test/im-core.test.ts` | later: existing coverage |
| Non-image WeChat item (file, video, sticker) | Unchanged for now: still ignored; follow-up covers it | `apps/server/test/im-wechat.test.ts` | later: wechat non-image media follow-up |
| Coordinator model cannot see images | Existing attachment-tool caption/OCR path answers; the turn is not failed | `apps/server/test/coordinator/image-text.test.ts` | later: existing coverage |

## Out of scope

- WeChat voice items without an iLink `voice_item.text`: SILK download and transcription stay as they are.
- Non-image WeChat media (files, videos, stickers) and outbound images/files: a follow-up change.
- Any new vision-model setting; the existing caption/OCR fallback is reused.
- Web UI or e2e changes; the failure card already shows the recorded reason in the app.

## Review

- Verdict: CONCERNS
- Plan-SHA256: e2c615c82a968bc5d152320835296149740d115fca6eb2d0ca48298543b09842
- Author-Model: deepseek-v4.1-flash
- Reviewer: pi-review.sh plan (fresh-context, Opus)
- Reviewer-Model: anthropic/claude-opus-5-5
- Findings: 0 blocking; 8 should-fix and 3 notes:
  1. `docs/design/wechat-inbound-images.md:23`: should-fix. The proving test for an image-only message that downloads successfully is hollow: `apps/server/test/im-core.test.ts` has no such test in this change.
  2. `docs/design/wechat-inbound-images.md:22`: should-fix. Timeout, oversized, bad padding and unsupported-key cases have no tests. Only HTTP 500 and missing query/key are covered.
  3. `docs/design/wechat-inbound-images.md:12`: should-fix. The cursor-safety promise has no edge row and no test. The plan bounds single downloads but not the whole batch, so a slow CDN can hold up polling and later text messages.
  4. `docs/design/wechat-inbound-images.md:9`: should-fix. Accepting any `media.full_url` lets the server fetch a URL chosen upstream. Pin the host to `novac2c.cdn.weixin.qq.com` over https, or always build the URL from `encrypt_query_param`, and add a negative test.
  5. `docs/design/wechat-inbound-images.md:11`: should-fix. Define what "scrubbed" removes (paths, URLs, hosts, tokens) before sending error text to a third-party IM, and test it.
  6. `docs/design/wechat-inbound-images.md:15`: should-fix. Missing edge rows: non-image WeChat items dropped silently; unknown or HEIC formats ending up as `.bin` and being rejected; attachment quota exceeded after download; stopped turns and mixed turns that get no reply.
  7. `docs/design/wechat-inbound-images.md:25`: should-fix. `coordinator-steps.ts:586` always writes a default message, so the "no reason recorded" path only happens through other failure writers. Name them or make the row match reality.
  8. `docs/design/wechat-inbound-images.md:11`: should-fix. "Every IM channel" changes Telegram, Slack and iMessage replies, but only WeChat is named and tested. Add one non-WeChat assertion or narrow the claim.
  9. `docs/design/wechat-inbound-images.md:10`: note. Enforce the 10 MiB cap while reading the response, using `mid_size` or a stream cutoff, not after buffering it all.
  10. `docs/design/wechat-inbound-images.md:7`: note. Two independent features are bundled. Consider splitting the failure copy into its own small change.
  11. `docs/design/wechat-inbound-images.md:26`: note. `Slice/Status` "later: unchanged existing path" names neither a ticket nor a slice.
- Response: 1 adds the image-only core test; 2 adds timeout, oversized, bad-padding and unknown-format tests; 3 states the per-image bound honestly and adds an ordering test; 4 pins the CDN host and adds a spoofed-host negative test; 5 defines the fallback scrub (first line, no URLs/absolute paths/control characters, 120 chars) and tests it; 6 adds the non-image, unknown-format, quota and stopped/mixed rows; 7 names `coordinator-steps.ts` as the only writer and keeps the no-reason sentence as a defensive unit path; 8 says the shared hook is proven through the Telegram fake; 9 streams with a cap and checks `content-length` first; 10 keeps both repairs because the owner's report makes the generic text part of the same bug; 11 uses `later: existing coverage`.
- Fix-check: PASS
- Fix-check-Plan-SHA256: 55917aa220782bbf728e31d3a3e4e35a8261df33b4071fa09a9e08c0086c14df
