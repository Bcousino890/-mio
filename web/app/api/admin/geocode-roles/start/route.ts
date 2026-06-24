import { NextRequest, NextResponse } from 'next/server'
import { startGeocodeJob } from '@/lib/geocode-job-state'

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))

  let codes: string[] = []
  if (Array.isArray(body.sii_comuna_codes)) {
    codes = body.sii_comuna_codes.filter(c => typeof c === 'string').map(c => c.trim())
  } else if (typeof body.sii_comuna_code === 'string') {
    codes = [body.sii_comuna_code.trim()]
  }

  if (codes.length === 0) {
    return NextResponse.json({ success: false, error: 'sii_comuna_code(s) required' }, { status: 400 })
  }

  const jobs = codes.map(code => startGeocodeJob(code))
  return NextResponse.json({ success: true, jobs })
}
