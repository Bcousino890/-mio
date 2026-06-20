'use client'

import { useRef, useState } from 'react'
import { UploadCloud, Loader2, CheckCircle2, XCircle, FileWarning } from 'lucide-react'

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
  const [response, setResponse] = useState<UploadResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  function handleFilesSelected(selected: FileList | null) {
    if (!selected) return
    setFiles((prev) => [...prev, ...Array.from(selected)])
    setResponse(null)
    setError(null)
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index))
  }

  async function handleUpload() {
    if (files.length === 0) return
    setUploading(true)
    setError(null)
    setResponse(null)
    try {
      const formData = new FormData()
      for (const f of files) formData.append('files', f)
      const res = await fetch('/api/admin/sii-upload', { method: 'POST', body: formData })
      const json: UploadResponse = await res.json()
      if (!res.ok && !json.error) throw new Error('Error al subir los archivos')
      setResponse(json)
      if (json.success) setFiles([])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al subir los archivos')
    } finally {
      setUploading(false)
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
        Descarga manual desde sii.cl → &quot;Descarga de Información Vigente por Comuna&quot;. Acepta el .zip tal cual lo
        entrega el SII, o los archivos sueltos (BRTMPCATASN*, BRTMPCATASNL*, BRTMPCATASA*, BRTMPCATASAL*, BRTMPROLSEM*).
        La comuna se detecta automáticamente del nombre de archivo — se pueden subir varias comunas a la vez.
      </p>

      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => handleFilesSelected(e.target.files)}
      />

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="w-full border border-dashed border-[var(--c-border-strong)] rounded-lg py-4 text-xs text-slate-500 hover:text-slate-300 hover:border-blue-500 transition-colors mb-3"
      >
        Click para elegir archivos (.zip o sueltos) — sin límite de tamaño relevante (hasta 300MB por subida)
      </button>

      {files.length > 0 && (
        <div className="space-y-1 mb-3 max-h-40 overflow-y-auto">
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
          <p className="text-[10px] text-slate-600 pt-1">Total: {formatBytes(totalBytes)}</p>
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
