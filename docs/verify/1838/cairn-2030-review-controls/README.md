# PR #2030 review controls

The published candidate `d340e31521755e2c4d9d89797120a63933268d75` failed eight of the 29 cases in `red.log` before the implementation changed. The controls cover an unclassified scheduling capability, descriptions mistaken for decisions, rejected library reuse, and conflicting choices. The same 29 cases pass in `green.log` after the fix.

Unclassified new plans now require prior art. Only an explicit `Kind: fix` can claim the small-fix exemption; existing feature indicators still require prior art. Existing saved, unclassified plans retain their verification checklist when read. Contract and evaluator share parsed decisions, including rejected choices.

`compatibility.log` records 96 passing contract, prompt, evaluator and server auto-confirm cases. Existing small-fix fixtures carry explicit classification without changing their assertions. The historical #1606 fixture is unchanged and is classified only by its structural test input.

The previous CI failed `history does not animate on first render (reduce)` in the unchanged web code. `animation-repeat.log` records 40 passing real-browser repetitions across reduced and normal motion. This does not establish the CI failure's cause, and the assertion was not changed.
