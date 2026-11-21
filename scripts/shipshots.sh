cd /home/user/rell
J='const g=window.__game; g.rig.update=()=>{}; g.ship.vel.set(0,0,0); g.ship.angVel.set(0,0,0); g.ship.pos.set(30,14,142); g.ship.quat.set(0,0,0,1); g.ship.step=()=>{}; g.world.update=()=>{}; document.querySelectorAll("#hud, .hud").forEach(e=>e.style.display="none");'
node scripts/shot.mjs shots/ship1.png 1000 600 "$J g.camera.position.set(30+3.2,14+1.8,142-4.2); g.camera.lookAt(30,14,142-.3);"
node scripts/shot.mjs shots/ship2.png 1000 600 "$J g.camera.position.set(30-3.2,14+1.2,142+4.4); g.camera.lookAt(30,14,142);"
node scripts/shot.mjs shots/ship3.png 1000 600 "$J g.camera.position.set(30+0.5,14+6,142+0.5); g.camera.lookAt(30,14,142);"
