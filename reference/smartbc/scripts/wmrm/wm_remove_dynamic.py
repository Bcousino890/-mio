#!/usr/bin/env python3
"""Borrado de marca de agua DINÁMICO (sin perfil horneado).

Uso:  wm_remove_dynamic.py <dir_entrada> <dir_salida>

Para fuentes donde cada anuncio trae la marca de SU agencia (Idealista, etc.):
estima la marca a partir de las PROPIAS fotos del anuncio. Como la marca escala
con la imagen, agrupa por tamaño exacto (así alinea), y por cada grupo con
suficientes fotos estima la marca por reducción de varianza y la quita (v3:
reconstrucción + suavizado adaptativo). Incluye DETECCIÓN: si en un grupo no hay
una marca constante clara, deja las fotos intactas (no daña anuncios sin marca).
"""
import sys, os, glob, collections
import numpy as np
from PIL import Image

MIN_PHOTOS = 12       # mínimo por grupo: con pocas fotos correlacionadas la
                      # estimación se va y "detecta" marca donde no la hay
DETECT_ALPHA = 0.30   # si la opacidad estimada no supera esto, no hay marca
# Una marca real es LOCALIZADA (un logo). Si la zona de alta opacidad ocupa
# demasiada superficie, es un falso positivo (fotos correlacionadas sin marca):
# NO se toca, para no destrozar las fotos.
MAX_STRONG_FRAC = 0.22

def boxmean(x, r):
    sq = x.ndim == 2
    if sq: x = x[..., None]
    pad = np.pad(x, ((r+1,r),(r+1,r),(0,0)), mode="reflect")
    ii = pad.cumsum(0).cumsum(1); h,w = x.shape[:2]
    o = (ii[2*r+1:2*r+1+h,2*r+1:2*r+1+w]-ii[0:h,2*r+1:2*r+1+w]
         -ii[2*r+1:2*r+1+h,0:w]+ii[0:h,0:w])/((2*r+1)**2)
    return o[...,0] if sq else o
def mbox(x,k,r): return boxmean(x*k,r)/np.maximum(boxmean(k,r),1e-6)

def estimate(files):
    """Devuelve (W_add, beta, wm_mask, alpha_max) para un grupo del MISMO tamaño."""
    im0 = Image.open(files[0]).convert("RGB")
    W, H = im0.size
    s = np.zeros((H,W,3)); s2 = np.zeros((H,W,3)); n=0
    for f in files:
        a = np.asarray(Image.open(f).convert("RGB"), np.float64)
        s += a; s2 += a*a; n += 1
    M = s/n; S = np.sqrt(np.maximum(s2/n - M*M, 0))
    R = max(18, W//32)
    Sg = S.mean(2)
    bg = boxmean(Sg,R); beta_g = np.clip(Sg/np.maximum(bg,1e-6),0.05,1)
    keep = None
    for _ in range(3):
        keep = (beta_g>0.9).astype(float)
        bg = mbox(Sg,keep,R); beta_g = np.clip(Sg/np.maximum(bg,1e-6),0.05,1)
    bg_mean = np.stack([mbox(M[...,c],keep,R) for c in range(3)], -1)
    beta = beta_g[...,None]; W_add = M - beta*bg_mean; alpha = 1-beta
    am = alpha.mean(2)
    # Máscara ANCHA (zona de la marca, para el color) y de TRAZOS (alta opacidad,
    # para el inpaint fino).
    wm = (am>0.06).astype(float); wm=(boxmean(wm,3)>0.25).astype(float); wm=boxmean(wm,4)
    strokes = (am > 0.30); strokes = boxmean(strokes.astype(float), 1) > 0.2
    strong_frac = float((am > 0.40).mean())
    return W_add, beta, wm[...,None], strokes, float(alpha.max()), strong_frac

def remove(path, out, W_add, beta, wm, strokes):
    I = np.asarray(Image.open(path).convert("RGB"), np.float64)
    J = (I - W_add)/beta
    # Quitar los TRAZOS de la marca por INPAINT de difusión: propaga el contenido
    # vecino hacia dentro de los trazos (sin sesgo oscuro -> sin motitas),
    # eliminando las líneas SIN emborronar el fondo (solo se rellenan los trazos
    # finos, no toda la zona).
    sm = strokes[..., None]
    rec = J.copy()
    for _ in range(14):
        rec = np.where(sm, boxmean(rec, 3), J)
    # Matar el TINTE de color residual SOLO en una banda PEGADA a los trazos (no en
    # toda la zona ancha de la marca: eso dejaba un velo borroso alrededor, muy
    # visible en marcas claras sobre paredes lisas). Dilatamos los trazos ~8px,
    # borde suave, y suavizamos el color ahí con radio corto. La luminancia se
    # mantiene nítida.
    band = (boxmean(strokes.astype(float), 8) > 0.04).astype(float)
    wC = np.clip(boxmean(band, 3), 0, 1)[..., None]
    lum = rec.mean(2)
    chroma = rec - lum[..., None]
    chroma_out = (1 - wC) * chroma + wC * boxmean(chroma, 5)
    final = lum[..., None] + chroma_out
    Image.fromarray(np.clip(final, 0, 255).astype(np.uint8)).save(out, quality=92)

def main():
    if len(sys.argv) != 3:
        print("uso: wm_remove_dynamic.py <in> <out>", file=sys.stderr); sys.exit(2)
    indir, outdir = sys.argv[1], sys.argv[2]
    os.makedirs(outdir, exist_ok=True)
    files = sorted(glob.glob(os.path.join(indir, "*")))
    files = [f for f in files if f.lower().endswith((".jpg",".jpeg",".png",".webp"))]

    groups = collections.defaultdict(list)
    for f in files:
        try: groups[Image.open(f).size].append(f)
        except Exception: pass

    cleaned = 0; passed = 0
    for size, gfiles in groups.items():
        profile = None
        if len(gfiles) >= MIN_PHOTOS:
            W_add, beta, wm, strokes, amax, strong_frac = estimate(gfiles)
            if amax >= DETECT_ALPHA and strong_frac <= MAX_STRONG_FRAC:
                profile = (W_add, beta, wm, strokes)
                print(f"  grupo {size} x{len(gfiles)}: marca detectada (alpha={amax:.2f}, zona={strong_frac*100:.0f}%) -> limpiando")
            elif amax >= DETECT_ALPHA:
                print(f"  grupo {size} x{len(gfiles)}: descartado por zona demasiado amplia ({strong_frac*100:.0f}%) -> intactas (falso positivo)")
            else:
                print(f"  grupo {size} x{len(gfiles)}: sin marca clara (alpha={amax:.2f}) -> intactas")
        else:
            print(f"  grupo {size} x{len(gfiles)}: pocas fotos -> intactas")
        for f in gfiles:
            out = os.path.join(outdir, os.path.basename(f))
            if profile:
                remove(f, out, *profile); cleaned += 1
            else:
                Image.open(f).convert("RGB").save(out, quality=92); passed += 1
    print(f"TOTAL: {cleaned} limpiadas, {passed} intactas")

if __name__ == "__main__":
    main()
