import { NextRequest, NextResponse } from 'next/server'

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY
const MODEL = process.env.AI_MODEL_WORKHORSE ?? 'google/gemini-2.0-flash-exp:free'

const SYSTEM_PROMPT = `Eres el asistente de Casafari Mio, una plataforma inmobiliaria para agentes en Chile y España.
Ayudas con:
- Catastro SII de Chile: roles, avalúos, destinaciones de inmuebles
- Anuncios y captación de propiedades
- Análisis de mercado inmobiliario
- Portal Inmobiliario Chile y portales españoles

Responde en español, de forma concisa y útil. Si no sabes algo, dilo claramente.`

export async function POST(req: NextRequest) {
  if (!OPENROUTER_API_KEY) {
    return NextResponse.json({ content: 'API key de OpenRouter no configurada.' }, { status: 500 })
  }

  const { messages } = await req.json()
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ content: 'Mensajes inválidos.' }, { status: 400 })
  }

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://crm.cremme.es',
      'X-Title': 'Casafari Mio',
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...messages.map((m: { role: string; content: string }) => ({
          role: m.role,
          content: m.content,
        })),
      ],
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    return NextResponse.json({ content: `Error de OpenRouter: ${err}` }, { status: 500 })
  }

  const data = await res.json()
  const content = data.choices?.[0]?.message?.content ?? 'Sin respuesta.'
  return NextResponse.json({ content })
}
