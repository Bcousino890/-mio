import { NextResponse } from 'next/server'
import { startGeocodeJob } from '@/lib/geocode-job-state'

const ALL_COMMUNES = ['15160', '15108', '15161', '14201']

export async function POST() {
  const jobs = ALL_COMMUNES.map((code) => startGeocodeJob(code))
  return NextResponse.json({ success: true, jobs })
}
