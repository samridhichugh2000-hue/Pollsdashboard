import { NextRequest, NextResponse } from 'next/server'
import {
  getAllKGTRequests,
  createPoll,
  updatePoll,
  createAuditLog,
} from '@/lib/db/queries'
import { getDb } from '@/lib/db/client'
import { runMigrations } from '@/lib/db/schema'
import { generateDefaultKGTDraft } from '@/lib/kgt-draft-generator'
import type { CreatePollInput } from '@/types'

export async function GET() {
  await runMigrations()
  const requests = await getAllKGTRequests()
  return NextResponse.json(requests)
}

export async function POST(req: NextRequest) {
  try {
    await runMigrations()
    const body = await req.json() as CreatePollInput & { issue_details?: string }

    if (!body.topic) {
      return NextResponse.json({ error: 'Missing required field: topic' }, { status: 400 })
    }

    const poll = await createPoll({
      topic: body.topic,
      department: body.department || 'All Departments',
      requested_by: body.requested_by ?? '',
      source: body.source ?? 'dashboard',
      deadline: body.deadline,
      remarks: body.remarks,
      request_type: 'KGT',
    })

    const draft = generateDefaultKGTDraft(poll.topic, body.issue_details)

    await updatePoll(poll.id, {
      subject: draft.subject,
      draft_email_body: draft.emailBody,
      questions: JSON.stringify(draft.questions),
      status: 'DRAFT',
    })

    await createAuditLog(poll.id, 'KGT_CREATED', 'dashboard', { source: body.source, topic: body.topic })

    return NextResponse.json({ ...poll, status: 'DRAFT', draft }, { status: 201 })
  } catch (err) {
    console.error('KGT creation error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create KGT request' },
      { status: 500 }
    )
  }
}
