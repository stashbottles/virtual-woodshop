# Virtual Woodshop — Project Context

## What this is

A React + TypeScript + Vite web app that simulates woodworking glue-ups — especially end-grain cutting-board patterns — before cutting real material.

## The core vision (why this app exists)

The single reason this app exists: simulate glue-ups accurately enough — real grain orientation, real glue logic — that the on-screen visual pattern reflects what would actually happen in the shop, so cuts and glue-ups can be experimented with digitally before committing real wood.

The single most important workflow (the one Joshua has spent the most time explaining to AI, and the hardest part to get right): build a square-cross-section rod from a 3-panel glue-up, corner-cut it at 45° to get a diamond, crosscut that diamond rod into end-grain blocks, and glue those blocks into a final patterned board.

Secondary goals: easier to pick up than CAD/construction software — someone with basic carpentry knowledge should be able to sit down and make a board intuitively. Fast enough to run through several glue-up experiments without it taking 10–20 minutes each.

## Architecture

- `src/shopEngine.ts` — pure geometry/pattern engine (rip, crosscut, glue, flip, rotate, 45° corner cut). Uses a `ShopResult<T> = {ok:true,value} | {ok:false,code,message}` result pattern throughout — reuse it, don't throw exceptions.
- `src/projectEngine.ts` — wraps shopEngine at the whole-workspace ("Project") level: `performGlueUp`, `performRipStrips`, `performCrosscutBlocks`, `performProfileCutCorners45`, etc.
- `src/workflowEngine.ts` — preview/suggestion helpers + snapshot save/restore.
- `src/App.tsx` — the entire UI: state, rendering, event handlers, all in one ~1900-line component. Known monolith. Left alone deliberately during the last round of fixes to avoid scope creep — see below.

## Recent work — branch `fix/diamond-corner-cut-pipeline`

Fixed the core square-rod → 45° corner cut → diamond → crosscut → reglue pipeline. It had three real, verified bugs (not just polish):

1. The "Quick Square Panel" shortcut didn't actually glue anything (just created loose strips + an alert telling the user to glue manually), and even glued by hand it produced the wrong shape for the corner cut. Fixed: it now glues a true square rod in one click via the existing `performGlueUp`.
2. Corner-cut diamond/triangle pieces rendered as an unrecognizable thin pill instead of a diamond — root cause was the renderer's one hardcoded view convention (`lengthY`→CSS width, `widthX`→CSS height) being wrong for a profile-cut piece's cross-section. Fixed with an additive `PatternViewMode` in shopEngine, default-preserved for every other piece.
3. Raw `window.alert()` for both success and error, including leaking internal error codes straight to the user. Replaced with a small inline status banner — scoped only to the two flows touched here; roughly 9 other `alert()` calls elsewhere in the app are untouched on purpose.

Also removed dead code (`VirtualShopPiece.tsx`, an unused earlier prototype) and a duplicate `.gitignore`.

Verified live end-to-end (not just by reading code): square rod → corner cut → diamond renders correctly with real alternating-species stripes → crosscut into blocks → glued side-by-side → correct repeating diamond/chevron pattern.

**Merge this branch into main whenever you're happy with it.**



## Also just fixed (commit `c9991c1`, local only — push this before starting new work)

Two more things fixed live in this same session, both already committed to `main` on this machine but not yet pushed to GitHub:

1. **Corner-cut pieces were rendering as small circles, not squares/diamonds.** Root cause: `PieceCard`'s outer box used a fixed 14px border-radius meant for ordinary rectangular boards, and the minimum on-screen size for a cross-section piece was only 30px — a 5/8" triangle offcut at 18px/inch floors to a 30×30px box, and 14px of rounding on a 30px box reads as a circle. Fixed: corner-cut pieces (`profileShape !== "RECTANGLE"`, i.e. `isProfilePiece`) now get `borderRadius: 0`, and their minimum size floor is raised to 72px so the stripe pattern inside is actually legible. Both changes are in `computePieceBoxPx` and `PieceCard` in `src/App.tsx`.
2. **Quick Square Panel rebuilt to match the real vision.** It was stacking 4 strips with a hardcoded species pair and only 8" long. Now it's a true 3-panel glue-up (outer/middle/outer — the actual technique this app is built around, not an arbitrary 4-layer stack), 16" minimum length, with a species picker: pick 2 species for the classic symmetric outer/middle/outer look, or 3 for one species per strip. Same block in `src/App.tsx`, still calls the existing `performGlueUp`.

## Next planned feature — Diagonal Bisect + Insert (not yet built)

This is the technique Joshua actually built in the shop and wants the app to simulate next — more central to his vision than it first appeared. He split a square rod along a diagonal (used 20° in his real build, not just 45°), glued a thin contrasting strip (~1/4") into that diagonal seam, and reglued into one larger rod. Crosscut into end-grain blocks and arranged, this produces the X/bowtie accent lines running between diamonds — see the board photo he shared (not in this repo, described here for context: alternating dark/light diamond blocks connected by thin diagonal blue accent lines).

**This is a new primitive, not a variant of the existing 45° Corner Cut.** Corner Cut (`profileCutCorners45`) trims the four corners off a square rod to pull a diamond out of the middle. This new operation splits the rod clean through the middle along one diagonal line at any angle, and adds material back at that seam. Keep Corner Cut untouched; this is additive.

**Design decision, explicitly made after some back-and-forth: prioritize visual correctness over dimensional realism.** Joshua's own words: "the more I think about it, the less exact measurements matter, because the computer or app isn't going to be the same size as in the shop. What's important is that we visually see what's going on and that the app functions well visually. If that means exact measurements are sidelined, I am ok with that, at least to start." So:

- The cut angle (`θ`, roughly -45°..45°, exclusive — at exactly 45° you're back to Corner Cut's territory) should drive the *visual* seam angle correctly in rendering — that's the part that has to look right.
- The resulting board's *dimensions* should use the simplest reasonable rule, not precise trapezoid-trim trig: `thicknessZ' = S + insertThickness`, `widthX' = S` (unchanged). Don't spend effort deriving exact real-world growth/shrink formulas for v1 — a more accurate sizing model is a fine follow-up later if it turns out to matter, but isn't worth the complexity now.
- Kerf isn't separately modeled for this cut — the insert thickness is the gap, full stop.
- If the board being bisected already has a multi-species striped pattern (e.g. output of Quick Square Panel), v1 does not clip those inner stripes along the diagonal — the top/bottom halves carry their existing pattern through as-is. Verify visually on a solid-species test rod first.
- How multiple diagonal-insert blocks get arranged into the X/bowtie/pinwheel mosaic (rotation rules when glued into a parent pattern, the way `glueChildRotationForBoard` already special-cases `CENTER_SQUARE_45` → 45°) is a deliberate follow-up, not part of this slice.

**Suggested implementation shape** (adjust as you go — this is a starting point, not gospel):

- `src/shopEngine.ts`: add `"DIAGONAL_INSERT"` to the `ProfileShape` union. Add a `DIAGONAL_SPLIT` variant to `VisualPatternNode`/`RenderPatternNode`: `{ kind: "DIAGONAL_SPLIT", angleDeg, insertThickness, insertSpecies, top, bottom }` — additive, needs a new case in `clonePattern`, `renderPatternNode`, and `sliceBoardPatternAlongAxis` (a `DIAGONAL_SPLIT` node doesn't vary along `LENGTH_Y`, so slicing it for crosscut is a pass-through clone — that's what makes crosscutting the resulting rod into end-grain blocks work once the case exists). New function `bisectDiagonalInsert(board, angleDeg, insertThickness, insertSpecies)` next to `profileCutCorners45`, same `ShopResult`/validation style, returns the single reglued board (not loose halves — mirrors the one-continuous-operation reality of how this is actually done in the shop).
- Rendering: the diagonal seam can't be drawn with the existing CSS row/column flex split (axis-aligned only). For pieces with a `DIAGONAL_SPLIT` node, render inline SVG instead — a polygon for the top region, one for the bottom region, one parallelogram for the insert, using `angleDeg` for the actual seam geometry in the drawing (this is where getting the angle right actually matters, per the design decision above). Sits alongside the existing CSS renderer; nothing else changes.
- `src/projectEngine.ts`: `performDiagonalBisectInsert(project, sourceId, angleDeg, insertThickness, insertSpecies)`, following `performProfileCutCorners45` right above it.
- `src/App.tsx`: new handler mirroring `handleProfileCutCorners45Active` (reuse `showStatus`, `pushUndoSnapshot`, `placeIdsWrapped` — no new `alert()`). Extend `isProfileCutPiece` to also cover `profileShape === "DIAGONAL_INSERT"` so this piece shows its cross-section by default like the diamond does. New inputs: angle number field, insert thickness field (default 0.25), insert species dropdown (reuse existing species list). Place the button as a sibling of 45° Corner Cut.

**Verification**: live via `npm run dev` + Playwright, not just code review — build a square rod, run the cut at a couple of angles (try 0° and 20°, Joshua's real angle), confirm the cross-section visually shows two regions split by a correctly-angled seam with the insert species visible in the gap, then crosscut the result into blocks and confirm each block still renders its seam correctly. `npm run build` clean after each slice. Small commits on a new branch (e.g. `feat/diagonal-bisect-insert`), same discipline as the last round of fixes.

## Next planned feature — Custom Strip Glue-Up Builder (not yet built)

Joshua's own example: "two 1/4" purpleheart strips with a maple 1/2" in-between and 2 walnut 1/2" strips outside the 1/4" strips" — i.e. Walnut(1/2) - Purpleheart(1/4) - Maple(1/2) - Purpleheart(1/4) - Walnut(1/2), 5 strips, fully custom thickness and species per strip, not just the algorithmic outer/middle/outer that Quick Square Panel now builds.

**This needs no new engine code.** `glueUpBoards`/`performGlueUp` (`FACE_GLUED`) already accepts any ordered list of boards and stacks them by thickness — its only real constraint is that every board shares the same `widthX` and `lengthY` (see the `MISMATCHED_LENGTH_FOR_GLUEUP` / width check in `glueUpBoards`, `src/shopEngine.ts`). Joshua's own example already satisfies that (every strip is the same width, only thickness/species vary). So this is a UI feature on top of an existing, already-correct primitive — build a list of strip rows (species + thickness each, shared width + length inputs), turn that list into `Board3D[]`, and call the same `performGlueUp` that Quick Square Panel and the manual GLUE tab already use.

Suggested shape, separate from Quick Square Panel (Joshua explicitly said this doesn't need to live inside that shortcut):
- A new small panel/tool, e.g. in the MATERIAL tab, with an ordered list of strip rows: species dropdown (reuse `SPECIES_OPTIONS`) + thickness input per row, plus add/remove/reorder controls.
- One shared width and length input for the whole stack (all strips must match — that's the `FACE_GLUED` constraint above).
- Show the running total thickness live as rows are added/edited. If Joshua's going to feed the result into 45° Corner Cut, that total needs to equal the width for a square cross-section — surface that (e.g. "total: 1.75\" — need 2.00\" to match width for a square rod") rather than silently letting him build something the Corner Cut will reject with `NON_SQUARE_FACE_FOR_PROFILE_CUT`. Don't hard-block non-square results though — custom glue-ups are useful outside the corner-cut pipeline too.
- On submit, build the `Board3D[]` strip list (mirroring how Quick Square Panel now builds its `newPieces` array) and call `performGlueUp` with `orientation: "FACE_GLUED"`, same undo/select/place pattern already used everywhere else (`pushUndoSnapshot`, `applyProject`, `diffNewPieceIds`, `placeIdsWrapped`).

**Verification**: live via `npm run dev`, not just code review — build Joshua's actual example (2× 1/4" purpleheart, 1× 1/2" maple, 2× 1/2" walnut, symmetric) and confirm the glued panel's total thickness is exactly 2.00" with the strips in the right order and species. `npm run build` clean. Small commits, same discipline as the rest of this file's history.
## Known, deliberately out-of-scope items

- `App.tsx`'s size/monolith structure — not refactored, only touched at the specific points the pipeline fix required.
- The ~9 other `alert()` call sites elsewhere in the app — reasonable follow-up, not converted yet.
- A freshly-glued panel sometimes defaults to a tall vertical on-screen orientation instead of horizontal, when its glued width ends up larger than its length. This is a pre-existing quirk in the board-rendering convention (`lengthY` always maps to on-screen width, `widthX` to on-screen height) — not something the pipeline fix introduced. The ROTATE SELECTED controls work around it today; a nicer long-term fix would be auto-orienting boards so the longer dimension always displays horizontally.

## Still open, from the README's own "Future Improvements" list

- Clearer guided workflows
- Better inventory organization
- Exportable build steps
- General UI refinement
- More pattern arrangement tools

## Working style Joshua prefers

- Small, testable commits over one giant change — each commit should build and work on its own.
- Verify claims live (actually build and run the app), not just by reading the code.
- Stay scoped to what's asked — don't refactor unrelated things "while in there" unless it's trivial and directly in the way.
- Joshua is a vibe-coder with basic/beginner coding knowledge (some courses, heavy AI use) — explain *why* something's broken or chosen, not just *what* changed.
