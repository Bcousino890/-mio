'use client'

import { useRef, useState, useCallback } from 'react'
import { UploadCloud, Loader2, CheckCircle2, XCircle, FolderOpen } from 'lucide-react'

interface LogLine {
  id: number
  type: 'info' | 'ok' | 'error' | 'upload'
  text: string
  rows?: number
}

type Phase = 'idle' | 'uploading' | 'processing' | 'done'

function formatBytes(b: number) {
  if (b >= 1e9) return `${(b / 1e9).toFixed(2)} GB`
  if (b >= 1e6) return `${(b / 1e6).toFixed(0)} MB`
  return `${Math.round(b / 1024)} KB`
}
function formatSpeed(bps: number) {
  if (bps >= 1e6) return `${(bps / 1e6).toFixed(1)} MB/s`
  return `${Math.round(bps / 1024)} KB/s`
}
function formatEta(sec: number) {
  if (sec < 60) return `~${Math.round(sec)}s`
  if (sec < 3600) return `~${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s`
  return `~${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`
}
function fmtNum(n: number) { return n.toLocaleString('es-CL') }

let _id = 0
function uid() { return ++_id }

export default function IngestPanel() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<File[]>([])
  const [dragActive, setDragActive] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [log, setLog] = useState<LogLine[]>([])
  // upload stats
  const [uploadLoaded, setUploadLoaded] = useState(0)
  const [uploadTotal, setUploadTotal] = useState(0)
  const [uploadSpeed, setUploadSpeed] = useState(0)
  const [uploadEta, setUploadEta] = useState(0)
  // processing stats
  const [procFile, setProcFile] = useState<string | null>(null)
  const [procIdx, setProcIdx] = useState(0)
  const [procTotal, setProcTotal] = useState(0)
  const [elapsed, setElapsed] = useState(0)

  const logEndRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startTimeRef = useRef(0)

  const addLog = useCallback((line: Omit<LogLine, 'id'>) => {
    setLog(prev => [...prev, { ...line, id: uid() }].slice(-300))
    setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 20)
  }, [])

  function startTimer() {
    startTimeRef.current = Date.now()
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000))
    }, 1000)
  }
  function stopTimer() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
  }

  function addFiles(fl: FileList | null) {
    if (!fl) return
    setFiles(prev => [...prev, ...Array.from(fl)])
    setLog([]); setPhase('idle')
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

  function parseNdjsonChunk(chunk: string, buf: { v: string }) {
    buf.v += chunk
    const lines = buf.v.split('\n')
    buf.v = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const msg = JSON.parse(line)
        if (msg.phase === 'extracting') {
          addLog({ type: 'info', text: `Extrayendo ${msg.file}…` })
        }
        if (msg.phase === 'parcels') {
          if (msg.status === 'start')          { setProcTotal(msg.total); addLog({ type: 'info', text: `Procesando ${msg.total} archivos de predios…` }) }
          else if (msg.status === 'processing') { setProcFile(msg.file); setProcIdx(msg.index); addLog({ type: 'info', text: `[${msg.index}/${msg.total}] ${msg.file}` }) }
          else if (msg.status === 'ok')         addLog({ type: 'ok', text: msg.file, rows: msg.rows })
          else if (msg.status === 'error')      addLog({ type: 'error', text: `${msg.file}: ${msg.error}` })
          else if (msg.status === 'done')       addLog({ type: 'ok', text: `Predios: ${fmtNum(msg.totalRows)} filas en ${msg.filesProcessed} archivos` })
        }
        if (msg.phase === 'sii') {
          if (msg.status === 'start')        { setProcTotal(msg.total); addLog({ type: 'info', text: `Procesando ${msg.total} comunas SII…` }) }
          else if (msg.progress)             addLog({ type: 'info', text: msg.status ?? '' })
          else if (msg.status === 'done')    addLog({ type: 'ok', text: 'SII: ingesta completada' })
          else if (msg.status === 'skipped') addLog({ type: 'info', text: msg.message ?? 'Sin archivos SII' })
        }
        if (msg.done) {
          if (!msg.success) addLog({ type: 'error', text: msg.error ?? 'Error desconocido' })
          else addLog({ type: 'ok', text: '✓ Todo ingresado correctamente' })
        }
      } catch { /* línea incompleta */ }
    }
  }

  // ── fase 1: subir con XHR para progreso real ──────────────────────────────
  function uploadBatch(batch: File[]): Promise<{ name: string; path: string; size: number }[]> {
    return new Promise((resolve, reject) => {
      const form = new FormData()
      for (const f of batch) form.append('files', f)

      const total = batch.reduce((s, f) => s + f.size, 0)
      setUploadTotal(total); setUploadLoaded(0); setUploadSpeed(0); setUploadEta(0)

      const speedSamples: { t: number; b: number }[] = []

      const xhr = new XMLHttpRequest()
      xhr.open('POST', '/api/admin/upload-raw')

      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return
        const now = Date.now()
        setUploadLoaded(e.loaded)
        speedSamples.push({ t: now, b: e.loaded })
        if (speedSamples.length > 20) speedSamples.shift()
        if (speedSamples.length >= 2) {
          const dt = (speedSamples[speedSamples.length - 1].t - speedSamples[0].t) / 1000
          const db = speedSamples[speedSamples.length - 1].b - speedSamples[0].b
          const bps = dt > 0 ? db / dt : 0
          setUploadSpeed(bps)
          const remaining = e.total - e.loaded
          setUploadEta(bps > 0 ? remaining / bps : 0)
        }
      }
      xhr.upload.onload = () => { setUploadLoaded(total); setUploadSpeed(0); setUploadEta(0) }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText)
            if (data.success) resolve(data.files)
            else reject(new Error(data.error ?? 'Error en upload-raw'))
          } catch { reject(new Error('Respuesta inválida del servidor')) }
        } else {
          reject(new Error(`HTTP ${xhr.status}: ${xhr.statusText}`))
        }
      }
      xhr.onerror = () => reject(new Error('Error de red al subir'))
      xhr.send(form)
    })
  }

  // ── fase 2: procesar con NDJSON streaming ─────────────────────────────────
  function processPaths(paths: { name: string; path: string }[]): Promise<void> {
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', '/api/admin/ingest')
      xhr.setRequestHeader('Content-Type', 'application/json')
      xhr.responseType = 'text'

      const buf = { v: '' }
      let lastLen = 0

      xhr.onreadystatechange = () => {
        if (xhr.readyState >= 3 && xhr.responseText.length > lastLen) {
          parseNdjsonChunk(xhr.responseText.slice(lastLen), buf)
          lastLen = xhr.responseText.length
        }
        if (xhr.readyState === 4) {
          if (xhr.responseText.length > lastLen) parseNdjsonChunk(xhr.responseText.slice(lastLen), buf)
          if (xhr.status === 0) addLog({ type: 'error', text: 'Conexión cortada durante el procesamiento' })
          else if (xhr.status >= 400) addLog({ type: 'error', text: `HTTP ${xhr.status}` })
          resolve()
        }
      }
      xhr.onerror = () => { addLog({ type: 'error', text: 'Error de red durante procesamiento' }); resolve() }
      xhr.send(JSON.stringify({ paths }))
    })
  }

  async function handleStart() {
    if (!files.length || phase !== 'idle') return
    setLog([]); setElapsed(0); setProcIdx(0); setProcTotal(0); setProcFile(null)
    startTimer()

    const BATCH = 3 // lotes más pequeños para upload más estable
    const allPaths: { name: string; path: string }[] = []

    // ── fase 1: subida ────────────────────────────────────────────────────────
    setPhase('uploading')
    for (let start = 0; start < files.length; start += BATCH) {
      const batch = files.slice(start, start + BATCH)
      addLog({ type: 'upload', text: `↑ Subiendo ${batch.map(f => f.name).join(', ')} (${formatBytes(batch.reduce((s, f) => s + f.size, 0))})` })
      try {
        const uploaded = await uploadBatch(batch)
        allPaths.push(...uploaded)
        addLog({ type: 'ok', text: `Subida completada: ${uploaded.map(f => f.name).join(', ')}` })
      } catch (err) {
        addLog({ type: 'error', text: err instanceof Error ? err.message : 'Error al subir' })
        stopTimer(); setPhase('done'); return
      }
    }

    // ── fase 2: procesar ──────────────────────────────────────────────────────
    setPhase('processing')
    addLog({ type: 'info', text: `Procesando ${allPaths.length} archivo(s) en el servidor…` })
    await processPaths(allPaths)

    stopTimer(); setPhase('done')
  }

  const totalBytes = files.reduce((s, f) => s + f.size, 0)
  const uploadPct = uploadTotal > 0 ? Math.min(100, Math.round((uploadLoaded / uploadTotal) * 100)) : 0
  const running = phase === 'uploading' || phase === 'processing'

  return (
    <div className="rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)] p-4">
      <div className="flex items-center gap-2 mb-1">
        <FolderOpen size={14} className="text-blue-400" />
        <p className="text-sm font-semibold text-slate-200">Importar datos a la base de datos</p>
      </div>
      <p className="text-[11px] text-slate-500 mb-3">
        Sube cualquier archivo: CSV del SII, <code className="text-slate-400">.parquet</code>,{' '}
        <code className="text-slate-400">.gpkg</code>, <code className="text-slate-400">.zip</code> con varias comunas.
        Sin límite de tamaño. Detecta el tipo y lo ingesta automáticamente.
      </p>

      <input ref={inputRef} type="file" multiple className="hidden" onChange={e => addFiles(e.target.files)} />

      <div
        onDragEnter={handleDrag} onDragLeave={handleDrag} onDragOver={handleDrag} onDrop={handleDrop}
        onClick={() => !running && inputRef.current?.click()}
        className={`w-full border border-dashed rounded-lg py-5 text-xs text-center transition-colors mb-3 ${
          running ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'
        } ${dragActive
          ? 'border-blue-400 bg-blue-500/10 text-blue-300'
          : 'border-[var(--c-border-strong)] text-slate-500 hover:text-slate-300 hover:border-blue-500'
        }`}
      >
        <UploadCloud size={18} className="mx-auto mb-1 opacity-60" />
        Arrastra archivos aquí o click para elegir — cualquier tipo, cualquier tamaño
      </div>

      {files.length > 0 && (
        <div className="space-y-1 mb-3 max-h-36 overflow-y-auto">
          <p className="text-[10px] text-slate-500 mb-1">
            {files.length} archivo{files.length !== 1 ? 's' : ''} · {formatBytes(totalBytes)}
          </p>
          {files.map((f, i) => (
            <div key={`${f.name}-${i}`} className="flex items-center justify-between bg-[var(--c-hover)] rounded px-2 py-1">
              <span className="text-[11px] text-slate-300 truncate max-w-[70%]">{f.name}</span>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[10px] text-slate-600">{formatBytes(f.size)}</span>
                {!running && <button onClick={e => { e.stopPropagation(); removeFile(i) }} className="text-slate-600 hover:text-red-400 text-[11px]">✕</button>}
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
        {phase === 'uploading'
          ? uploadPct < 100 ? `Subiendo… ${uploadPct}%` : 'Guardando en servidor…'
          : phase === 'processing'
          ? procTotal > 0 ? `Procesando ${procIdx}/${procTotal}…` : 'Procesando…'
          : 'Importar a base de datos'}
      </button>

      {/* barra de subida */}
      {phase === 'uploading' && uploadTotal > 0 && (
        <div className="mb-3 bg-slate-900/60 rounded-lg p-3">
          <div className="flex justify-between text-[10px] mb-1.5">
            <span className="text-slate-400">
              {formatBytes(uploadLoaded)} / {formatBytes(uploadTotal)}
              {uploadSpeed > 0 && <span className="text-slate-500 ml-2">{formatSpeed(uploadSpeed)}</span>}
            </span>
            <span className="font-mono text-blue-400 font-semibold">{uploadPct}%</span>
          </div>
          <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 transition-all duration-200 rounded-full" style={{ width: `${uploadPct}%` }} />
          </div>
          {uploadEta > 2 && (
            <p className="text-[10px] text-slate-600 mt-1 text-right">{formatEta(uploadEta)} restantes</p>
          )}
        </div>
      )}

      {/* contador de tiempo durante procesamiento */}
      {phase === 'processing' && (
        <div className="mb-3 flex items-center justify-between text-[10px] text-slate-500 bg-slate-900/40 rounded-lg px-3 py-2">
          <span>
            {procFile ? <span className="text-slate-400 font-mono truncate max-w-[200px] inline-block">{procFile}</span> : 'Procesando…'}
          </span>
          <span className="font-mono shrink-0 ml-2">
            {procTotal > 0 && <span className="text-blue-400 mr-2">{procIdx}/{procTotal}</span>}
            ⏱ {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}
          </span>
        </div>
      )}

      {log.length > 0 && (
        <div className="bg-black/30 rounded-lg p-2 max-h-52 overflow-y-auto font-mono text-[10px] space-y-0.5">
          {log.map(l => (
            <div key={l.id} className={`flex items-start gap-1.5 ${
              l.type === 'ok' ? 'text-emerald-400' :
              l.type === 'error' ? 'text-red-400' :
              l.type === 'upload' ? 'text-blue-400' : 'text-slate-400'
            }`}>
              {l.type === 'ok'    && <CheckCircle2 size={10} className="mt-0.5 shrink-0" />}
              {l.type === 'error' && <XCircle size={10} className="mt-0.5 shrink-0" />}
              {(l.type === 'info' || l.type === 'upload') && <span className="shrink-0 opacity-50">›</span>}
              <span className="break-all">{l.text}{l.rows != null ? ` · ${fmtNum(l.rows)} predios` : ''}</span>
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      )}

      {phase === 'done' && (
        <button
          type="button"
          onClick={() => { setFiles([]); setLog([]); setPhase('idle'); setElapsed(0) }}
          className="mt-2 text-[11px] text-slate-500 hover:text-slate-300 w-full text-center"
        >
          Limpiar y subir más archivos
        </button>
      )}
    </div>
  )
}
