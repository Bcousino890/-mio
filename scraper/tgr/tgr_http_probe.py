#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
🔬 EXPERIMENTAL — Probe HTTP directo para TGR (NO toca el scraper Selenium).

Objetivo: determinar si el endpoint TraerCertificadoDeudasAction.do se puede
consultar por HTTP directo (requests.Session) sin Selenium, y en particular
si el servidor valida server-side el campo g-recaptcha-response o solo lo
recibe. Es una prueba de factibilidad controlada — NO un reemplazo.

Este archivo es ADITIVO y aislado. El scraper estable (tgr_scraper.py) no se
modifica. Para volver al estado estable basta con borrar este archivo o hacer
checkout del commit f2ffb4f.

Uso:
    python3 tgr_http_probe.py --rol 2922 --subrol 21 --comuna 71 --region 13
    python3 tgr_http_probe.py --rol 2922 --subrol 21 --comuna 71 --token "<g-recaptcha-response real>"
    python3 tgr_http_probe.py --token-reuse-suite --token "<token>" --rol 2922 --subrol 21 --comuna 71

Salida: JSON por línea con status_code, tiempos, marcadores encontrados.
"""

import argparse
import json
import sys
import time

import requests

BASE = "https://www.tesoreria.cl/CertDeudasRolCutAixWeb"
URL_FORM = f"{BASE}/Controller.jpf?RUT=0&DV=0&EMAIL="
URL_BEGIN = f"{BASE}/begin.do"
URL_POST = f"{BASE}/TraerCertificadoDeudasAction.do"

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")


def nueva_sesion() -> requests.Session:
    """GET inicial al formulario para capturar cookies (TS* del F5, JSESSIONID)."""
    s = requests.Session()
    s.headers.update({
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "es-CL,es;q=0.9",
    })
    r = s.get(URL_FORM, timeout=30)
    r.raise_for_status()
    return s


def analizar_respuesta(texto: str) -> dict:
    """Marcadores crudos sin depender del parser (que arrastra pdfplumber)."""
    low = texto.lower()
    return {
        "tiene_base64PDF": "base64pdf" in low,
        "tiene_data_pdf": "data:application/pdf" in low,
        "tiene_request_rejected": "request rejected" in low or "support id" in low,
        "tiene_recaptcha_error": "recaptcha" in low and ("inv" in low or "error" in low),
        "menciona_deuda": "deuda" in low,
        "menciona_certificado": "certificado" in low,
        "menciona_rol": "rol" in low,
    }


def consultar(s: requests.Session, region: str, comuna: str, rol: str,
              subrol: str, token: str) -> dict:
    payload = {
        "region": region,
        "comuna": comuna,
        "rol": rol,
        "subRol": subrol,
        "g-recaptcha-response": token,
    }
    headers = {
        "Content-Type": "application/x-www-form-urlencoded",
        "Origin": "https://www.tesoreria.cl",
        "Referer": URL_BEGIN,
        "X-Requested-With": "XMLHttpRequest",
    }
    t0 = time.time()
    try:
        r = s.post(URL_POST, data=payload, headers=headers, timeout=45,
                   allow_redirects=True)
    except Exception as e:  # noqa: BLE001
        return {"error": f"{type(e).__name__}: {e}", "elapsed_s": round(time.time() - t0, 2)}
    dt = round(time.time() - t0, 2)
    out = {
        "status_code": r.status_code,
        "elapsed_s": dt,
        "len": len(r.text),
        "final_url": r.url,
        "token_len": len(token),
    }
    out.update(analizar_respuesta(r.text))
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--region", default="13")
    ap.add_argument("--comuna", required=True)
    ap.add_argument("--rol", required=True)
    ap.add_argument("--subrol", required=True)
    ap.add_argument("--token", default="", help="g-recaptcha-response real (vacío = test de no-validación)")
    ap.add_argument("--token-reuse-suite", action="store_true",
                    help="Batería: mismo token repetido, otro rol, tras pausas")
    ap.add_argument("--dump", default="", help="Guardar HTML de respuesta a este path")
    args = ap.parse_args()

    s = nueva_sesion()
    cookies = {c.name: c.value[:16] for c in s.cookies}
    print(json.dumps({"evento": "sesion", "cookies": list(cookies.keys())}, ensure_ascii=False))

    res = consultar(s, args.region, args.comuna, args.rol, args.subrol, args.token)
    res["caso"] = "token_vacio" if not args.token else "token_provisto"
    print(json.dumps(res, ensure_ascii=False))

    if args.dump:
        # repetir guardando cuerpo (rápido, mismo flujo) para inspección
        r = s.post(URL_POST, data={"region": args.region, "comuna": args.comuna,
                                   "rol": args.rol, "subRol": args.subrol,
                                   "g-recaptcha-response": args.token},
                   headers={"Content-Type": "application/x-www-form-urlencoded",
                            "Origin": "https://www.tesoreria.cl", "Referer": URL_BEGIN},
                   timeout=45)
        with open(args.dump, "w", encoding="utf-8") as f:
            f.write(r.text)
        print(json.dumps({"evento": "dump", "path": args.dump, "bytes": len(r.text)}))

    return 0


if __name__ == "__main__":
    sys.exit(main())
