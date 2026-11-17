cd /home/user/rell
J='const g=window.__game; g.rig.update=()=>{}; g.ship.step=()=>{}; g.world.update=(dt)=>{g.world.updateRing(0.0)}; document.querySelectorAll("#hud, .hud").forEach(e=>e.style.display="none");'
node scripts/shot.mjs shots/st1.png 1280 720 "$J g.camera.position.set(60,30,150); g.camera.lookAt(0,0,60);"
node scripts/shot.mjs shots/st2.png 1280 720 "$J g.camera.position.set(-70,35,-10); g.camera.lookAt(0,0,-10);"
node scripts/shot.mjs shots/st3.png 1280 720 "$J g.camera.position.set(25,15,115); g.camera.lookAt(0,2,85);"
