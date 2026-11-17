# Low Orbit — visual identity

**Mood:** a salvage crew's last shift. Raking low sun, long hard shadows, a quiet planet below. Industrial, worn, lonely — not neon, not glossy.

**Palette (one accent):**
- Void `#07090d` — space
- Bone `#cfc6b0` — hull plating, UI text
- Rust `#5a4a3f` — shadowed/damaged plating
- Slate `#1b2a33` — planet and haze
- Hazard `#ff5a1f` — the only accent: thrusters, HUD state, warning stripes

**Type:** DIN-style condensed sans for numerals (big, tabular), small monospace for micro-labels. Almost no words; icons and state do the talking.

**Layout:** HUD hugs the edges and leaves the view clear. Speed is large bottom-left, hull is a segmented bar on the right edge, a prograde marker floats in the scene. Flat-shaded low-poly forms with painted panel texture, hard sun, no gradients on UI.

**Motion:** one deliberate moment — the opening camera sweep that swings around the ship to reveal the station. Everything else is physics. Reduced-motion skips the sweep, shake and FOV warp.

**Controls overlay:** a small ? button (top right) or H/F1 toggles icon + one-word key/touch layouts. Brake icon is four inward arrows to a dot.

**RCS:** 14 cool-white nozzles (layout in `src/rcs.js`, easy to re-map for the .glb ship) fire in proportion to the acceleration actually applied each frame, so assist, brake, strafe, roll and look all show as short jets opposite the motion they push or cancel. Hazard orange stays reserved for the main engines.

**Models (authored):** ship, station (21 named chunks with colliders) and 9 debris props are built by scripted Blender (`tools/blender/*.py`, run with the `bpy` pip module, no GUI) and exported as meshopt-compressed .glb (`npm run assets`). Colour and baked ambient occlusion live in vertex colours: no textures. Chamfered hard-surface edges, hazard bands, one orange accent. The ship's RCS layout is exported with the model (`ship.json`) and read by `src/rcs.js`.
