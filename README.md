# Low Orbit

A lone salvage pilot, zero gravity, collapsing stations. Three.js + Vite.

```
npm install
npm run dev
```

**Fly:** `W/S` thrust, `A/D` strafe, `Space/C` up/down, mouse or arrows to aim, `Q/E` roll, `Shift` boost, `X` brake, `Z` assist on/off (off = pure Newtonian drift), `I` invert Y.
**Touch:** left thumb stick = thrust/strafe, right side drag = aim, buttons for boost / up / brake / down / assist.

Visual identity: see [docs/identity.md](docs/identity.md).

## Layout
- `src/ship.js` — Newtonian ship model + tunables (`CFG`)
- `src/world.js` — derelict station, debris, planet, sky, collisions
- `src/camera.js` — lagging chase cam, speed FOV, shake, opening sweep
- `src/input.js` — keyboard / mouse / touch
- `src/hud.js` — speed, hull, assist, nose reticle, prograde marker

## Deploy

`npm run deploy` builds and uploads the game as a Cloudflare Worker (`low-orbit`). Needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in the environment.
