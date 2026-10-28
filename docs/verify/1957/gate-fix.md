# Review-gate fix for tip 106e0432

Blocking findings addressed:

1. Export maps fixing-parent evidence through `git blame` to introducing-tree
   path/lines (intervening inserts and renames covered by tests).
2. `blobLineCount` rejects the phantom trailing empty from `split('\\n')` in
   export and validate.
3. `exportCases` upserts by case id and no longer deletes existing case JSON;
   successive exports preserve prior verified cases.

Focused green: 11 pass / 0 fail (`docs/verify/1957/gate-fix.green.log`).
