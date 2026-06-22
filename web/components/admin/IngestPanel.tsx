'use client'

import { useRef, useState, useCallback } from 'react'
import { UploadCloud, Loader2, CheckCircle2, XCircle, FolderOpen } from 'lucide-react'

interface LogLine {
  id: number
  type: 'info' | 'ok' | 'error' | 'upload'
  text: string
  rows?: number
}

function formatBytes(b: number) {
  if (b >= 1e9) return `${(b / 1e9).toFixed(1)} GB`
  if (b >= 1e6) return `${(b / 1e6).toFixed(0)} MB`
  return `${Math.round(b / 1024)} KB`
}
function fmtNum(n: number) { return n.toLocaleString('es-CL') }

let _id = 0
function uid() { return ++_id }

export default function IngestPanel() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<File[]>([])
  const [dragActive, setDragActive] = useState(false)
  const [running, setRunning] = useState(false)
  const [log, setLog] = useState<LogLine[]>([])
  const [uploadPct, setUploadPct] = useState<number | null>(null)
  const [done, setDone] = useState(false)
  const logEndRef = useRef<HTMLDivElement>(null)

  const addLog = useCallback((line: Omit<LogLine, 'id'>) => {
    setLog(prev => {
      const next = [...prev, { ...line, id: uid() }]
      return next.slice(-200)
    })
    setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 20)
  }, [])

  function addFiles(fl: FileList | null) {
    if (!fl) return
    setFiles(prev => [...prev, ...Array.from(fl)])
    setLog([]); setDone(false); setUploadPct(null)
  }
  function removeFile(i: number) { setFiles(prev => prev.filter((_, j) => j !== i)) }

  function handleDrag(e: React.DragEvent) {
    e.preventDefault(); e.stopPropagation()
    setDragActive(e.type === 'dragenter' || e.type === 'dragover')
  }
  function handleDrop(e: React.DragEvent) {
    e.preventDefault(); e.stopPropagation()
    setDragActive(false); addFiles(e.dataTransfer.files)
  }

  function processNdjsonChunk(chunk: string, buf: { v: string }) {
    buf.v += chunk
    const lines = buf.v.split('\n')
    buf.v = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const msg = JSON.parse(line)
        if (msg.phase === 'extracting') addLog({ type: 'info', text: `Extrayendo ${msg.file}…` })
        if (msg.phase === 'parcels') {
          if (msg.status === 'start')          addLog({ type: 'info', text: `Procesando ${msg.total} archivos de predios…` })
          else if (msg.status === 'processing') addLog({ type: 'info', text: `[${msg.index}/${msg.total}] ${msg.file}` })
          else if (msg.status === 'ok')         addLog({ type: 'ok', text: msg.file, rows: msg.rows })
          else if (msg.status === 'error')      addLog({ type: 'error', text: `${msg.file}: ${msg.error}` })
          else if (msg.status === 'done')       addLog({ type: 'ok', text: `Predios: ${fmtNum(msg.totalRows)} filas en ${msg.filesProcessed} archivos` })
        }
        if (msg.phase === 'sii') {
          if (msg.status === 'start')    addLog({ type: 'info', text: `Procesando ${msg.total} comunas SII…` })
          else if (msg.progress)         addLog({ type: 'info', text: msg.status ?? JSON.stringify(msg) })
          else if (msg.status === 'done') addLog({ type: 'ok', text: 'SII: ingesta completada' })
          else if (msg.status === 'skipped') addLog({ type: 'info', text: msg.message ?? 'Sin archivos SII' })
        }
        if (msg.done) {
          if (!msg.success) addLog({ type: 'error', text: msg.error ?? 'Error desconocido' })
          else addLog({ type: 'ok', text: '✓ Todo listo' })
        }
      } catch { /* línea incompleta */ }
    }
  }

  async function handleStart() {
    if (!files.length || running) return
    setRunning(true); setLog([]); setDone(false); setUploadPct(null)

    const BATCH = 5
    for (let start = 0; start < files.length; start += BATCH) {
      const batch = files.slice(start, start + BATCH)
      const form = new FormData()
      for (const f of batch) form.append('files', f)

      const batchNames = batch.map(f => f.name).join(', ')
      const batchBytes = batch.reduce((s, f) => s + f.size, 0)
      addLog({ type: 'upload', text: `Subiendo ${batchNames} (${formatBytes(batchBytes)})…` })

      await new Promise<void>((resolve) => {
        const xhr = new XMLHttpRequest()
        xhr.open('POST', '/api/admin/ingest')
        xhr.responseType = 'text'

        // progreso de subida (upload.onprogress da bytes enviados al servidor)
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setUploadPct(Math.round((e.loaded / e.total) * 100))
        }
        xhr.upload.onload = () => setUploadPct(100)

        // streaming de la respuesta NDJSON mientras llega
        const buf = { v: '' }
        let lastLen = 0
        xhr.onreadystatechange = () => {
          if (xhr.readyState >= 3 && xhr.responseText.length > lastLen) {
            const newChunk = xhr.responseText.slice(lastLen)
            lastLen = xhr.responseText.length
            processNdjsonChunk(newChunk, buf)
          }
          if (xhr.readyState === 4) {
            // procesar cualquier resto
            if (xhr.responseText.length > lastLen) {
              processNdjsonChunk(xhr.responseText.slice(lastLen), buf)
            }
            if (xhr.status === 0 || xhr.status >= 400) {
              addLog({ type: 'error', text: `Error HTTP ${xhr.status || 'red caída'}` })
            }
            resolve()
          }
        }
        xhr.onerror = () => { addLog({ type: 'error', text: 'Error de red' }); resolve() }
        xhr.send(form)
      })
    }

    setRunning(false); setUploadPct(null); setDone(true)
  }

  const totalBytes = files.reduce((s, f) => s + f.size, 0)

  return (
    <div className="rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)] p-4">
      <div className="flex items-center gap-2 mb-1">
        <FolderOpen size={14} className="text-blue-400" />
        <p className="text-sm font-semibold text-slate-200">Importar datos a la base de datos</p>
      </div>
      <p className="text-[11px] text-slate-500 mb-3">
        Sube cualquier archivo: CSV del SII, <code className="text-slate-400">.parquet</code>,{' '}
        <code className="text-slate-400">.gpkg</code>, <code className="text-slate-400">.zip</code> con varias comunas, etc.
        El sistema detecta el tipo y lo ingesta automáticamente. Sin límite de tamaño.
      </p>

      <input ref={inputRef} type="file" multiple className="hidden" onChange={e => addFiles(e.target.files)} />

      <div
        onDragEnter={handleDrag} onDragLeave={handleDrag} onDragOver={handleDrag} onDrop={handleDrop}
        onClick={() => !running && inputRef.current?.click()}
        className={`w-full border border-dashed rounded-lg py-5 text-xs text-center transition-colors mb-3 ${
          running ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
        } ${
          dragActive
            ? 'border-blue-400 bg-blue-500/10 text-blue-300'
            : 'border-[var(--c-border-strong)] text-slate-500 hover:text-slate-300 hover:border-blue-500'
        }`}
      >
        <UploadCloud size={18} className="mx-auto mb-1 opacity-60" />
        Arrastra archivos aquí o click para elegir — cualquier tipo, cualquier tamaño
      </div>

      {files.length > 0 && (
        <div className="space-y-1 mb-3 max-h-40 overflow-y-auto">
          <p className="text-[10px] text-slate-500 mb-1">
            {files.length} archivo{files.length !== 1 ? 's' : ''} · {formatBytes(totalBytes)}
          </p>
          {files.map((f, i) => (
            <div key={`${f.name}-${i}`} className="flex items-center justify-between bg-[var(--c-hover)] rounded px-2 py-1">
              <span className="text-[11px] text-slate-300 truncate">{f.name}</span>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[10px] text-slate-600">{formatBytes(f.size)}</span>
                {!running && (
                  <button onClick={e => { e.stopPropagation(); removeFile(i) }} className="text-slate-600 hover:text-red-400 text-[11px]">✕</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <button
        type="button" onClick={handleStart}
        disabled={running || files.length === 0}
        className="flex items-center justify-center gap-1.5 w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-medium px-3 py-2 rounded-lg transition-colors mb-3"
      >
        {running ? <Loader2 size={12} className="animate-spin" /> : <UploadCloud size={12} />}
        {running
          ? uploadPct != null && uploadPct < 100
            ? `Subiendo… ${uploadPct}%`
            : 'Procesando…'
          : 'Importar a base de datos'}
      </button>

      {running && uploadPct != null && uploadPct < 100 && (
        <div className="mb-3">
          <div className="flex justify-between text-[10px] text-slate-500 mb-1">
            <span>Subiendo al servidor…</span>
            <span className="font-mono text-blue-400">{uploadPct}%</span>
          </div>
          <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-all duration-300 rounded-full"
              style={{ width: `${uploadPct}%` }}
            />
          </div>
        </div>
      )}

      {log.length > 0 && (
        <div className="bg-black/30 rounded-lg p-2 max-h-48 overflow-y-auto font-mono text-[10px] space-y-0.5">
          {log.map(l => (
            <div key={l.id} className={`flex items-start gap-1.5 ${
              l.type === 'ok' ? 'text-emerald-400' :
              l.type === 'error' ? 'text-red-400' :
              l.type === 'upload' ? 'text-blue-400' :
              'text-slate-400'
            }`}>
              {l.type === 'ok'    && <CheckCircle2 size={10} className="mt-0.5 shrink-0" />}
              {l.type === 'error' && <XCircle size={10} className="mt-0.5 shrink-0" />}
              {(l.type === 'info' || l.type === 'upload') && <span className="shrink-0">›</span>}
              <span className="break-all">{l.text}{l.rows != null ? ` · ${fmtNum(l.rows)} predios` : ''}</span>
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      )}

      {done && log.some(l => l.type === 'ok' && l.text.includes('✓')) && (
        <button
          type="button" onClick={() => { setFiles([]); setLog([]); setDone(false) }}
          className="mt-2 text-[11px] text-slate-500 hover:text-slate-300 w-full text-center"
        >
          Limpiar y subir más archivos
        </button>
      )}
    </div>
  )
}
