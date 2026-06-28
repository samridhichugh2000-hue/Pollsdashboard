import { NextRequest, NextResponse } from 'next/server'
import {
  getAllPolls,
  createPoll,
  updatePoll,
  createAuditLog,
} from '@/lib/db/queries'
import { getDb } from '@/lib/db/client'
import { generatePollDraft } from '@/lib/draft-generator'
import { formatDate } from '@/lib/utils'
import { pushPollToKites } from '@/lib/kites-api'
import type { CreatePollInput } from '@/types'

const NOTIFICATION_PHRASES = ['acknowledgment of new task', 'feedback by user for rms']

export async function GET() {
  // Silently archive any RMS notification emails that slipped through as polls
  try {
    const conditions = NOTIFICATION_PHRASES.map(() => `LOWER(topic) LIKE ?`).join(' OR ')
    await getDb().execute({
      sql: `UPDATE polls SET status = 'ARCHIVED' WHERE source = 'email' AND status IN ('DRAFT', 'DETECTED') AND (${conditions})`,
      args: NOTIFICATION_PHRASES.map(p => `%${p}%`),
    })
  } catch { /* non-blocking */ }

  const polls = await getAllPolls()
  return NextResponse.json(polls)
}

export async function DELETE(req: NextRequest) {
  try {
    const { ids } = await req.json() as { ids: string[] }
    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: 'ids array required' }, { status: 400 })
    }
    const db = getDb()
    const ph = ids.map(() => '?').join(', ')
    // Delete child rows first to satisfy FK constraints
    for (const table of ['poll_attachments', 'poll_approvals', 'poll_responses', 'audit_logs', 'poll_approval_tokens']) {
      await db.execute({ sql: `DELETE FROM ${table} WHERE poll_id IN (${ph})`, args: ids }).catch(() => {})
    }
    await db.execute({ sql: `DELETE FROM polls WHERE id IN (${ph})`, args: ids })
    return NextResponse.json({ deleted: ids.length })
  } catch (err) {
    console.error('Bulk delete error:', err)
    return NextResponse.json({ error: 'Failed to delete polls' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {

  try {
    const body = await req.json() as CreatePollInput & { questions?: string[]; recipient_email?: string }

    if (!body.topic || !body.department) {
      return NextResponse.json({ error: 'Missing required fields: topic, department' }, { status: 400 })
    }

    // Create poll record
    const poll = await createPoll({
      topic: body.topic,
      department: body.department,
      recipient_email: body.recipient_email,
      requested_by: body.requested_by ?? '',
      source: body.source ?? 'dashboard',
      email_thread_id: body.email_thread_id,
      questions: body.questions,
      deadline: body.deadline,
      remarks: body.remarks,
    })

    // Generate AI draft asynchronously (update status to DRAFT)
    const deadline = poll.deadline
      ? formatDate(poll.deadline)
      : formatDate(new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString())

    const draft = generatePollDraft(
      poll.topic,
      poll.department,
      poll.requested_by,
      deadline,
      body.questions
    )

    await updatePoll(poll.id, {
      subject: draft.subject,
      draft_email_body: draft.emailBody,
      questions: JSON.stringify(draft.questions),
      status: 'DRAFT',
    })

    await createAuditLog(
      poll.id,
      'POLL_CREATED',
      'dashboard',
      { source: body.source, topic: body.topic }
    )

    // Fire-and-forget push to Kites RMS — non-blocking
    pushPollToKites({
      ...poll,
      subject: draft.subject,
      draft_email_body: draft.emailBody,
    }).then(result => {
      if (!result.success) console.error('[Kites] push failed on creation:', result.error)
      else console.log('[Kites] poll pushed on creation, newsId:', result.newsId)
    }).catch(err => console.error('[Kites] push error:', err))

    return NextResponse.json({ ...poll, status: 'DRAFT', draft }, { status: 201 })
  } catch (err) {
    console.error('Poll creation error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create poll' },
      { status: 500 }
    )
  }
}
