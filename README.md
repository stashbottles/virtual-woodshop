# Virtual Woodshop

Virtual Woodshop is a React and TypeScript woodworking pattern simulator for planning end-grain cutting-board designs before going into the shop.

The app lets you create boards, rip, crosscut, flip, rotate, and glue them, and preview the resulting visual pattern through multiple woodworking operations.

## Why I Built It

Woodworking patterns can become hard to visualize after pieces are ripped, glued, crosscut, flipped to end grain, rotated, and glued again.

I built this project to experiment with glue-ups and patterns digitally before cutting real material — the app aims to simulate accurately enough that the on-screen pattern reflects what would actually happen in the shop.

## Features

- Add boards by species, dimensions, and grain orientation
- Rip boards into strips
- Cut boards by width or length
- Crosscut panels into blocks
- Flip pieces between FACE, EDGE, and END views
- Rotate selected pieces
- Glue pieces side-by-side or stacked
- Preserve visual pattern ancestry through nested glue-ups
- Convert blocks to END grain
- Alternate every other selected block
- 45-degree corner cut workflow: square rod → diamond → crosscut → repeating diamond/chevron pattern
- Inventory and scrap handling
- Undo and redo
- Save and load design variants

## Tech Stack

- React
- TypeScript
- Vite
- Custom pattern engine (`shopEngine.ts`)
- Custom project/workflow logic (`projectEngine.ts`, `workflowEngine.ts`)

## Project Structure

```text
src/App.tsx           - UI: state, rendering, event handlers
src/shopEngine.ts      - pure geometry/pattern engine
src/projectEngine.ts   - workspace-level operations built on shopEngine
src/workflowEngine.ts  - preview/suggestion helpers + snapshot save/restore
```

## Current Status

The app currently uses a simplified workflow:

`MATERIAL | CUT | GLUE`

The core pattern engine supports common end-grain cutting-board workflows:

`rip → glue → crosscut → convert to END → rotate → glue again`

The 45-degree corner cut workflow (square rod → diamond → crosscut → reglue) is implemented and verified end-to-end.

## Future Improvements

- Clearer guided workflows
- Better inventory organization
- Exportable build steps
- General UI refinement
- More pattern arrangement tools

## Running Locally

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Build the production version:

```bash
npm run build
```

Preview the production build:

```bash
npm run preview
```
