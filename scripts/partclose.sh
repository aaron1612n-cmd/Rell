# close-ups of suspect joints. usage: bash scripts/partclose.sh <outdir>
O=${1:-shots/close}; mkdir -p $O
J='const g=window.__game; g.rig.update=()=>{}; g.ship.vel.set(0,0,0); g.ship.angVel.set(0,0,0); g.ship.pos.set(30,14,142); g.ship.quat.set(0,0,0,1); g.ship.step=()=>{}; g.world.update=()=>{}; document.querySelectorAll("#hud, .hud").forEach(e=>e.style.display="none");'
s() { n=$1; x=$2; y=$3; z=$4; lx=$5; ly=$6; lz=$7; node scripts/shot.mjs $O/$n.png 900 600 "$J g.camera.position.set(30+$x,14+$y,142+$z); g.camera.lookAt(30+$lx,14+$ly,142+$lz); g.camera.fov=45; g.camera.updateProjectionMatrix();" & }
s arms-front 1.8 -1.2 -3.8 .3 -.5 -1.6
s arms-side 3.2 -.6 -1.6 .3 -.5 -1.6
s wingroot-front 2.6 .8 -1.8 1.2 -.1 .3
s wingroot-under 2.6 -1.4 -.8 1.2 -.15 .5
s wingtip 3.8 .6 -.4 2.3 -.1 .9
s tail 2.2 1.3 3.8 0 .8 1.7
s tail-side 3.6 1.0 2.0 0 .8 1.6
s pod-front 2.4 .6 -.6 .8 0 .5
wait
