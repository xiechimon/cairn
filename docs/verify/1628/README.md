# 1628 heavy-check slot count

- `demo-slots.sh` / `demo-slots.log`: a demo of slot count 2 with 4 launched at once. A lightweight stand-in command (a node script that runs for 2 seconds each) replaces the full prepush, because the machine load is already high and 4 full prepushes are not really launched. Segment A result: all 4 exit with code 0, at most 2 are running at any moment, and the other 2 print `排队中` and run one after another. Segment B: after `kill -9` on the lock holder, the queued one takes the slot within 111 ms (the acceptance line is 5 seconds).
- The peak-memory measurement of the full prepush plus `e2e:affected` on omarchy: pending a host. From this, omarchy's `CAIRN_HEAVY_SLOTS` is set, initial value 3.
