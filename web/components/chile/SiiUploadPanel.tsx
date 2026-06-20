'use client'

import { useRef, useState, useEffect } from 'react'
import { UploadCloud, Loader2, CheckCircle2, XCircle, FileWarning } from 'lucide-react'

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

export default function SiiUploadPanel() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [response, setResponse] = useState<UploadResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [comunas, setComunas] = useState<Comuna[]>([])
  const [selectedComunaId, setSelectedComunaId] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [dragActive, setDragActive] = useState(false)

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

  async function handleUpload() {
    if (files.length === 0) return
    setUploading(true)
    setUploadProgress(0)
    setError(null)
    setResponse(null)
    try {
      const formData = new FormData()
      for (const f of files) formData.append('files', f)
      formData.append('comunaId', selectedComunaId)

      const json: UploadResponse = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest()

        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            const percent = Math.round((e.loaded / e.total) * 100)
            setUploadProgress(percent)
          }
        })

        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const json = JSON.parse(xhr.responseText)
              resolve(json)
            } catch (err) {
              reject(new Error('Error parsing response'))
            }
          } else {
            reject(new Error('Error al subir los archivos'))
          }
        })

        xhr.addEventListener('error', () => {
          reject(new Error('Error al subir los archivos'))
        })

        xhr.open('POST', '/api/admin/sii-upload')
        xhr.send(formData)
      })

      if (!json.success && !json.error) throw new Error('Error al subir los archivos')
      setResponse(json)
      if (json.success) setFiles([])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al subir los archivos')
    } finally {
      setUploading(false)
      setUploadProgress(0)
    }
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
        Arrastra archivos aquí o click para elegir (.zip o sueltos) — hasta 300MB
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

      {uploading && uploadProgress > 0 && (
        <div className="mt-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] text-slate-400">Carga</span>
            <span className="text-[11px] text-slate-400">{uploadProgress}%</span>
          </div>
          <div className="w-full bg-[var(--c-hover)] border border-[var(--c-border)] rounded-full h-2 overflow-hidden">
            <div
              className="bg-blue-500 h-full transition-all duration-200"
              style={{ width: `${uploadProgress}%` }}
            />
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
              {r.ok ? (
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
