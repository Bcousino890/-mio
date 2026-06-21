'use client'

import { useEffect, useRef, useState } from 'react'
import { MessageCircle, X, Send, Loader2, Bot } from 'lucide-react'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

const WELCOME: ChatMessage = {
  role: 'assistant',
  content: '¡Hola! Soy el asistente de Casafari Mio. Pregúntame sobre captación, anuncios o el catastro de Chile.',
}

export default function ChatWidget() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, open])

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    const text = input.trim()
    if (!text || loading) return

    const next = [...messages, { role: 'user', content: text } as ChatMessage]
    setMessages(next)
    setInput('')
    setError(null)
    setLoading(true)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? 'Error desconocido')
      setMessages([...next, { role: 'assistant', content: json.reply }])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al contactar al asistente')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed bottom-5 right-5 z-[3000] flex flex-col items-end gap-3">
      {open && (
        <div className="w-80 h-[480px] rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)] shadow-2xl flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--c-border-card)]">
            <div className="flex items-center gap-2">
              <Bot size={16} className="text-blue-400" />
              <p className="text-sm font-semibold text-slate-200">Asistente Casafari</p>
            </div>
            <button onClick={() => setOpen(false)} className="text-slate-500 hover:text-slate-300">
              <X size={16} />
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap ${
                    m.role === 'user'
                      ? 'bg-blue-600 text-white'
                      : 'bg-[var(--c-hover)] text-slate-200 border border-[var(--c-border)]'
                  }`}
                >
                  {m.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg px-3 py-2">
                  <Loader2 size={14} className="animate-spin text-slate-500" />
                </div>
              </div>
            )}
            {error && <p className="text-[11px] text-red-400 px-1">{error}</p>}
          </div>

          <form onSubmit={handleSend} className="flex items-center gap-2 p-2.5 border-t border-[var(--c-border-card)]">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Escribe tu pregunta..."
              className="flex-1 bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg px-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-blue-500"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="flex items-center justify-center w-8 h-8 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg transition-colors flex-shrink-0"
            >
              <Send size={14} />
            </button>
          </form>
        </div>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        className="w-12 h-12 rounded-full bg-blue-600 hover:bg-blue-500 text-white shadow-lg flex items-center justify-center transition-colors"
      >
        {open ? <X size={20} /> : <MessageCircle size={20} />}
      </button>
    </div>
  )
}
