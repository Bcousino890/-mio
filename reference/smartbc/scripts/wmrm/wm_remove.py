#!/usr/bin/env python3
"""Borrado de marca de agua CONSTANTE por perfil (v3).

Uso:  wm_remove.py <perfil> <entrada.jpg> <salida.jpg>

El perfil (/opt/wmrm/profiles/<perfil>.npz) lleva dos mapas estimados a partir
de muchas fotos con la MISMA marca:
  W     = matte aditivo premultiplicado (= alpha * color_marca)
  beta  = 1 - alpha  (atenuacion; estimada por reduccion de varianza)

Reconstruccion:  J = (I - W) / beta   recupera el contenido bajo la marca.

El fantasma residual solo se nota en superficies LISAS (paredes, puertas). Asi
que suavizamos J hacia su version difuminada SOLO donde, EN ESTA foto, el pixel
es realmente liso (poca alta frecuencia). En muebles, bordes, TV, etc. no se
toca: quedan nitidos. Es per-imagen, por eso no emborrona toda la foto.
"""
import sys, os
import numpy as np
from PIL import Image


def boxmean(x, r):
    sq = x.ndim == 2
    if sq:
        x = x[..., None]
    pad = np.pad(x, ((r + 1, r), (r + 1, r), (0, 0)), mode="reflect")
    ii = pad.cumsum(0).cumsum(1)
    h, w = x.shape[:2]
    o = (
        ii[2 * r + 1 : 2 * r + 1 + h, 2 * r + 1 : 2 * r + 1 + w]
        - ii[0:h, 2 * r + 1 : 2 * r + 1 + w]
        - ii[2 * r + 1 : 2 * r + 1 + h, 0:w]
        + ii[0:h, 0:w]
    ) / ((2 * r + 1) ** 2)
    return o[..., 0] if sq else o


def load_profile(name):
    base = os.environ.get("WMRM_PROFILES", "/opt/wmrm/profiles")
    d = np.load(os.path.join(base, name + ".npz"))
    return d["W"].astype(np.float64), d["beta"].astype(np.float64)


# Fuerza del criterio de "liso": mas alto = suaviza mas zonas (mas limpio pero
# arriesga emborronar); mas bajo = mas conservador (mas nitido, mas fantasma).
SMOOTH_K = 3.0


def main():
    if len(sys.argv) != 4:
        print("uso: wm_remove.py <perfil> <in.jpg> <out.jpg>", file=sys.stderr)
        sys.exit(2)
    profile, inp, outp = sys.argv[1], sys.argv[2], sys.argv[3]

    W, beta = load_profile(profile)
    ph, pw = W.shape[:2]
    alpha = 1.0 - beta

    # Mascara de marca (donde hay algo que quitar), dilatada y con borde suave.
    wm = (alpha.mean(2) > 0.06).astype(np.float64)
    wm = (boxmean(wm, 3) > 0.25).astype(np.float64)
    wm = boxmean(wm, 4)

    im = Image.open(inp).convert("RGB")
    ow, oh = im.size
    I = np.asarray(im.resize((pw, ph)), np.float64)

    J = (I - W) / beta

    # Detalle (alta frecuencia) de ESTA foto reconstruida.
    g = J.mean(2)
    detail = boxmean(np.abs(g - boxmean(g, 3)), 4)
    flat = np.exp(-detail / SMOOTH_K)  # ~1 liso, ~0 con detalle

    w = (wm * flat)[..., None]
    Jb = boxmean(J, 6)
    final = (1.0 - w) * J + w * Jb
    final = np.clip(final, 0, 255).astype(np.uint8)

    Image.fromarray(final).resize((ow, oh)).save(outp, quality=92)


if __name__ == "__main__":
    main()
