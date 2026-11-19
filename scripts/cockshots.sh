# Cockpit screenshots: forward (desktop + phone), facing the sun, boosting. Usage: bash scripts/cockshots.sh <outdir>  (needs vite on :5173)
cd "$(dirname "$0")/.." ; O=${1:-shots/cockpit}; mkdir -p $O
B='const g=window.__game; g.cockpit.toggle(); g.cockpit.blend=1;'
F="$B g.ship.step=()=>{};"
SUN="$B const T=g.THREE; const m=new T.Matrix4().lookAt(new T.Vector3(), new T.Vector3(0.62,0.5,0.6), new T.Vector3(0,1,0)); g.ship.quat.setFromRotationMatrix(m); g.ship.step=()=>{};"
export WAIT=${WAIT:-4000}
node scripts/shot.mjs $O/fwd-desktop.png 1280 720 "$F" &
node scripts/shot.mjs $O/fwd-phone.png 390 780 "$F" &
wait
node scripts/shot.mjs $O/sun-desktop.png 1280 720 "$SUN" &
node scripts/shot.mjs $O/boost-desktop.png 1280 720 "$B g.input.keys.add('KeyW'); g.input.keys.add('ShiftLeft');" &
wait
