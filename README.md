# TrackForge

TrackForge is a local-first 2D track editor and racing game built with Phaser 4,
strict TypeScript 7, Vite, and modular HTML/CSS UI.

## Run locally

Install dependencies once:

```powershell
npm install
```

Start the development server:

```powershell
npm run dev
```

Open the URL printed by Vite, normally <http://localhost:5173>.

## Controls

- Home: choose **Track Editor** or **Race**.
- Editor: use the tool rail, mouse/touch canvas, undo/redo, and surface buttons.
- Race: steer with `A`/`D` or the arrow keys and brake with `S`, `ArrowDown`,
  or `Space`. Touching the canvas steers toward the touched side.
- Use the race menu to pause, resume, or return home.

## Verification

```powershell
npm run verify
```

Individual gates are also available:

```powershell
npm test
npm run typecheck
npm run lint
npm run build
npm run preview
```

The original `trackforge.html` remains as a migration reference and is not loaded
by the Vite application.
