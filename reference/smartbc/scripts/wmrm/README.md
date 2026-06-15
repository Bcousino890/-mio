# wmrm — borrado de marcas de agua constantes

Motor que vive en el **VPS** (`/opt/wmrm`), no en la app. Lo invoca
`lib/sync/watermark-removal.ts` por cada foto cuya URL casa con un perfil
registrado (p.ej. Clikalia).

## Idea

Para una marca **constante** (mismo logo, misma posición/opacidad en todas las
fotos de la fuente) estimamos, a partir de **muchas** fotos con la marca:

- `W` — matte aditivo premultiplicado (`alpha * color_marca`)
- `beta` — `1 - alpha`, la atenuación, estimada por **reducción de varianza**
  (donde está la marca la varianza entre fotos baja en proporción a `1-alpha`)
- `smooth` — peso de suavizado, alto donde hay marca sobre **fondo liso**

Reconstrucción por foto: `J = (I - W) / beta` recupera el contenido bajo la
marca. En zonas lisas (paredes, puertas) el único relieve que queda es el
fantasma, así que ahí mezclamos `J` hacia su versión suavizada; en zonas con
textura real no se toca. Resultado: la marca desaparece sin inventar contenido
ni emborronar el detalle.

No usa PyTorch ni inpainting: solo `numpy` + `Pillow`. Rápido y gratis.

## Archivos

- `wm_remove.py` — CLI: `wm_remove.py <perfil> <in.jpg> <out.jpg>`. Carga
  `/opt/wmrm/profiles/<perfil>.npz` (`WMRM_PROFILES` para override).
- `bake_clikalia.py` — receta de horneado del perfil de Clikalia. Descarga un
  set de fotos 1280×720 con la marca, estima `W/beta/smooth` y guarda el `.npz`.

## Hornear un perfil nuevo

1. Reúne ~100+ fotos de la fuente con la marca, todas a la misma resolución
   (distintos fondos, misma marca).
2. Adapta `bake_clikalia.py` (rutas + resolución) y ejecútalo → `<perfil>.npz`.
3. Súbelo a `/opt/wmrm/profiles/<perfil>.npz` en el VPS.
4. Registra el patrón de URL de foto en `lib/sync/watermark-removal.ts`.

## Deploy al VPS

```
scp scripts/wmrm/wm_remove.py        root@VPS:/opt/wmrm/wm_remove.py
scp <perfil>.npz                     root@VPS:/opt/wmrm/profiles/<perfil>.npz
```

El venv `/opt/wmrm` ya tiene `numpy` y `pillow`.
