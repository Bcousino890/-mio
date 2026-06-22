'use client'

import { useRef, useState, useEffect } from 'react'
import { UploadCloud, Loader2, CheckCircle2, XCircle, FileWarning, Link2 } from 'lucide-react'

interface Comuna {
  id: string
  name: string
  region: string
}

interface IngestResult {
  comunaCode: string
  ok: boolean
  counts: Record<string, number>
  error?: string
}

interface UploadResponse {
  success: boolean
  error?: string
  skipped?: string[]
  data?: { results: IngestResult[]; skipped: string[] }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

type UploadPhase = 'uploading' | 'downloading' | 'processing'

interface UploadStats {
  phase: UploadPhase
  percent: number
  loadedBytes: number
  totalBytes: number
  elapsedSeconds: number
  rowsProcessed: number
  currentFile?: string
  fileIndex?: number
  fileTotal?: number
}

const PHASE_LABEL: Record<UploadPhase, string> = {
  uploading: 'Subiendo',
  downloading: 'Descargando desde Google Drive',
  processing: 'Procesando en servidor',
}

export default function SiiUploadPanel() {
  const inputRef = useRef<HTMLInputElement>(null)
  const parquetInputRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<File[]>([])
  const [parquetFiles, setParquetFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadStats, setUploadStats] = useState<UploadStats | null>(null)
  const [response, setResponse] = useState<UploadResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [comunas, setComunas] = useState<Comuna[]>([])
  const [selectedComunaId, setSelectedComunaId] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [dragActive, setDragActive] = useState(false)
  const [dragParquetActive, setDragParquetActive] = useState(false)
  const [driveUrl, setDriveUrl] = useState('')

  useEffect(() => {
    fetch('/api/admin/chile-comunas')
      .then((res) => res.json())
      .then((data) => {
        if (data.success) setComunas(data.comunas)
        setLoading(false)
      })
      .catch((err) => {
        console.error('Error loading comunas:', err)
        setLoading(false)
      })
  }, [])

  function handleFilesSelected(selected: FileList | null) {
    if (!selected) return
    setFiles((prev) => [...prev, ...Array.from(selected)])
    setResponse(null)
    setError(null)
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index))
  }

  function handleDrag(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true)
    } else if (e.type === 'dragleave') {
      setDragActive(false)
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    if (e.dataTransfer.files) {
      handleFilesSelected(e.dataTransfer.files)
    }
  }

  // Lee el body NDJSON que ambos endpoints (subida manual y from-url) envían
  // en streaming, actualizando uploadStats en tiempo real a medida que
  // llegan mensajes de progreso, en vez de esperar a un único JSON final.
  async function consumeNdjsonResponse(res: Response, startTime: number): Promise<{ results: IngestResult[]; skipped: string[] }> {
    if (!res.ok || !res.body) throw new Error(`Error ${res.status}`)

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    const results: IngestResult[] = []
    let skipped: string[] = []
    let rowsProcessed = 0
    let currentFile: string | undefined
    let fileIndex: number | undefined
    let fileTotal: number | undefined

    function setProgress(phase: UploadPhase, percent: number, loadedBytes: number, totalBytes: number) {
      setUploadStats({
        phase,
        percent: Math.max(0, Math.min(99, Math.round(percent))),
        loadedBytes,
        totalBytes,
        elapsedSeconds: Math.round((Date.now() - startTime) / 1000),
        rowsProcessed,
        currentFile,
        fileIndex,
        fileTotal,
      })
    }

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.trim()) continue
        let msg: any
        try {
          msg = JSON.parse(line)
        } catch {
          continue // línea incompleta cortada entre chunks — se ignora
        }

        if (msg.done) {
          if (!msg.success) throw new Error(msg.error ?? 'Error al procesar')
          skipped = msg.data?.skipped ?? skipped
        } else if (msg.phase === 'uploading') {
          setProgress('uploading', (msg.loadedBytes / (msg.totalBytes || 1)) * 90, msg.loadedBytes, msg.totalBytes)
        } else if (msg.phase === 'downloading') {
          setProgress('downloading', 5, 0, 0)
        } else if (msg.phase === 'processing') {
          currentFile = msg.file
          fileIndex = msg.index
          fileTotal = msg.total
          rowsProcessed = 0
          setProgress('processing', fileTotal ? ((fileIndex! - 1) / fileTotal) * 100 : 10, 0, 0)
        } else if (msg.progress && typeof msg.rowsProcessed === 'number') {
          rowsProcessed = msg.rowsProcessed
          if (msg.file) {
            currentFile = msg.file
            fileIndex = msg.index
            fileTotal = msg.total
          }
          const hasBytes = typeof msg.totalBytes === 'number' && msg.totalBytes > 0
          const percent = hasBytes ? 90 + (msg.processedBytes / msg.totalBytes) * 10 : 95
          setProgress('processing', percent, msg.processedBytes ?? 0, msg.totalBytes ?? 0)
        } else if (msg.progress && msg.counts) {
          results.push({ comunaCode: msg.comunaCode, ok: msg.status === 'ok', counts: msg.counts, error: msg.error })
        } else if (msg.progress && msg.status === 'error') {
          results.push({ comunaCode: msg.comunaCode, ok: false, counts: {}, error: msg.error })
        }
      }
    }

    return { results, skipped }
  }

  async function handleUpload() {
    if (files.length === 0) return
    setUploading(true)
    setUploadStats(null)
    setError(null)
    setResponse(null)
    const startTime = Date.now()

    try {
      const formData = new FormData()
      for (const f of files) formData.append('files', f)
      formData.append('comunaId', selectedComunaId)

      const res = await fetch('/api/admin/sii-upload', { method: 'POST', body: formData })
      const { results, skipped } = await consumeNdjsonResponse(res, startTime)

      setResponse({ success: true, data: { results, skipped } })
      if (results.every((r) => r.ok)) setFiles([])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al subir los archivos')
    } finally {
      setUploading(false)
      setUploadStats(null)
    }
  }

  async function handleImportFromUrl() {
    if (!driveUrl.trim()) return
    setUploading(true)
    setUploadStats(null)
    setError(null)
    setResponse(null)
    const startTime = Date.now()

    try {
      const res = await fetch('/api/admin/sii-upload/from-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driveUrl: driveUrl.trim() }),
      })
      const { results, skipped } = await consumeNdjsonResponse(res, startTime)

      setResponse({ success: true, data: { results, skipped } })
      if (results.every((r) => r.ok)) setDriveUrl('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al importar desde Google Drive')
    } finally {
      setUploading(false)
      setUploadStats(null)
    }
  }

  async function handleImportParquetFromUrl() {
    if (!driveUrl.trim()) return
    setUploading(true)
    setUploadStats(null)
    setError(null)
    setResponse(null)
    const startTime = Date.now()

    try {
      const res = await fetch('/api/admin/catastral-cl-parquet/from-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parquetUrl: driveUrl.trim() }),
      })
      const { results, skipped } = await consumeNdjsonResponse(res, startTime)

      setResponse({ success: true, data: { results, skipped } })
      if (results.every((r) => r.ok)) setDriveUrl('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al importar Parquet de catastral.cl')
    } finally {
      setUploading(false)
      setUploadStats(null)
    }
  }

  async function handleImportParquetFromFile() {
    if (parquetFiles.length === 0) return
    setUploading(true)
    setUploadStats(null)
    setError(null)
    setResponse(null)
    const startTime = Date.now()

    try {
      const formData = new FormData()
      for (const f of parquetFiles) formData.append('file', f)

      const res = await fetch('/api/admin/catastral-cl-parquet/from-file', {
        method: 'POST',
        body: formData,
      })
      const { results, skipped } = await consumeNdjsonResponse(res, startTime)

      setResponse({ success: true, data: { results, skipped } })
      if (results.every((r) => r.ok)) setParquetFiles([])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al importar Parquet de catastral.cl')
    } finally {
      setUploading(false)
      setUploadStats(null)
    }
  }

  function formatTime(seconds: number): string {
    if (seconds < 60) return `${seconds}s`
    const minutes = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${minutes}m ${secs}s`
  }

  const totalBytes = files.reduce((sum, f) => sum + f.size, 0)

  return (
    <div className="rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)] p-4">
      <div className="flex items-center gap-2 mb-1">
        <UploadCloud size={14} className="text-emerald-400" />
        <p className="text-sm font-semibold text-slate-200">Subir archivos SII (Detalle Catastral / Rol de Cobro)</p>
      </div>
      <p className="text-[11px] text-slate-600 mb-3">
        Descarga desde sii.cl → &quot;Descarga de Información Vigente por Comuna&quot; o &quot;Información Histórica por Año&quot;.
        Acepta el .zip tal cual lo entrega el SII, o los archivos sueltos. La comuna se identifica automáticamente del nombre del archivo.
      </p>

      <div className="mb-4">
        <label className="block text-xs font-medium text-slate-400 mb-1">Comuna (opcional)</label>
        <select
          value={selectedComunaId}
          onChange={(e) => setSelectedComunaId(e.target.value)}
          disabled={loading}
          className="w-full px-3 py-2 rounded-lg bg-[var(--c-hover)] border border-[var(--c-border)] text-slate-200 text-sm focus:outline-none focus:border-blue-500"
        >
          <option value="">
            {loading ? 'Cargando comunas...' : 'Selecciona una comuna'}
          </option>
          {comunas.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.region})
            </option>
          ))}
        </select>
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => handleFilesSelected(e.target.files)}
      />

      <div
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`w-full border border-dashed rounded-lg py-4 text-xs text-center transition-colors mb-3 cursor-pointer ${
          dragActive
            ? 'border-blue-400 bg-blue-500 bg-opacity-10 text-blue-300'
            : 'border-[var(--c-border-strong)] text-slate-500 hover:text-slate-300 hover:border-blue-500'
        }`}
      >
        Arrastra archivos aquí o click para elegir (.zip o sueltos) — hasta 10GB por archivo
      </div>

      {files.length > 0 && (
        <div className="space-y-2 mb-3">
          <p className="text-xs font-medium text-slate-400">
            {files.length} archivo{files.length !== 1 ? 's' : ''} seleccionado{files.length !== 1 ? 's' : ''} • Total: {formatBytes(totalBytes)}
          </p>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {files.map((f, i) => (
              <div key={`${f.name}-${i}`} className="flex items-center justify-between bg-[var(--c-hover)] rounded-md px-2 py-1">
                <span className="text-[11px] text-slate-300 truncate">{f.name}</span>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[10px] text-slate-600">{formatBytes(f.size)}</span>
                  <button onClick={() => removeFile(i)} className="text-slate-600 hover:text-red-400 text-[11px]">
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={handleUpload}
        disabled={uploading || files.length === 0}
        className="flex items-center justify-center gap-1.5 w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-medium px-3 py-2 rounded-lg transition-colors"
      >
        {uploading ? <Loader2 size={12} className="animate-spin" /> : <UploadCloud size={12} />}
        {uploading ? 'Subiendo e ingiriendo (puede tardar varios minutos en comunas grandes)…' : 'Subir e ingerir'}
      </button>

      <div className="flex items-center gap-2 my-3">
        <div className="h-px flex-1 bg-[var(--c-border)]" />
        <span className="text-[10px] text-slate-600">o</span>
        <div className="h-px flex-1 bg-[var(--c-border)]" />
      </div>

      <div className="mb-4">
        <label className="block text-xs font-medium text-slate-400 mb-1 flex items-center gap-1.5">
          <Link2 size={12} className="text-slate-500" />
          Importar CSV de catastral.cl desde un link de Google Drive
        </label>
        <p className="text-[11px] text-slate-600 mb-2">
          Pega el enlace para compartir de Google Drive — el archivo se descarga directo en el servidor, sin pasar por tu navegador.
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            value={driveUrl}
            onChange={(e) => setDriveUrl(e.target.value)}
            disabled={uploading}
            placeholder="https://drive.google.com/file/d/.../view"
            className="flex-1 px-3 py-2 rounded-lg bg-[var(--c-hover)] border border-[var(--c-border)] text-slate-200 text-sm focus:outline-none focus:border-blue-500 disabled:opacity-50"
          />
          <button
            type="button"
            onClick={handleImportFromUrl}
            disabled={uploading || !driveUrl.trim()}
            className="flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-medium px-3 py-2 rounded-lg transition-colors shrink-0"
          >
            {uploading ? <Loader2 size={12} className="animate-spin" /> : <Link2 size={12} />}
            Importar
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 my-3">
        <div className="h-px flex-1 bg-[var(--c-border)]" />
        <span className="text-[10px] text-slate-600">o</span>
        <div className="h-px flex-1 bg-[var(--c-border)]" />
      </div>

      <div className="mb-4">
        <label className="block text-xs font-medium text-slate-400 mb-1 flex items-center gap-1.5">
          <UploadCloud size={12} className="text-slate-500" />
          Importar Parquet enriquecido de catastral.cl (geometría + valuación)
        </label>
        <p className="text-[11px] text-slate-600 mb-2">
          Descarga desde catastral.cl → Tienda → &quot;Datos Catastrales por Comuna&quot; y súbelo directamente. Para varias comunas: descárgalas y comprime en un .zip.
        </p>

        <input
          ref={parquetInputRef}
          type="file"
          multiple
          accept=".parquet,.zip"
          className="hidden"
          onChange={(e) => {
            if (e.target.files) {
              setParquetFiles((prev) => [...prev, ...Array.from(e.target.files!)])
              setResponse(null)
              setError(null)
            }
          }}
        />

        <div
          onDragEnter={(e) => {
            e.preventDefault()
            setDragParquetActive(true)
          }}
          onDragLeave={() => setDragParquetActive(false)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            setDragParquetActive(false)
            if (e.dataTransfer.files) {
              setParquetFiles((prev) => [...prev, ...Array.from(e.dataTransfer.files)])
              setResponse(null)
              setError(null)
            }
          }}
          onClick={() => parquetInputRef.current?.click()}
          className={`w-full border border-dashed rounded-lg py-4 text-xs text-center transition-colors mb-3 cursor-pointer ${
            dragParquetActive
              ? 'border-blue-400 bg-blue-500 bg-opacity-10 text-blue-300'
              : 'border-[var(--c-border-strong)] text-slate-500 hover:text-slate-300 hover:border-blue-500'
          }`}
        >
          Arrastra Parquets aquí o click para elegir (.parquet o .zip)
        </div>

        {parquetFiles.length > 0 && (
          <div className="space-y-2 mb-3">
            <p className="text-xs font-medium text-slate-400">
              {parquetFiles.length} archivo{parquetFiles.length !== 1 ? 's' : ''} seleccionado{parquetFiles.length !== 1 ? 's' : ''}
            </p>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {parquetFiles.map((f, i) => (
                <div key={`${f.name}-${i}`} className="flex items-center justify-between bg-[var(--c-hover)] rounded-md px-2 py-1">
                  <span className="text-[11px] text-slate-300 truncate">{f.name}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] text-slate-600">{formatBytes(f.size)}</span>
                    <button
                      onClick={() => setParquetFiles((prev) => prev.filter((_, idx) => idx !== i))}
                      className="text-slate-600 hover:text-red-400 text-[11px]"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={handleImportParquetFromFile}
          disabled={uploading || parquetFiles.length === 0}
          className="flex items-center justify-center gap-1.5 w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-medium px-3 py-2 rounded-lg transition-colors"
        >
          {uploading ? <Loader2 size={12} className="animate-spin" /> : <UploadCloud size={12} />}
          {uploading ? 'Subiendo e ingiriendo...' : 'Subir e ingerir'}
        </button>
      </div>

      <div className="flex items-center gap-2 my-3">
        <div className="h-px flex-1 bg-[var(--c-border)]" />
        <span className="text-[10px] text-slate-600">o</span>
        <div className="h-px flex-1 bg-[var(--c-border)]" />
      </div>

      <div className="mb-1">
        <label className="block text-xs font-medium text-slate-400 mb-1 flex items-center gap-1.5">
          <Link2 size={12} className="text-slate-500" />
          Importar desde Google Drive (link compartido)
        </label>
        <p className="text-[11px] text-slate-600 mb-2">
          Si prefieres, pega el link de Google Drive y se descarga directo en el servidor sin pasar por tu navegador.
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            value={driveUrl}
            onChange={(e) => setDriveUrl(e.target.value)}
            disabled={uploading}
            placeholder="https://drive.google.com/file/d/.../view (Parquet o .zip de varios)"
            className="flex-1 px-3 py-2 rounded-lg bg-[var(--c-hover)] border border-[var(--c-border)] text-slate-200 text-sm focus:outline-none focus:border-blue-500 disabled:opacity-50"
          />
          <button
            type="button"
            onClick={handleImportParquetFromUrl}
            disabled={uploading || !driveUrl.trim()}
            className="flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-medium px-3 py-2 rounded-lg transition-colors shrink-0"
          >
            {uploading ? <Loader2 size={12} className="animate-spin" /> : <Link2 size={12} />}
            Importar
          </button>
        </div>
      </div>

      {uploading && uploadStats && (
        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] text-slate-400">
              {PHASE_LABEL[uploadStats.phase]}
              {uploadStats.totalBytes > 0 && ` • ${formatBytes(uploadStats.loadedBytes)} / ${formatBytes(uploadStats.totalBytes)}`}
              {uploadStats.fileTotal && uploadStats.fileTotal > 1 && (
                <span className="text-slate-500">
                  {' '}
                  • archivo {uploadStats.fileIndex}/{uploadStats.fileTotal}
                  {uploadStats.currentFile && ` (${uploadStats.currentFile})`}
                </span>
              )}
              {uploadStats.phase === 'processing' && uploadStats.rowsProcessed > 0 && (
                <span className="text-slate-500"> • {uploadStats.rowsProcessed.toLocaleString('es-CL')} filas procesadas</span>
              )}
            </span>
            <span className="text-[11px] text-slate-400 font-medium">{uploadStats.percent}%</span>
          </div>
          <div className="w-full bg-[var(--c-hover)] border border-[var(--c-border)] rounded-full h-2 overflow-hidden">
            <div
              className={`h-full transition-all duration-200 ${uploadStats.phase === 'processing' ? 'bg-amber-500' : 'bg-blue-500'}`}
              style={{ width: `${uploadStats.percent}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[10px] text-slate-500">
            <span>Transcurrido: {formatTime(uploadStats.elapsedSeconds)}</span>
          </div>
        </div>
      )}

      {error && (
        <p className="text-xs text-red-400 mt-3 flex items-center gap-1.5">
          <XCircle size={12} /> {error}
        </p>
      )}

      {response?.data && (
        <div className="mt-3 space-y-2">
          {response.data.results.map((r) => (
            <div key={r.comunaCode} className="bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg px-3 py-2">
              <div className="flex items-center gap-1.5">
                {r.ok ? <CheckCircle2 size={12} className="text-emerald-400" /> : <XCircle size={12} className="text-red-400" />}
                <span className="text-xs font-medium text-slate-200">Comuna {r.comunaCode}</span>
              </div>
              {r.ok && r.comunaCode === 'catastral_cl' ? (
                <p className="text-[11px] text-slate-500 mt-1">
                  Filas ingresadas: {(r.counts.catastral_cl ?? 0).toLocaleString('es-CL')}
                </p>
              ) : r.ok && typeof r.counts.catastral_parquet === 'number' ? (
                <p className="text-[11px] text-slate-500 mt-1">
                  Predios ingresados: {r.counts.catastral_parquet.toLocaleString('es-CL')}
                </p>
              ) : r.ok ? (
                <p className="text-[11px] text-slate-500 mt-1">
                  Roles: {r.counts.roles_no_agricolas + r.counts.roles_agricolas} · Construcciones:{' '}
                  {r.counts.construcciones_no_agricolas + r.counts.suelos_construcciones_agricolas} · Rol de cobro: {r.counts.rol_de_cobro}
                </p>
              ) : (
                <p className="text-[11px] text-red-400 mt-1">{r.error}</p>
              )}
            </div>
          ))}
          {response.data.skipped.length > 0 && (
            <p className="text-[11px] text-amber-400 flex items-start gap-1.5">
              <FileWarning size={12} className="mt-0.5 shrink-0" />
              No reconocidos (se ignoraron): {response.data.skipped.join(', ')}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
