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
