import { NextRequest, NextResponse } from 'next/server'
import { startGeocodeJob } from '@/lib/geocode-job-state'

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const siiComunaCode = typeof body.sii_comuna_code === 'string' ? body.sii_comuna_code.trim() : ''
  if (!siiComunaCode) {
    return NextResponse.json({ success: false, error: 'sii_comuna_code required' }, { status: 400 })
  }

  const state = startGeocodeJob(siiComunaCode)
  return NextResponse.json({ success: true, job: state })
}
