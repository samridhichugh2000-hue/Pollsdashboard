import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db/client'

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await getDb().execute({ sql: 'DELETE FROM hunt_groups WHERE id = ?', args: [id] })
  return NextResponse.json({ success: true })
}
