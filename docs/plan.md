# Low Orbit: next stage plan

## Where we are
Flight, chase cam, collisions, 90 drifting debris, keyboard/mouse/touch input and the identity (docs/identity.md) are done and feel good. What holds it back is how it looks and that there is nothing to *do*. Everything in `world.js` is boxes with a canvas panel texture, and the station is a static set of OBB colliders.

## Recommendation in one line
Fix the look first (art pipeline + hero assets), because every later feature (break-up, salvage, tutorial) is built on those assets. Then give the game a reason to exist (break-up + salvage loop), then teach it (tutorial), then polish (audio, perf).

## Models: procedural vs authored
**Recommend authored glTF (.glb), made in code-assisted Blender, plus procedural for the small stuff.**

- Procedural boxes cannot reach "cool". Beveled edges, greebles, panel breaks and believable silhouettes are the difference, and they need modelling.
- Authored hero assets: player ship, the station (split into ~30-60 named chunks, see break-up), 6-8 debris types (tank, solar panel, truss, hatch, engine bell, container, antenna dish, hull plate).
- Procedural stays for: dust, stars, planet, sparks, small rocks/fragments, hazard stripes.
- Pipeline: model in Blender (can be scripted with `bpy` from a thread, no GUI needed), export .glb with Draco or meshopt compression, load with `GLTFLoader`. Budget: ship 8-12k tris, station chunks 40-80k total, debris 300-1.5k each.
- Bake ambient occlusion and wear into one 1024 or 2048 texture atlas per asset set (bone/rust/hazard per identity). Baked AO is the biggest single quality win for low-poly and costs nothing at runtime.
- Use `InstancedMesh` for repeated debris so 90+ pieces stay cheap.
- Lighting upgrade: one hard sun with a tight shadow frustum that follows the ship, a dim slate fill from the planet, a small PMREM environment from the existing sky for metal highlights, and emissive hazard-orange lights bloomed lightly (one cheap bloom pass, desktop only).
- Fallback if Blender is not available in the cloud container: generate the models with a code-based kit-bash (beveled/chamfered geometry via script, merged and baked at build time). Lower ceiling but still a real step up. A thread should check this first.

## Chunks, in recommended order

### 1. Art pipeline + lighting (Sonnet, then Opus if the bake tooling is hard)
glTF loader, asset folder, compression, shadow cascade that follows the ship, PMREM env, optional bloom toggle, quality tiers (see 8). Ends with one test asset on screen. Unblocks everything.

### 2. Player ship model (Sonnet)
Replace `shipMesh.js` with a glb: readable silhouette from behind, emissive thrusters that drive the existing exhaust particles, a few moving parts (RCS puffs). Keep collision radius as is.

### 3. Station and debris models (Sonnet, may split in two)
Rebuild the station as named chunks (hull sections, ring segments, panels, cargo pods, antennae) and the debris family. Each chunk carries a mass, a collider, and a "cut line" to its neighbours. Doing this at the same time as break-up avoids remodelling.

### 4. Stations break apart (Opus, tricky physics)
- Station becomes a graph of chunks joined by weak welds. Hard hits, overstress, or a scripted event snap welds.
- Detached chunks become dynamic bodies that reuse the existing sphere/OBB collision, with a few fragments and sparks per break.
- Need proper OBB-vs-dynamic handling for big chunks (today only spheres move). Keep a cap on active dynamic pieces for performance.
- This is the signature moment of the game, so it deserves care: slow rotation, long shadows crossing the chunks, a camera shake via the existing shake system.

### 5. Salvage loop (Sonnet)
Fly in, grab, haul out, cash in. Proposal:
- Tractor beam on hold: pulls cargo pieces toward the ship, costs nothing but needs line of sight and proximity.
- Hold limit by cargo mass; heavy pieces slow the ship (already Newtonian, so this feels natural).
- Deliver to a drop beacon or the orbiting depot. Value by part type (orange-tagged items are worth the most).
- Stakes: hull, plus the station slowly failing on a timer so you choose what to take. The break-up from chunk 4 *is* the clock.
- Progress: simple upgrades (thrust, cargo, beam range) bought with salvage. Save in `localStorage`.
- Keep HUD wordless: icons, bars, orange for state.

### 6. Wordless tutorial (Sonnet)
Per the project rule: learn by doing, at most one word per step, skippable, replayable from the menu. Steps are ghost prompts in the world: reach the glowing ring (thrust), turn to a marker (aim), boost through a gap, brake to a stop, grab one piece, drop it at the beacon. Show input glyphs for keyboard, mouse or touch depending on the detected device. Needs the salvage loop first, so it goes after 5.

### 7. Audio (Sonnet)
Web Audio, no heavy files. Synthesised: thruster hiss that follows throttle, hull creak and low drone, impact thuds scaled by speed, metal tear for break-up, beam hum, UI ticks. Muffled-in-vacuum feel: sound is "inside the ship". A short ambient loop (authored, small .ogg) for mood. Mute and volume in the menu, audio starts on first input to satisfy browser autoplay rules.

### 8. Mobile performance pass (Sonnet)
Do the basics early (during chunk 1) and a final pass here.
- Quality tiers by device: DPR cap (1.5 on phones), shadow map size, bloom off, fewer dust and particles, no per-frame allocations.
- Collision: replace the O(n²) debris pair loop with a spatial hash before adding more bodies; sleep far-away debris.
- Draw calls: instancing, merged static chunks, shared materials. Target 60 fps on a mid phone, 30 fps floor.
- Add a tiny FPS probe that drops a tier automatically.

### 9. Menu, pause, game over, save (Haiku or Sonnet)
Small and wordless: start, replay tutorial, mute, invert Y, quality. Goes in wherever there is slack.

## Order
1 pipeline → 2 ship → 3 station and debris → 4 break-up → 5 salvage → 6 tutorial → 7 audio → 8 perf (basics in 1) → 9 menu.

Max two threads at once. Safe parallel pairs: 2 with 7 (ship model and audio touch different files), and 8-basics with 9. Do 3 before 4, and 5 before 6.

## Decisions for Aaron
1. Are you happy with authored .glb models built via Blender scripting? (Recommended. The alternative is code-only kit-bashing, which is faster but looks less rich.)
2. Salvage stakes: hull plus a station-failing timer (recommended), or relaxed no-fail mode?
3. Should we keep the single hero station, or plan for several stations as levels later?
