import { NextRequest, NextResponse } from 'next/server'
import {
  getApprovalToken,
  consumeApprovalToken,
  getPollById,
  updatePoll,
  updatePollStatus,
  createApproval,
  createAuditLog,
} from '@/lib/db/queries'

function validateToken(tokenRow: { used_at: string | null; expires_at: string } | null) {
  if (!tokenRow) return 'Invalid approval link.'
  if (tokenRow.used_at) return 'This approval link has already been used.'
  if (new Date(tokenRow.expires_at) < new Date()) return 'This approval link has expired.'
  return null
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const tokenRow = await getApprovalToken(token)
  const err = validateToken(tokenRow)
  if (err || !tokenRow) return NextResponse.json({ error: err ?? 'Invalid link.' }, { status: err?.includes('expired') || err?.includes('already') ? 410 : 404 })

  const poll = await getPollById(tokenRow.poll_id)
  if (!poll) return NextResponse.json({ error: 'Poll not found.' }, { status: 404 })

  return NextResponse.json(poll)
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const tokenRow = await getApprovalToken(token)
  const err = validateToken(tokenRow)
  if (err || !tokenRow) return NextResponse.json({ error: err ?? 'Invalid link.' }, { status: 400 })

  const poll = await getPollById(tokenRow.poll_id)
  if (!poll) return NextResponse.json({ error: 'Poll not found.' }, { status: 404 })

  const body = await req.json() as {
    action: 'approve' | 'save_and_approve'
    subject?: string
    draft_email_body?: string
    questions?: string
  }

  if (body.action === 'save_and_approve') {
    await updatePoll(poll.id, {
      subject: body.subject ?? poll.subject ?? undefined,
      draft_email_body: body.draft_email_body ?? poll.draft_email_body ?? undefined,
      questions: body.questions ?? poll.questions ?? undefined,
    })
  }

  await createApproval(poll.id, 'approved', undefined, 'email-link')
  await updatePollStatus(poll.id, 'APPROVED', { approved_at: new Date().toISOString() })
  await createAuditLog(poll.id, 'POLL_APPROVED', 'email-link', { via: 'approval-email', action: body.action })
  await consumeApprovalToken(token)

  return NextResponse.json({ success: true })
}
