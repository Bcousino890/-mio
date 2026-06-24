import { NextRequest, NextResponse } from 'next/server'
import { getJobState } from '@/lib/geocode-job-state'

export async function GET(request: NextRequest) {
  const siiComunaCode = request.nextUrl.searchParams.get('sii_comuna_code')?.trim()
  if (!siiComunaCode) {
    return NextResponse.json({ success: false, error: 'sii_comuna_code required' }, { status: 400 })
  }
  return NextResponse.json({ success: true, job: getJobState(siiComunaCode) })
}
