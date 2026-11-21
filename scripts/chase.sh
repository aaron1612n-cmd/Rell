cd /home/user/rell
export WAIT=9000
node scripts/shot.mjs shots/chase-d.png 1280 720 "addEventListener('keydown',()=>{}); window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyW'})); window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyD'}));"
node scripts/shot.mjs shots/chase-m.png 390 780 "window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyW'}));"
