'use client'

import { useRef, useState, useCallback, useEffect } from 'react'
import { UploadCloud, Loader2, CheckCircle2, XCircle, FolderOpen, Server, RefreshCw, Play } from 'lucide-react'

interface LogLine {
  id: number
  type: 'info' | 'ok' | 'error' | 'upload'
  text: string
  rows?: number
}

interface ServerFile {
  name: string
  path: string
  size: number
  mtime: string
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
function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

let _id = 0
function uid() { return ++_id }

export default function IngestPanel() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<File[]>([])
  const [dragActive, setDragActive] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [log, setLog] = useState<LogLine[]>([])
  const [uploadLoaded, setUploadLoaded] = useState(0)
  const [uploadTotal, setUploadTotal] = useState(0)
  const [uploadSpeed, setUploadSpeed] = useState(0)
  const [uploadEta, setUploadEta] = useState(0)
  const [procFile, setProcFile] = useState<string | null>(null)
  const [procIdx, setProcIdx] = useState(0)
  const [procTotal, setProcTotal] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [serverFiles, setServerFiles] = useState<ServerFile[]>([])
  const [serverFilesLoading, setServerFilesLoading] = useState(false)
  const [selectedServerFiles, setSelectedServerFiles] = useState<Set<string>>(new Set())

  const logEndRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startTimeRef = useRef(0)

  const addLog = useCallback((line: Omit<LogLine, 'id'>) => {
    setLog(prev => [...prev, { ...line, id: uid() }].slice(-300))
    setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 20)
  }, [])

  function startTimer() {
    startTimeRef.current = Date.now()
    timerRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000)), 1000)
  }
  function stopTimer() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
  }

  async function loadServerFiles() {
    setServerFilesLoading(true)
    try {
      const res = await fetch('/api/admin/ingest')
      const data = await res.json()
      setServerFiles(data.files ?? [])
    } catch { /* ignorar */ }
    setServerFilesLoading(false)
  }

  useEffect(() => { loadServerFiles() }, [])

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
        if (msg.phase === 'extracting') addLog({ type: 'info', text: `Extrayendo ${msg.file}…` })
        if (msg.phase === 'parcels') {
          if (msg.status === 'start')           { setProcTotal(msg.total); addLog({ type: 'info', text: `Procesando ${msg.total} archivos de predios…` }) }
          else if (msg.status === 'processing')  { setProcFile(msg.file); setProcIdx(msg.index) }
          else if (msg.status === 'ok')          addLog({ type: 'ok', text: msg.file, rows: msg.rows })
          else if (msg.status === 'error')       addLog({ type: 'error', text: `${msg.file}: ${msg.error}` })
          else if (msg.status === 'done')        addLog({ type: 'ok', text: `Predios: ${fmtNum(msg.totalRows)} filas en ${msg.filesProcessed} archivos` })
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
        setUploadLoaded(e.loaded)
        speedSamples.push({ t: Date.now(), b: e.loaded })
        if (speedSamples.length > 20) speedSamples.shift()
        if (speedSamples.length >= 2) {
          const dt = (speedSamples.at(-1)!.t - speedSamples[0].t) / 1000
          const db = speedSamples.at(-1)!.b - speedSamples[0].b
          const bps = dt > 0 ? db / dt : 0
          setUploadSpeed(bps)
          setUploadEta(bps > 0 ? (e.total - e.loaded) / bps : 0)
        }
      }
      xhr.upload.onload = () => { setUploadLoaded(total); setUploadSpeed(0); setUploadEta(0) }
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText)
            if (data.success) resolve(data.files)
            else reject(new Error(data.error ?? 'Error en upload-raw'))
          } catch { reject(new Error('Respuesta inválida')) }
        } else { reject(new Error(`HTTP ${xhr.status}`)) }
      }
      xhr.onerror = () => reject(new Error('Error de red al subir'))
      xhr.send(form)
    })
  }

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
    const allPaths: { name: string; path: string }[] = []
    setPhase('uploading')
    for (let start = 0; start < files.length; start += 3) {
      const batch = files.slice(start, start + 3)
      addLog({ type: 'upload', text: `↑ ${batch.map(f => f.name).join(', ')} (${formatBytes(batch.reduce((s, f) => s + f.size, 0))})` })
      try {
        const uploaded = await uploadBatch(batch)
        allPaths.push(...uploaded)
        addLog({ type: 'ok', text: `Guardado: ${uploaded.map(f => f.name).join(', ')}` })
      } catch (err) {
        addLog({ type: 'error', text: err instanceof Error ? err.message : 'Error al subir' })
        stopTimer(); setPhase('done'); return
      }
    }
    setPhase('processing')
    addLog({ type: 'info', text: `Procesando ${allPaths.length} archivo(s)…` })
    await processPaths(allPaths)
    stopTimer(); setPhase('done')
    loadServerFiles()
  }

  async function handleProcessServerFiles() {
    if (phase !== 'idle' || selectedServerFiles.size === 0) return
    const paths = serverFiles.filter(f => selectedServerFiles.has(f.path)).map(f => ({ name: f.name, path: f.path }))
    setLog([]); setElapsed(0); setProcIdx(0); setProcTotal(0); setProcFile(null)
    startTimer()
    setPhase('processing')
    addLog({ type: 'info', text: `Procesando ${paths.length} archivo(s) del servidor…` })
    await processPaths(paths)
    stopTimer(); setPhase('done')
    loadServerFiles()
  }

  const totalBytes = files.reduce((s, f) => s + f.size, 0)
  const uploadPct = uploadTotal > 0 ? Math.min(100, Math.round((uploadLoaded / uploadTotal) * 100)) : 0
  const running = phase === 'uploading' || phase === 'processing'

  return (
    <div className="rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)] p-4 space-y-4">
      <div className="flex items-center gap-2">
        <FolderOpen size={14} className="text-blue-400" />
        <p className="text-sm font-semibold text-slate-200">Importar datos a la base de datos</p>
      </div>

      {/* archivos ya en el servidor */}
      {(serverFiles.length > 0 || serverFilesLoading) && (
        <div className="border border-emerald-900/40 rounded-lg p-3 bg-emerald-950/20">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <Server size={12} className="text-emerald-400" />
              <span className="text-[11px] font-medium text-emerald-300">
                {serverFiles.length} archivo{serverFiles.length !== 1 ? 's' : ''} ya en el servidor
              </span>
            </div>
            <button onClick={loadServerFiles} disabled={serverFilesLoading} className="text-slate-500 hover:text-slate-300">
              <RefreshCw size={11} className={serverFilesLoading ? 'animate-spin' : ''} />
            </button>
          </div>

          <div className="space-y-1 max-h-40 overflow-y-auto mb-2">
            {serverFiles.map(f => (
              <label key={f.path} className="flex items-center gap-2 cursor-pointer group py-0.5">
                <input
                  type="checkbox"
                  checked={selectedServerFiles.has(f.path)}
                  onChange={e => {
                    setSelectedServerFiles(prev => {
                      const n = new Set(prev)
                      if (e.target.checked) n.add(f.path); else n.delete(f.path)
                      return n
                    })
                  }}
                  className="accent-emerald-500"
                  disabled={running}
                />
                <span className="text-[11px] text-slate-300 truncate flex-1 group-hover:text-white">{f.name}</span>
                <span className="text-[10px] text-slate-500 shrink-0">{formatBytes(f.size)}</span>
                <span className="text-[10px] text-slate-700 shrink-0">{fmtDate(f.mtime)}</span>
              </label>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button onClick={() => setSelectedServerFiles(new Set(serverFiles.map(f => f.path)))} className="text-[10px] text-slate-500 hover:text-slate-300">Todo</button>
            <span className="text-slate-700 text-[10px]">·</span>
            <button onClick={() => setSelectedServerFiles(new Set())} className="text-[10px] text-slate-500 hover:text-slate-300">Ninguno</button>
            <button
              onClick={handleProcessServerFiles}
              disabled={running || selectedServerFiles.size === 0}
              className="ml-auto flex items-center gap-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white text-[11px] font-medium px-3 py-1.5 rounded-lg transition-colors"
            >
              {running && phase === 'processing' ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
              Procesar {selectedServerFiles.size > 0 ? `(${selectedServerFiles.size})` : ''}
            </button>
          </div>
        </div>
      )}

      {/* subida nueva */}
      <div>
        <p className="text-[11px] text-slate-500 mb-2">
          O sube archivos nuevos — cualquier tipo, cualquier tamaño:
        </p>
        <input ref={inputRef} type="file" multiple className="hidden" onChange={e => addFiles(e.target.files)} />
        <div
          onDragEnter={handleDrag} onDragLeave={handleDrag} onDragOver={handleDrag} onDrop={handleDrop}
          onClick={() => !running && inputRef.current?.click()}
          className={`w-full border border-dashed rounded-lg py-4 text-xs text-center transition-colors ${
            running ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'
          } ${dragActive
            ? 'border-blue-400 bg-blue-500/10 text-blue-300'
            : 'border-[var(--c-border-strong)] text-slate-500 hover:text-slate-300 hover:border-blue-500'
          }`}
        >
          <UploadCloud size={16} className="mx-auto mb-1 opacity-60" />
          Arrastra archivos o click para elegir
        </div>

        {files.length > 0 && (
          <div className="mt-2 space-y-1 max-h-32 overflow-y-auto">
            <p className="text-[10px] text-slate-500">{files.length} archivo{files.length !== 1 ? 's' : ''} · {formatBytes(totalBytes)}</p>
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

        {files.length > 0 && (
          <button
            type="button" onClick={handleStart} disabled={running}
            className="mt-2 flex items-center justify-center gap-1.5 w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-medium px-3 py-2 rounded-lg transition-colors"
          >
            {running && phase === 'uploading' ? <Loader2 size={12} className="animate-spin" /> : <UploadCloud size={12} />}
            {phase === 'uploading' ? (uploadPct < 100 ? `Subiendo… ${uploadPct}%` : 'Guardando…') : 'Subir e importar'}
          </button>
        )}
      </div>

      {/* barra subida */}
      {phase === 'uploading' && uploadTotal > 0 && (
        <div className="bg-slate-900/60 rounded-lg p-3">
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
          {uploadEta > 2 && <p className="text-[10px] text-slate-600 mt-1 text-right">{formatEta(uploadEta)} restantes</p>}
        </div>
      )}

      {/* estado procesamiento */}
      {phase === 'processing' && (
        <div className="flex items-center justify-between text-[10px] text-slate-500 bg-slate-900/40 rounded-lg px-3 py-2">
          <span className="font-mono text-slate-400 truncate max-w-[200px]">{procFile ?? 'Procesando…'}</span>
          <span className="font-mono shrink-0 ml-2">
            {procTotal > 0 && <span className="text-blue-400 mr-2">{procIdx}/{procTotal}</span>}
            ⏱ {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}
          </span>
        </div>
      )}

      {/* log */}
      {log.length > 0 && (
        <div className="bg-black/30 rounded-lg p-2 max-h-56 overflow-y-auto font-mono text-[10px] space-y-0.5">
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
          onClick={() => { setFiles([]); setLog([]); setPhase('idle'); setElapsed(0); setSelectedServerFiles(new Set()) }}
          className="text-[11px] text-slate-500 hover:text-slate-300 w-full text-center"
        >
          Limpiar y continuar
        </button>
      )}
    </div>
  )
}
