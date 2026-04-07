import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db/client'

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await getDb().execute({ sql: 'DELETE FROM authorized_senders WHERE id = ?', args: [id] })
  return NextResponse.json({ success: true })
}
