import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db/client'
import { createAuditLog } from '@/lib/db/queries'

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = getDb()

  // Find archived polls older than 7 days
  const stale = await db.execute(`
    SELECT id FROM polls
    WHERE status = 'ARCHIVED'
      AND updated_at <= datetime('now', '-7 days')
  `)

  const ids = stale.rows.map(r => r.id as string)

  if (ids.length === 0) {
    return NextResponse.json({ deleted: 0 })
  }

  // Delete related data first (FK order), then the polls themselves
  for (const id of ids) {
    await db.execute({ sql: `DELETE FROM audit_logs WHERE poll_id = ?`, args: [id] })
    await db.execute({ sql: `DELETE FROM poll_responses WHERE poll_id = ?`, args: [id] })
    await db.execute({ sql: `DELETE FROM poll_approvals WHERE poll_id = ?`, args: [id] })
    await db.execute({ sql: `DELETE FROM poll_approval_tokens WHERE poll_id = ?`, args: [id] })
    await db.execute({ sql: `DELETE FROM polls WHERE id = ?`, args: [id] })
  }

  // Audit the cleanup itself against the first deleted poll (best-effort)
  try {
    await createAuditLog(ids[0], 'ARCHIVED_POLLS_PURGED', 'cron', { count: ids.length, ids })
  } catch { /* audit table entry already deleted — ignore */ }

  return NextResponse.json({ deleted: ids.length })
}
