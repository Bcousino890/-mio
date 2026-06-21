'use client'

import { useState, useRef, useEffect } from 'react'
import { MessageCircle, X, Send, Loader2 } from 'lucide-react'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

export default function ChatWidget() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open && messages.length === 0) {
      setMessages([{
        role: 'assistant',
        content: '¡Hola! Soy el asistente de Casafari Mio. Pregúntame sobre captación, anuncios o el catastro de Chile.',
      }])
    }
  }, [open, messages.length])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  async function send() {
    const text = input.trim()
    if (!text || loading) return
    setInput('')
    const next: Message[] = [...messages, { role: 'user', content: text }]
    setMessages(next)
    setLoading(true)
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next }),
      })
      const data = await res.json()
      setMessages(m => [...m, { role: 'assistant', content: data.content ?? 'Sin respuesta.' }])
    } catch {
      setMessages(m => [...m, { role: 'assistant', content: 'Error de conexión. Intenta de nuevo.' }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {/* Bubble button */}
      <button
        onClick={() => setOpen(o => !o)}
        className="fixed bottom-5 right-5 z-50 w-12 h-12 rounded-full flex items-center justify-center shadow-lg transition-colors"
        style={{ background: 'var(--c-accent, #7c3aed)' }}
        aria-label="Abrir asistente"
      >
        {open
          ? <X size={20} color="white" />
          : <MessageCircle size={20} color="white" />}
      </button>

      {/* Chat panel */}
      {open && (
        <div
          className="fixed bottom-20 right-5 z-50 flex flex-col rounded-xl shadow-2xl overflow-hidden"
          style={{
            width: 340,
            height: 460,
            background: 'var(--c-surface, #1e1e2e)',
            border: '1px solid var(--c-border, #333)',
          }}
        >
          {/* Header */}
          <div
            className="flex items-center gap-2 px-4 py-3 font-semibold text-sm"
            style={{ background: 'var(--c-accent, #7c3aed)', color: 'white' }}
          >
            <MessageCircle size={16} />
            Asistente Casafari
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3 text-sm">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className="max-w-[85%] rounded-lg px-3 py-2 leading-snug whitespace-pre-wrap"
                  style={m.role === 'user'
                    ? { background: 'var(--c-accent, #7c3aed)', color: 'white' }
                    : { background: 'var(--c-bg2, #2a2a3e)', color: 'var(--c-text, #e5e7eb)' }
                  }
                >
                  {m.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div
                  className="rounded-lg px-3 py-2 flex items-center gap-2"
                  style={{ background: 'var(--c-bg2, #2a2a3e)', color: 'var(--c-muted, #9ca3af)' }}
                >
                  <Loader2 size={14} className="animate-spin" />
                  <span className="text-xs">Pensando...</span>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div
            className="px-3 py-3 flex gap-2"
            style={{ borderTop: '1px solid var(--c-border, #333)' }}
          >
            <input
              className="flex-1 rounded-lg px-3 py-2 text-sm outline-none"
              style={{
                background: 'var(--c-bg, #111)',
                color: 'var(--c-text, #e5e7eb)',
                border: '1px solid var(--c-border, #333)',
              }}
              placeholder="Escribe tu pregunta..."
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
              disabled={loading}
            />
            <button
              onClick={send}
              disabled={loading || !input.trim()}
              className="rounded-lg px-3 py-2 transition-opacity disabled:opacity-40"
              style={{ background: 'var(--c-accent, #7c3aed)', color: 'white' }}
              aria-label="Enviar"
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      )}
    </>
  )
}
