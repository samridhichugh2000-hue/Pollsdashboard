import { NextResponse } from 'next/server'
import { getKPIData } from '@/lib/db/queries'

export async function GET() {
  const data = await getKPIData()
  return NextResponse.json(data)
}
