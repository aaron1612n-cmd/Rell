# Visual check shots: ship close-ups, station, chase. Usage: bash scripts/vis.sh <outdir>
cd "$(dirname "$0")/.." ; O=${1:-shots/vis}; mkdir -p $O
J='const g=window.__game; g.rig.update=()=>{}; g.ship.vel.set(0,0,0); g.ship.angVel.set(0,0,0); g.ship.pos.set(30,14,142); g.ship.quat.set(0,0,0,1); g.ship.step=()=>{}; document.querySelectorAll("#hud").forEach(e=>e.style.display="none");'
export WAIT=${WAIT:-5000}
node scripts/shot.mjs $O/ship-a.png 1280 720 "$J g.camera.position.set(30+3.6,14+1.6,142-4.6); g.camera.lookAt(30,14,142-.3);" &
node scripts/shot.mjs $O/ship-b.png 1280 720 "$J g.camera.position.set(30-3.4,14+1.4,142+4.8); g.camera.lookAt(30,14,142);" &
node scripts/shot.mjs $O/station.png 1280 720 "$J g.camera.position.set(60,30,120); g.camera.lookAt(0,0,0);" &
wait
node scripts/shot.mjs $O/chase-d.png 1280 720 "" &
node scripts/shot.mjs $O/chase-m.png 390 780 "" &
wait
