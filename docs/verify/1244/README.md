#1244 registry focus ring

Verify stack: web `http://127.0.0.1:5273`, server `http://127.0.0.1:8791`. Dark is the default theme. Light is `localStorage['pacman-theme']='light'`.

Before the fix, keyboard focus on the create-agent name input computed `outline-style: none` (width 2px, color `--focus-ring`) and `box-shadow` `0px 0px 0px 3px` in `--ring` at 50%. The border color was `--ring`. Switch (`span[role=switch]`) and checkbox (`span[role=checkbox]`) are outside the original #388 selector, so the same gray shadow was their only ring. Numbers are in `before-computed.json`. `before-e2e.log` is `e2e/registry-focus-ring.spec.ts` on that tree: 8 failed.

After the fix, the same stack computes a 2px solid `--focus-ring` outline, offset 2, `box-shadow: none`, and a border that is not `--ring`:

| control | outline | shadow | border |
| --- | --- | --- | --- |
| input dark | solid 2px rgb(242, 148, 216) offset 2 | none | rgb(64, 60, 57) (`--input`) |
| input light | solid 2px rgb(151, 34, 126) offset 2 | none | rgb(203, 197, 193) |
| select trigger | solid 2px rgb(242, 148, 216) offset 2 | none | rgb(64, 60, 57) |
| close button | solid 2px rgb(242, 148, 216) offset 2 | none | transparent |
| checkbox | solid 2px rgb(242, 148, 216) offset 2 | none | rgb(238, 232, 228) (checked primary) |
| switch | solid 2px rgb(242, 148, 216) offset 2 | none | transparent |
| input-group control | style none | no 3px ring | not the focus skin |
| input-group shell | solid 2px rgb(242, 148, 216) offset 2 | none | rgb(64, 60, 57) |

`after-computed.json` is the full sample. `after-e2e.log` is the focus specs on the fixture build: `registry-focus-ring`, `overlay-focus`, `segmented-controls`, `dialog-ring-room`, `project-new-repo`. 43 passed.

`rg "ring-ring/50" apps/web/src` is zero hits.
