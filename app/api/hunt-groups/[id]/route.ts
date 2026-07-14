import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { getDb } from '@/lib/db/client'
import { runMigrations } from '@/lib/db/schema'

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await runMigrations()
  const { id } = await params
  await getDb().execute({ sql: 'DELETE FROM hunt_groups WHERE id = ?', args: [id] })
  return NextResponse.json({ success: true })
}
