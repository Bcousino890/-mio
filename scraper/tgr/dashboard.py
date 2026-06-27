#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
📊 DASHBOARD DE MONITOREO — Scraper TGR

Levanta un servidor web liviano en el VPS para ver el progreso en vivo,
con un sidebar que lista las comunas en el orden de procesamiento.

Uso:
    python3 dashboard.py --port 8080

Luego abrir desde el navegador: http://IP_DEL_VPS:8080
(si el VPS tiene firewall, abrir el puerto: ufw allow 8080)

Solo LEE la base de datos (no interfiere con el scraper, que sigue
escribiendo en paralelo gracias a SQLite WAL mode).
"""

import argparse
import sqlite3
from pathlib import Path

from flask import Flask, jsonify, render_template_string

from comunas_config import COMUNAS_METROPOLITANA_ORDEN

DB_PATH = Path("data/tgr_metropolitana.db")

app = Flask(__name__)


def conn():
    c = sqlite3.connect(DB_PATH, timeout=10)
    c.execute("PRAGMA journal_mode=WAL;")
    return c


def stats_globales() -> dict:
    if not DB_PATH.exists():
        return {"total": 0, "con_deuda": 0, "sin_deuda": 0, "errores": 0, "monto_total_deuda": 0}
    with conn() as c:
        total = c.execute("SELECT COUNT(*) FROM certificados").fetchone()[0]
        con_deuda = c.execute("SELECT COUNT(*) FROM certificados WHERE tiene_deuda = 1").fetchone()[0]
        sin_deuda = c.execute("SELECT COUNT(*) FROM certificados WHERE estado = 'sin_deuda'").fetchone()[0]
        errores = c.execute("SELECT COUNT(*) FROM certificados WHERE estado = 'error'").fetchone()[0]
        monto = c.execute(
            "SELECT COALESCE(SUM(total_deuda_no_vencida),0) + COALESCE(SUM(total_deuda_morosa),0) FROM certificados"
        ).fetchone()[0]
        return {
            "total": total, "con_deuda": con_deuda, "sin_deuda": sin_deuda,
            "errores": errores, "monto_total_deuda": monto,
        }


def stats_por_comuna() -> dict:
    resultado = {}
    if not DB_PATH.exists():
        return resultado
    with conn() as c:
        rows = c.execute("""
            SELECT comuna, COUNT(*) as total,
                   SUM(CASE WHEN tiene_deuda=1 THEN 1 ELSE 0 END) as con_deuda,
                   SUM(CASE WHEN estado='error' THEN 1 ELSE 0 END) as errores
            FROM certificados GROUP BY comuna
        """).fetchall()
        for comuna, total, con_deuda, errores in rows:
            resultado[comuna] = {"total": total, "con_deuda": con_deuda, "errores": errores}
    return resultado


def ultimos_resultados(n: int = 20) -> list:
    if not DB_PATH.exists():
        return []
    with conn() as c:
        rows = c.execute("""
            SELECT rol, comuna, nombre, tiene_deuda, total_deuda_no_vencida, estado, fecha_consulta
            FROM certificados ORDER BY fecha_consulta DESC LIMIT ?
        """, (n,)).fetchall()
        return [
            {
                "rol": r[0], "comuna": r[1], "nombre": r[2], "tiene_deuda": bool(r[3]),
                "monto": r[4], "estado": r[5], "fecha": r[6],
            }
            for r in rows
        ]


@app.route("/api/stats")
def api_stats():
    globales = stats_globales()
    por_comuna = stats_por_comuna()

    sidebar = []
    for comuna in COMUNAS_METROPOLITANA_ORDEN:
        info = por_comuna.get(comuna, {"total": 0, "con_deuda": 0, "errores": 0})
        if info["total"] == 0:
            estado = "pendiente"
        elif info["errores"] > 0:
            estado = "con_errores"
        else:
            estado = "en_curso"  # no sabemos el total esperado de la comuna, así que no marcamos "completada" automáticamente
        sidebar.append({"comuna": comuna, **info, "estado_visual": estado})

    return jsonify({
        "globales": globales,
        "sidebar": sidebar,
        "ultimos": ultimos_resultados(20),
    })


PAGINA = """
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Monitor Scraper TGR</title>
<style>
  :root {
    --bg: #0f1115; --panel: #171a21; --border: #262b36;
    --text: #e6e8eb; --muted: #8b93a1; --green: #3ddc84;
    --red: #ff5c5c; --yellow: #ffcc66; --accent: #5b8cff;
  }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font-family: -apple-system, Segoe UI, Roboto, sans-serif; }
  .layout { display:flex; min-height:100vh; }
  .sidebar { width: 280px; background:var(--panel); border-right:1px solid var(--border); padding:16px; overflow-y:auto; }
  .sidebar h2 { font-size:13px; color:var(--muted); text-transform:uppercase; letter-spacing:0.05em; margin:0 0 12px; }
  .comuna-item { display:flex; justify-content:space-between; align-items:center; padding:8px 10px; border-radius:8px; margin-bottom:4px; font-size:13px; }
  .comuna-item.pendiente { color:var(--muted); }
  .comuna-item.en_curso { background:#1e2530; color:var(--text); }
  .comuna-item.con_errores { background:#2a1c1c; color:var(--red); }
  .comuna-badge { font-size:11px; color:var(--muted); }
  .main { flex:1; padding:24px 32px; }
  .header { display:flex; justify-content:space-between; align-items:baseline; margin-bottom:24px; }
  .header h1 { font-size:20px; margin:0; }
  .header .sub { color:var(--muted); font-size:13px; }
  .cards { display:grid; grid-template-columns: repeat(5, 1fr); gap:14px; margin-bottom:28px; }
  .card { background:var(--panel); border:1px solid var(--border); border-radius:12px; padding:16px; }
  .card .label { color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:0.04em; }
  .card .value { font-size:26px; font-weight:600; margin-top:4px; }
  .card.green .value { color:var(--green); }
  .card.red .value { color:var(--red); }
  .card.accent .value { color:var(--accent); }
  table { width:100%; border-collapse: collapse; font-size:13px; }
  th { text-align:left; color:var(--muted); font-weight:500; padding:8px 10px; border-bottom:1px solid var(--border); }
  td { padding:8px 10px; border-bottom:1px solid var(--border); }
  .tag { padding:2px 8px; border-radius:6px; font-size:11px; }
  .tag.exitosa { background:#1c2e22; color:var(--green); }
  .tag.sin_deuda { background:#1c2330; color:var(--muted); }
  .tag.error { background:#2a1c1c; color:var(--red); }
  .panel { background:var(--panel); border:1px solid var(--border); border-radius:12px; padding:16px; }
  .panel h2 { font-size:14px; margin:0 0 12px; color:var(--muted); text-transform:uppercase; letter-spacing:0.04em; }
</style>
</head>
<body>
<div class="layout">
  <div class="sidebar">
    <h2>TGR DUEÑO</h2>
    <div id="sidebar-list"></div>
  </div>
  <div class="main">
    <div class="header">
      <h1>🚀 Monitor Scraper TGR</h1>
      <div class="sub" id="ultima-actualizacion">actualizando...</div>
    </div>

    <div class="cards">
      <div class="card"><div class="label">Total procesados</div><div class="value" id="c-total">0</div></div>
      <div class="card red"><div class="label">Con deuda</div><div class="value" id="c-con-deuda">0</div></div>
      <div class="card"><div class="label">Sin deuda</div><div class="value" id="c-sin-deuda">0</div></div>
      <div class="card red"><div class="label">Errores</div><div class="value" id="c-errores">0</div></div>
      <div class="card accent"><div class="label">Monto detectado</div><div class="value" id="c-monto">CLP 0</div></div>
    </div>

    <div class="panel">
      <h2>Últimos resultados</h2>
      <table>
        <thead>
          <tr><th>ROL</th><th>Comuna</th><th>Nombre</th><th>Deuda</th><th>Monto</th><th>Estado</th></tr>
        </thead>
        <tbody id="tabla-ultimos"></tbody>
      </table>
    </div>
  </div>
</div>

<script>
function formatoCLP(n) {
  if (!n) return "—";
  return "CLP " + Math.round(n).toLocaleString("es-CL");
}

async function actualizar() {
  try {
    const res = await fetch("/api/stats");
    const data = await res.json();

    document.getElementById("c-total").textContent = data.globales.total.toLocaleString("es-CL");
    document.getElementById("c-con-deuda").textContent = data.globales.con_deuda.toLocaleString("es-CL");
    document.getElementById("c-sin-deuda").textContent = data.globales.sin_deuda.toLocaleString("es-CL");
    document.getElementById("c-errores").textContent = data.globales.errores.toLocaleString("es-CL");
    document.getElementById("c-monto").textContent = formatoCLP(data.globales.monto_total_deuda);

    const sidebar = document.getElementById("sidebar-list");
    sidebar.innerHTML = "";
    data.sidebar.forEach(item => {
      const div = document.createElement("div");
      div.className = "comuna-item " + item.estado_visual;
      div.innerHTML = `<span>${item.comuna}</span><span class="comuna-badge">${item.total} (${item.con_deuda} deuda${item.errores ? ", " + item.errores + " err" : ""})</span>`;
      sidebar.appendChild(div);
    });

    const tabla = document.getElementById("tabla-ultimos");
    tabla.innerHTML = "";
    data.ultimos.forEach(r => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${r.rol}</td>
        <td>${r.comuna}</td>
        <td>${r.nombre || "—"}</td>
        <td>${r.tiene_deuda ? "Sí" : "No"}</td>
        <td>${formatoCLP(r.monto)}</td>
        <td><span class="tag ${r.estado}">${r.estado}</span></td>
      `;
      tabla.appendChild(tr);
    });

    document.getElementById("ultima-actualizacion").textContent =
      "actualizado " + new Date().toLocaleTimeString("es-CL");
  } catch (e) {
    document.getElementById("ultima-actualizacion").textContent = "error de conexión, reintentando...";
  }
}

actualizar();
setInterval(actualizar, 5000);
</script>
</body>
</html>
"""


@app.route("/")
def index():
    return render_template_string(PAGINA)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--host", default="0.0.0.0")
    args = parser.parse_args()

    print(f"📊 Dashboard corriendo en http://{args.host}:{args.port}")
    app.run(host=args.host, port=args.port, debug=False)
