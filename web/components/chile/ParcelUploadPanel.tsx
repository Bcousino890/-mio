'use client'

import { useRef, useState } from 'react'
import { UploadCloud, Loader2, CheckCircle2, XCircle, Layers } from 'lucide-react'

interface FileResult {
  file: string
  ok: boolean
  rows: number
  error?: string
}

function formatNum(n: number) { return n.toLocaleString('es-CL') }
function formatBytes(b: number) {
  if (b >= 1024 * 1024 * 1024) return `${(b / (1024 ** 3)).toFixed(1)} GB`
  if (b >= 1024 * 1024) return `${(b / (1024 ** 2)).toFixed(0)} MB`
  return `${Math.round(b / 1024)} KB`
}

export default function ParcelUploadPanel() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [currentFile, setCurrentFile] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ index: number; total: number } | null>(null)
  const [results, setResults] = useState<FileResult[]>([])
  const [totalRows, setTotalRows] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragActive, setDragActive] = useState(false)

  function addFiles(selected: FileList | null) {
    if (!selected) return
    const valid = Array.from(selected).filter(f => /\.(parquet|gpkg|zip)$/i.test(f.name))
    setFiles(prev => [...prev, ...valid])
    setResults([])
    setError(null)
    setTotalRows(null)
  }

  function removeFile(i: number) { setFiles(prev => prev.filter((_, j) => j !== i)) }

  function handleDrag(e: React.DragEvent) {
    e.preventDefault(); e.stopPropagation()
    setDragActive(e.type === 'dragenter' || e.type === 'dragover')
  }
  function handleDrop(e: React.DragEvent) {
    e.preventDefault(); e.stopPropagation()
    setDragActive(false)
    addFiles(e.dataTransfer.files)
  }

  async function handleUpload() {
    if (files.length === 0) return
    setUploading(true); setResults([]); setError(null); setTotalRows(null)
    setCurrentFile(null); setProgress(null)

    // Subimos en lotes de 5 para no saturar la conexión
    const BATCH = 5
    const allResults: FileResult[] = []
    let grand = 0

    for (let start = 0; start < files.length; start += BATCH) {
      const batch = files.slice(start, start + BATCH)
      const formData = new FormData()
      for (const f of batch) formData.append('files', f)

      try {
        const res = await fetch('/api/admin/load-parcels', { method: 'POST', body: formData })
        if (!res.ok || !res.body) throw new Error(`Error ${res.status}`)

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const lines = buf.split('\n'); buf = lines.pop() ?? ''
          for (const line of lines) {
            if (!line.trim()) continue
            try {
              const msg = JSON.parse(line)
              if (msg.done) {
                if (!msg.success) throw new Error(msg.error ?? 'Error')
                grand += msg.data?.totalRows ?? 0
                if (msg.data?.results) allResults.push(...msg.data.results)
                setResults([...allResults])
                setTotalRows(grand)
              } else if (msg.progress) {
                if (msg.file) setCurrentFile(msg.file)
                if (msg.index != null) setProgress({ index: start + msg.index, total: files.length })
              }
            } catch { /* ignorar líneas rotas */ }
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error')
        break
      }
    }

    setUploading(false)
    setCurrentFile(null)
    setProgress(null)
    if (allResults.every(r => r.ok)) setFiles([])
  }

  const totalBytes = files.reduce((s, f) => s + f.size, 0)

  return (
    <div className="rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)] p-4">
      <div className="flex items-center gap-2 mb-1">
        <Layers size={14} className="text-violet-400" />
        <p className="text-sm font-semibold text-slate-200">Cargar polígonos prediales (Parquet / GeoPackage)</p>
      </div>
      <p className="text-[11px] text-slate-600 mb-3">
        Descarga los archivos <strong className="text-slate-500">.parquet</strong> o <strong className="text-slate-500">.gpkg</strong> por comuna desde{' '}
        <a href="https://catastral.cl" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">catastral.cl</a>{' '}
        → Descargas. Puedes subir múltiples comunas a la vez. Se cargan en{' '}
        <code className="text-slate-400">cadastre_parcels_cl</code> y quedan disponibles en el visor catastral.
      </p>

      <input ref={inputRef} type="file" multiple accept=".parquet,.gpkg,.zip" className="hidden"
        onChange={e => addFiles(e.target.files)} />

      <div
        onDragEnter={handleDrag} onDragLeave={handleDrag} onDragOver={handleDrag} onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`w-full border border-dashed rounded-lg py-4 text-xs text-center transition-colors mb-3 cursor-pointer ${
          dragActive
            ? 'border-violet-400 bg-violet-500/10 text-violet-300'
            : 'border-[var(--c-border-strong)] text-slate-500 hover:text-slate-300 hover:border-violet-500'
        }`}
      >
        Arrastra archivos .parquet, .gpkg o .zip (hasta 11 GB) aquí, o click para elegir
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
                <button onClick={() => removeFile(i)} className="text-slate-600 hover:text-red-400 text-[11px]">✕</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <button
        type="button" onClick={handleUpload}
        disabled={uploading || files.length === 0}
        className="flex items-center justify-center gap-1.5 w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-xs font-medium px-3 py-2 rounded-lg transition-colors"
      >
        {uploading ? <Loader2 size={12} className="animate-spin" /> : <UploadCloud size={12} />}
        {uploading
          ? progress
            ? `Procesando ${progress.index}/${progress.total}${currentFile ? ` · ${currentFile}` : ''}…`
            : 'Procesando…'
          : 'Cargar polígonos'}
      </button>

      {error && (
        <p className="text-xs text-red-400 mt-3 flex items-center gap-1.5">
          <XCircle size={12} /> {error}
        </p>
      )}

      {results.length > 0 && (
        <div className="mt-3 space-y-1">
          {totalRows != null && (
            <p className="text-xs text-emerald-400 font-medium mb-2">
              ✓ {formatNum(totalRows)} predios cargados en total
            </p>
          )}
          {results.map((r, i) => (
            <div key={i} className="flex items-center gap-2 text-[11px]">
              {r.ok
                ? <CheckCircle2 size={11} className="text-emerald-400 flex-shrink-0" />
                : <XCircle size={11} className="text-red-400 flex-shrink-0" />
              }
              <span className="text-slate-400 truncate">{r.file}</span>
              {r.ok
                ? <span className="text-slate-600 ml-auto shrink-0">{formatNum(r.rows)} predios</span>
                : <span className="text-red-500 ml-auto shrink-0 truncate max-w-[180px]">{r.error}</span>
              }
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
