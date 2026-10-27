---
Category: An integration test called startBuild again while the task was already in review; the phase gate refused and the verdict-binding path never ran
Source: #1404 S5a
Level: 5
Safeguard: Memory: when testing verdict binding, start each world only once; two runs need two worlds
Intercepts: 0
Recurrences: 0
Notes: Levels 1 to 4 cannot catch it: a second start has no statically identifiable shape and the phase gate only fails that test; a script keyed to this one fixture would also flag legitimate re-run cases
---
