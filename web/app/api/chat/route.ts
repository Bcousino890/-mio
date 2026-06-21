import { NextRequest, NextResponse } from 'next/server'

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

const SYSTEM_PROMPT =
  'Eres el asistente del CRM Casafari Mio (captación y análisis inmobiliario en Madrid y Chile). ' +
  'Responde en español, de forma breve y directa. Si te preguntan algo fuera de inmobiliario/CRM, ' +
  'respóndelo igual pero con brevedad.'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/**
 * POST /api/chat — proxy server-side hacia OpenRouter para el widget de chat.
 * La API key nunca llega al cliente; solo vive en esta ruta vía env var.
 * Usa OPENROUTER_CHAT_MODEL (modelo gratuito ":free") — separado a propósito
 * de AI_MODEL_WORKHORSE/CHEAP, que están reservados para el futuro gateway
 * interno de parsing/desambiguación descrito en docs/PLAN-MAESTRO.md.
 */
export async function POST(request: NextRequest) {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    return NextResponse.json({ success: false, error: 'OPENROUTER_API_KEY no configurada' }, { status: 500 })
  }

  let messages: ChatMessage[]
  try {
    const body = await request.json()
    messages = Array.isArray(body?.messages) ? body.messages : []
  } catch {
    return NextResponse.json({ success: false, error: 'Body inválido' }, { status: 400 })
  }

  if (messages.length === 0) {
    return NextResponse.json({ success: false, error: 'messages requerido' }, { status: 400 })
  }

  const model = process.env.OPENROUTER_CHAT_MODEL || 'meta-llama/llama-3.3-70b-instruct:free'

  try {
    const res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages.slice(-20)],
      }),
    })

    if (!res.ok) {
      const text = await res.text()
      console.error('OpenRouter error:', res.status, text)
      return NextResponse.json(
        { success: false, error: `OpenRouter respondió ${res.status}` },
        { status: 502 }
      )
    }

    const json = await res.json()
    const reply = json?.choices?.[0]?.message?.content ?? null
    if (!reply) {
      return NextResponse.json({ success: false, error: 'Respuesta vacía del modelo' }, { status: 502 })
    }

    return NextResponse.json({ success: true, reply, model })
  } catch (error) {
    console.error('Error llamando a OpenRouter:', error)
    return NextResponse.json({ success: false, error: 'Error de red hacia OpenRouter' }, { status: 502 })
  }
}
