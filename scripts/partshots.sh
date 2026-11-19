# Ship from many angles to spot detached parts. usage: bash scripts/partshots.sh <outdir>  (vite on :5173)
O=${1:-shots/parts}; mkdir -p $O
J='const g=window.__game; g.rig.update=()=>{}; g.ship.vel.set(0,0,0); g.ship.angVel.set(0,0,0); g.ship.pos.set(30,14,142); g.ship.quat.set(0,0,0,1); g.ship.step=()=>{}; g.world.update=()=>{}; document.querySelectorAll("#hud, .hud").forEach(e=>e.style.display="none");'
s() { n=$1; w=$2; h=$3; x=$4; y=$5; z=$6; lx=${7:-0}; ly=${8:-0}; lz=${9:-0.3}; node scripts/shot.mjs $O/$n.png $w $h "$J g.camera.position.set(30+$x,14+$y,142+$z); g.camera.lookAt(30+$lx,14+$ly,142+$lz);" & }
for W in "1100 650 d" "420 700 m"; do set -- $W; w=$1; h=$2; t=$3
  s side-$t $w $h 7 0 .3 0 0 .2
  s top-$t $w $h .01 7 .3 0 0 .3
  s front34-$t $w $h 4 2 -5
  s rear34-$t $w $h -4 2.2 6
  s under-$t $w $h 3 -4 3 0 -.3 .3
  s front-$t $w $h 0 .2 -8
  wait
done
