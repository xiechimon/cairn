#1244 registry focus ring

Verify stack: web `http://127.0.0.1:5273`, server `http://127.0.0.1:8791`. Dark is the default theme. Light is `localStorage['pacman-theme']='light'`.

Before the fix, keyboard focus on the create-agent name input computed `outline-style: none` (width 2px, color `--focus-ring`) and `box-shadow` `0px 0px 0px 3px` in `--ring` at 50%. The border color was `--ring`. Switch (`span[role=switch]`) and checkbox (`span[role=checkbox]`) are outside the #388 selector, so the same gray shadow is their only ring. Numbers are in `before-computed.json`.

`before-e2e.log` is `e2e/registry-focus-ring.spec.ts` on this tree before the class change: 8 failed. Outline style was `none` on input, select, button, textarea, checkbox, and the input-group shell. The schedule tab outline width was `1px`.
