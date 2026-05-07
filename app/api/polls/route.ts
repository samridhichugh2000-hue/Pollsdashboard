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

    return NextResponse.json({ ...poll, status: 'DRAFT', draft }, { status: 201 })
  } catch (err) {
    console.error('Poll creation error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create poll' },
      { status: 500 }
    )
  }
}
