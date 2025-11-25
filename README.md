# Voxel Craft MVP

A lightweight, browser-based voxel world built with **three.js** and plain JavaScript. It focuses on terrain, chunked rendering, basic physics, and block interaction — optimized for high FPS on mid-range PCs.

## Features
- Procedural voxel terrain with height variation (grass/dirt).
- Chunked mesh generation (16x16) with hidden-face culling for fewer draw calls.
- Dynamic chunk loading around the player to keep performance high.
- First-person controls with gravity, jumping, step climbing, and collisions.
- Block placement/removal with mouse (LMB place, RMB remove).
- Simple HUD showing FPS and player position.

## Stack
- three.js (via CDN, ES module)
- HTML + CSS + JavaScript (no build step)

## Running locally
You only need a static file server to satisfy ES module loading in the browser:
```bash
# Option 1: Python 3
python -m http.server 8000
# Option 2: serve (Node)
npx serve .
```
Then open `http://localhost:8000` in your browser.

## Controls
- `WASD`: move
- `Space`: jump
- `Shift`: run
- Mouse: look around (pointer lock)
- **Left click**: place a grass block
- **Right click**: remove a block

## Project structure
- `index.html` — page shell and HUD
- `style.css` — layout and overlay styling
- `main.js` — scene setup, terrain, chunks, physics, controls, block actions

## Notes on performance
- Chunk meshes merge visible faces only (internal faces culled).
- View distance limited by chunk radius to reduce geometry and draw calls.
- Materials are simple Lambert with vertex colors; no heavy textures or shadows.
- Renderer pixel ratio clamped for balanced clarity/performance.
