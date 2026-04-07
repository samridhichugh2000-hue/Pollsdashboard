import { NextResponse } from 'next/server'
import { initializeDatabase, runMigrations } from '@/lib/db/schema'

// One-time setup endpoint — call this after deployment to initialize tables
export async function POST(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.DB_INIT_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    await initializeDatabase()
    await runMigrations()
    return NextResponse.json({ message: 'Database initialized successfully' })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Init failed' },
      { status: 500 }
    )
  }
}
