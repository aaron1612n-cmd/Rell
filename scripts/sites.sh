# Site overview shots (depot, wrecks, field). Usage: bash scripts/sites.sh <outdir>  (vite on :5173)
cd "$(dirname "$0")/.." ; O=${1:-shots/sites}; mkdir -p $O
J='const g=window.__game; g.rig.update=()=>{}; g.ship.vel.set(0,0,0); g.ship.step=()=>{}; g.econ.tut=true; g.tutorial.start=()=>{}; g.tutorial.finish(); g.shipMesh.visible=false; g.cockpit.update=()=>{}; document.querySelectorAll("#hud").forEach(e=>e.style.display="none");'
look() { echo "$J const s=g.world.site.$1; const p=s.pos.clone().add(new g.THREE.Vector3($2)); g.ship.pos.copy(p); g.world.refreshActive(p,true); g.camera.position.copy(p); g.camera.lookAt(s.pos.clone().add(new g.THREE.Vector3(${3:-0,0,0})));"; }
export WAIT=${WAIT:-4000}
node scripts/shot.mjs $O/depot.png 1280 720 "$(look depot '-150,60,-260' '0,0,-20')"
node scripts/shot.mjs $O/depot-catch.png 1280 720 "$(look depot '30,20,-150' '0,0,-60')"
node scripts/shot.mjs $O/halves.png 1280 720 "$(look halves '220,90,180')"
node scripts/shot.mjs $O/freighter.png 1280 720 "$(look freighter '-200,70,160')"
node scripts/shot.mjs $O/field.png 1280 720 "$(look field '0,40,320')"
node scripts/shot.mjs $O/meridian.png 1280 720 "$(look meridian '120,40,200')"
