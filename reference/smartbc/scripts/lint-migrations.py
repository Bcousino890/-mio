#!/usr/bin/env python3
"""Linter de migraciones SQL: caza los errores que han roto deploys.

Comprueba TODAS las migraciones de supabase/migrations/ y FALLA (exit 1) si
encuentra alguno de los fallos que ya nos han tumbado el deploy:

  1. Referencia a `internal_users` — tabla que NO existe en este esquema.
     (El control de acceso va por is_admin()/is_staff() y la tabla `profiles`.)
  2. `UPDATE ... ORDER BY` a nivel superior — sintaxis inválida en PostgreSQL.

No revisa idempotencia (CREATE sin IF NOT EXISTS) para no dar falsos positivos
con el esquema inicial; el foco es bloquear lo que de verdad rompe.
"""
import sys, re, glob, os

errors: list[str] = []

for path in sorted(glob.glob("supabase/migrations/*.sql")):
    name = os.path.basename(path)
    sql = open(path, encoding="utf-8").read()
    # Quitar comentarios de línea y cuerpos dollar-quoted ($$...$$ de funciones),
    # para no analizar SQL de dentro de funciones plpgsql.
    nocomments = re.sub(r"--[^\n]*", "", sql)
    nobody = re.sub(r"\$(\w*)\$.*?\$\1\$", " BODY ", nocomments, flags=re.S)
    low = nobody.lower()

    if re.search(r"\binternal_users\b", low):
        errors.append(
            f"{name}: referencia a `internal_users` (tabla inexistente). "
            "Usa is_admin()/is_staff() y la tabla profiles."
        )

    # UPDATE ... ORDER BY al nivel superior (las subconsultas entre paréntesis sí
    # admiten ORDER BY, así que las quitamos antes de comprobar).
    for stmt in [s for s in nobody.split(";") if s.strip()]:
        l = stmt.lower()
        if not re.match(r"\s*update\b", l):
            continue
        stripped, prev = l, None
        while prev != stripped:
            prev = stripped
            stripped = re.sub(r"\([^()]*\)", " ", stripped)
        if re.search(r"\border\s+by\b", stripped):
            errors.append(
                f"{name}: `UPDATE ... ORDER BY` no es válido en PostgreSQL "
                "(usa una subconsulta con row_number() si necesitas orden)."
            )

if errors:
    print("❌ Migraciones con errores que romperían el deploy:")
    for e in errors:
        print("   -", e)
    sys.exit(1)

print("✅ Migraciones OK (sin internal_users ni UPDATE...ORDER BY)")
