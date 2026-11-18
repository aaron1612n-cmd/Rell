# before/after: bash scripts/_cmp.sh <name> '<js>' [w h]
N=$1; J=$2; W=${3:-1280}; H=${4:-720}; D=/tmp/claude-0/diag
node scripts/_q.mjs "$J" $D/$N-new.png $W $H 6000 >/dev/null
git stash -q; node scripts/_q.mjs "$J" $D/$N-old.png $W $H 6000 >/dev/null; git stash pop -q
python3 -c "
import numpy as np; from PIL import Image
a=np.array(Image.open('$D/$N-old.png').convert('RGB')); b=np.array(Image.open('$D/$N-new.png').convert('RGB'))
Image.fromarray(np.hstack([a,b])).save('$D/$N-cmp.png'); print('meandiff', np.abs(a.astype(int)-b).mean())"
