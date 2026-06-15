# Hornea el perfil de Clikalia (W/beta/smooth) a partir de un set de fotos
# 1280x720 con la marca. Ver scripts/wmrm/README.md. Salida: clik_profile.npz.
import glob, numpy as np
from PIL import Image

files = sorted(glob.glob('/tmp/clikset/*.jpg'))
H, W = 720, 1280
s = np.zeros((H, W, 3)); s2 = np.zeros((H, W, 3)); n = 0
for f in files:
    a = np.asarray(Image.open(f).convert('RGB').resize((W, H)), np.float64)
    s += a; s2 += a*a; n += 1
M = s/n; S = np.sqrt(np.maximum(s2/n - M*M, 0))

def boxmean(x, r):
    sq = x.ndim == 2
    if sq: x = x[..., None]
    pad = np.pad(x, ((r+1,r),(r+1,r),(0,0)), mode='reflect')
    ii = pad.cumsum(0).cumsum(1); H2, W2 = x.shape[:2]
    o = (ii[2*r+1:2*r+1+H2,2*r+1:2*r+1+W2]-ii[0:H2,2*r+1:2*r+1+W2]
         -ii[2*r+1:2*r+1+H2,0:W2]+ii[0:H2,0:W2])/((2*r+1)**2)
    return o[...,0] if sq else o
def mbox(x, k, r): return boxmean(x*k, r)/np.maximum(boxmean(k, r), 1e-6)

R = 28
bg_std = boxmean(S, R); beta = np.clip(S/np.maximum(bg_std,1e-6), 0.05, 1)
for _ in range(3):
    keep = (beta > 0.9).astype(np.float64)
    bg_std = mbox(S, keep, R); bg_mean = mbox(M, keep, R)
    beta = np.clip(S/np.maximum(bg_std,1e-6), 0.05, 1)
W_add = M - beta*bg_mean
alpha = 1 - beta

# --- mapa de suavizado: alto donde hay marca Y el fondo es liso ---
wm = (alpha.mean(2) > 0.05).astype(np.float64)          # hay marca
wm = (boxmean(wm, 2) > 0.3).astype(np.float64)          # rellena huecos
# textura del fondo estimado (gradiente local de bg_mean en gris)
g = bg_mean.mean(2)
gx = np.abs(np.gradient(g, axis=1)); gy = np.abs(np.gradient(g, axis=0))
tex = boxmean(gx+gy, 6)
smooth_w = wm * np.exp(-tex/2.0)                         # 1 si liso, 0 si texturado
smooth_w = boxmean(smooth_w, 3)[..., None]
print("smooth_w max", round(float(smooth_w.max()),2), "| alpha max", round(float(alpha.max()),3))

np.savez('/tmp/clik_profile.npz', W=W_add.astype(np.float32),
         beta=beta.astype(np.float32), smooth=smooth_w.astype(np.float32))

def apply(path, out):
    im = Image.open(path).convert('RGB'); ow, oh = im.size
    a = np.asarray(im.resize((W, H)), np.float64)
    J = (a - W_add)/beta
    Jb = boxmean(J, 8)                                    # version suavizada
    final = (1-smooth_w)*J + smooth_w*Jb
    Image.fromarray(np.clip(final,0,255).astype(np.uint8)).resize((ow,oh)).save(out, quality=92)

for idx in [17, 20, 23]:
    apply(f'/tmp/clikset/{idx:03d}.jpg', f'/tmp/H_{idx:03d}.jpg')
print("OK")
