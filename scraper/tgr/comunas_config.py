#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Configuración de comunas - Región Metropolitana de Santiago
Orden de procesamiento: editable, se respeta tal cual está la lista.

IMPORTANTE: los nombres deben coincidir con el texto exacto que aparece
en el <select> de comuna del formulario de TGR. Verificar esto en
inspeccion/form.html (generado por inspect_form.py) y ajustar aquí si
el sitio usa una grafía distinta (con/sin tilde, mayúsculas, etc.)
"""

# Orden de procesamiento solicitado: Las Condes, Vitacura, Lo Barnechea
# primero, luego el resto de la Región Metropolitana.
COMUNAS_METROPOLITANA_ORDEN = [
    # ── Prioridad solicitada ──
    "Las Condes",
    "Lo Barnechea",
    "Vitacura",

    # ── Resto Provincia de Santiago ──
    "Providencia",
    "Santiago",
    "Ñuñoa",
    "La Reina",
    "Macul",
    "Peñalolén",
    "La Florida",
    "San Miguel",
    "San Joaquín",
    "La Cisterna",
    "El Bosque",
    "La Granja",
    "La Pintana",
    "San Ramón",
    "Pedro Aguirre Cerda",
    "Lo Espejo",
    "Estación Central",
    "Cerrillos",
    "Maipú",
    "Pudahuel",
    "Cerro Navia",
    "Lo Prado",
    "Quinta Normal",
    "Renca",
    "Quilicura",
    "Conchalí",
    "Independencia",
    "Recoleta",
    "Huechuraba",

    # ── Provincia de Cordillera ──
    "Puente Alto",
    "Pirque",
    "San José de Maipo",

    # ── Provincia de Maipo ──
    "San Bernardo",
    "Buin",
    "Calera de Tango",
    "Paine",

    # ── Provincia de Talagante ──
    "Talagante",
    "El Monte",
    "Isla de Maipo",
    "Padre Hurtado",
    "Peñaflor",

    # ── Provincia de Melipilla ──
    "Melipilla",
    "Alhué",
    "Curacaví",
    "María Pinto",
    "San Pedro",

    # ── Provincia de Chacabuco ──
    "Colina",
    "Lampa",
    "Tiltil",
]

REGION_TEXTO = "Región Metropolitana de Santiago"
# Si el <select> de región usa otro texto exacto (ej. "XIII - Región
# Metropolitana de Santiago"), ajustar aquí tras la inspección.


def orden_comuna(nombre_comuna: str) -> int:
    """Devuelve la posición de una comuna en el orden de procesamiento.
    Comunas no listadas van al final, en el orden en que aparezcan."""
    try:
        return COMUNAS_METROPOLITANA_ORDEN.index(nombre_comuna)
    except ValueError:
        return len(COMUNAS_METROPOLITANA_ORDEN) + 1
