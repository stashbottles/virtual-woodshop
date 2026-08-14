# Virtual Woodshop

Virtual Woodshop is a React and TypeScript woodworking pattern simulator for planning cutting-board designs before going into the shop.

The app lets users create boards, cut them, flip them, rotate them, glue them, and preserve the visual pattern history through multiple woodworking operations.

## Why I Built It

Woodworking patterns can become hard to visualize after pieces are ripped, glued, crosscut, flipped to end grain, rotated, and glued again.

I built this project to experiment with patterns before cutting real material.

The main challenge was making sure the visual pattern does not collapse into a simple species label after multiple transformations.

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
- Experimental 45-degree corner cut workflow
- Inventory and scrap handling
- Undo and redo
- Save and load design variants

## Tech Stack

- React
- TypeScript
- Vite
- Custom pattern engine
- Custom project/workflow logic

## Project Structure

```text
src/App.tsx
src/shopEngine.ts
src/projectEngine.ts
src/workflowEngine.ts
Current Status

The app currently uses a simplified workflow:

MATERIAL | CUT | GLUE

The core pattern engine supports common end-grain cutting-board workflows:

rip → glue → crosscut → convert to END → rotate → glue again

The 45-degree corner cut feature is experimental. The center-square pattern behavior works, but triangle cutoff rendering still needs more real-world calibration.

Future Improvements
Improve triangle cutoff rendering
Add clearer guided workflows
Improve inventory organization
Add exportable build steps
Refine the user interface
Add more pattern arrangement tools
Running Locally

Install dependencies:

npm install

Start the development server:

npm run dev

Build the production version:

npm run build

Preview the production build:

npm run preview

5. Press:

```text
Command + S

Then commit it:

git add README.md
git commit -m "Add project README"
git push