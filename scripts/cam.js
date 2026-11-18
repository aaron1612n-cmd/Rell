// helper snippets: window.cam(px,py,pz, tx,ty,tz) relative to ship
window.__cam = (o, t) => { const g = window.__game; g.rig.update = () => {}; const s = g.ship.pos;
  g.camera.position.set(s.x + o[0], s.y + o[1], s.z + o[2]); const q = g.ship.quat;
  g.camera.lookAt(s.x + t[0], s.y + t[1], s.z + t[2]); g.camera.updateMatrixWorld(); };
