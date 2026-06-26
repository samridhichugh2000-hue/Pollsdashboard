import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db/client'
import { v4 as uuidv4 } from 'uuid'

export async function GET() {
  const db = getDb()
  const result = await db.execute(
    'SELECT * FROM feedback_items ORDER BY created_at DESC'
  )
  return NextResponse.json(result.rows)
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    poll_id?: string
    poll_title?: string
    type?: string
    summary?: string
    detail?: string
    submitted_by?: string
    department?: string
    owner?: string
    status?: string
    due_date?: string
    rms_task_id?: string
    task_pending?: number
    followup_done?: number
    category?: string
  }

  const db = getDb()
  const id = uuidv4()
  const now = new Date().toISOString()

  await db.execute({
    sql: `INSERT INTO feedback_items
      (id, poll_id, poll_title, type, summary, detail, submitted_by, department, owner, status, due_date, submitted_date, rms_task_id, task_pending, followup_done, category, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      body.poll_id ?? null,
      body.poll_title ?? null,
      body.type ?? null,
      body.summary ?? null,
      body.detail ?? null,
      body.submitted_by ?? null,
      body.department ?? null,
      body.owner ?? null,
      body.status ?? 'Open',
      body.due_date ?? null,
      now,
      body.rms_task_id ?? null,
      body.task_pending ?? 0,
      body.followup_done ?? 0,
      body.category ?? null,
      now,
    ],
  })

  const row = await db.execute({ sql: 'SELECT * FROM feedback_items WHERE id = ?', args: [id] })
  return NextResponse.json(row.rows[0], { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const { id, ...updates } = await req.json() as { id: string; status?: string; rms_task_id?: string; task_pending?: number; followup_done?: number; owner?: string }
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const db = getDb()
  const fields = Object.keys(updates).map(k => `${k} = ?`).join(', ')
  const values = Object.values(updates)

  if (!fields) return NextResponse.json({ error: 'no fields to update' }, { status: 400 })

  await db.execute({ sql: `UPDATE feedback_items SET ${fields} WHERE id = ?`, args: [...values, id] })
  const row = await db.execute({ sql: 'SELECT * FROM feedback_items WHERE id = ?', args: [id] })
  return NextResponse.json(row.rows[0])
}
