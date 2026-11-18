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

**Main engines:** procedural bells (`src/engine.js`) on gimbals that swing with the turn: copper regen-tube section, temper-coloured (straw, bronze, purple, blue) radiatively cooled extension, manifold and hatband rings, actuators, turbopump and feed lines. The metal heats up with thrust (dull red to orange to yellow) and cools slowly after shutdown; the inside glows from the throat down.

**Exhaust:** GPU particles (`src/gpufx.js`): the CPU writes each particle once at birth and the shader integrates it, so thousands are cheap. Layers: wispy plasma (white-hot to orange to deep red), a fast white core, spark and ember streaks, thin smoke on boost, heat shimmer (desktop). Ignition throws a flash, a shock ring, sparks and a smoke puff; boost adds a bigger blue-white ring, shock diamonds in the plume and a camera kick; shutdown chuffs smoke and embers. Bloom only picks up HDR values. Phones: under half the particles, no haze or bloom, particles carry their own halo.

**Look (rendering):** AgX tone mapping, hard warm key sun, cool planet-bounce fill and a cold rim light opposite the sun (`src/look.js`). Hull surfaces get panel seams, rivets, grime and bare-metal scratches from one procedural tile projected triplanar in object space (`src/hullDetail.js`), so the vertex-colour models need no UVs. The planet (`src/sky.js`) has continents, drifting clouds, amber night-side lights and an atmosphere limb; the sky is a dim Milky Way band over ~9k stars. Post: bloom, sun lens ghosts gated by whether the sun is actually visible, slate-shadow/warm-highlight grade, vignette; desktop adds MSAA, slight corner fringe and film grain. Phones skip bloom (their exhaust carries its own halo) and get grade + vignette only.

**World:** a few kilometres of low orbit with five sites (`src/sites.js`, layout in `LAYOUT`): the depot (the only lit, living structure: warm windows, blinking beacons, a floodlit catch frame with hazard bands), the Meridian (hero derelict at the origin, ring still turning), the Halves (a charred sister station snapped in two, fore half turning end over end), a broken freighter with racks of containers, and a debris graveyard. Wrecks are dark; light means people.

**Salvage HUD (wordless):** each site gets an icon + range marker that pins to the screen edge with an arrow when off-screen; the depot marker turns hazard orange while you tow, an unstable wreck blinks with a countdown. Corner brackets frame nearby salvage; the one the tow line would take is orange with its value. Credits and tow slots (diamonds) sit top centre. Docked at the depot, three upgrade tiles (thrust, winch, armour) show level pips and price. The tow line is a bone ribbon that heats to orange as it strains a weld.
