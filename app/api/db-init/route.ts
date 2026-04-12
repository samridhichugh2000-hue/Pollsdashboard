import { NextRequest, NextResponse } from 'next/server'
import { initializeDatabase, runMigrations } from '@/lib/db/schema'

async function runInit() {
  await initializeDatabase()
  await runMigrations()
}

// Browser-friendly: GET /api/db-init?secret=YOUR_DB_INIT_SECRET
export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret')
  if (secret !== process.env.DB_INIT_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    await runInit()
    return NextResponse.json({ message: 'Database initialized successfully' })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Init failed' }, { status: 500 })
  }
}

// Programmatic: POST /api/db-init with Authorization: Bearer YOUR_DB_INIT_SECRET
export async function POST(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.DB_INIT_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    await runInit()
    return NextResponse.json({ message: 'Database initialized successfully' })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Init failed' }, { status: 500 })
  }
}
