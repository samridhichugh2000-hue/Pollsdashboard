import { NextRequest, NextResponse } from 'next/server'
import { getPollById, getFaqsByPoll, createFaq, updatePoll, updateFaq, createAuditLog } from '@/lib/db/queries'
import { runMigrations } from '@/lib/db/schema'
import { forwardMessageWithHtml } from '@/lib/graph'
import { buildFaqAnnounceAllEmailHtml } from '@/lib/utils'

const userEmail = 'gunjan.setia@koenig-solutions.com'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await runMigrations()

  const poll = await getPollById(id)
  if (!poll) return NextResponse.json({ error: 'Poll not found' }, { status: 404 })

  const faqs = await getFaqsByPoll(id)
  return NextResponse.json(faqs)
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await runMigrations()

  const poll = await getPollById(id)
  if (!poll) return NextResponse.json({ error: 'Poll not found' }, { status: 404 })

  const body = await req.json() as { question?: string; answer?: string }
  const question = body.question?.trim()
  const answer = body.answer?.trim()
  if (!question || !answer) {
    return NextResponse.json({ error: 'Question and answer are required' }, { status: 400 })
  }

  const faq = await createFaq(id, question, answer, userEmail)
  if (!poll.has_faq) {
    await updatePoll(id, { has_faq: 1 })
  }

  return NextResponse.json(faq, { status: 201 })
}

// Announces every DRAFT FAQ at once, in a single email — by forwarding the
// poll's original release email (never a reminder or results-sharing email)
// with all pending FAQs appended ahead of the quoted original.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await runMigrations()

  const poll = await getPollById(id)
  if (!poll) return NextResponse.json({ error: 'Poll not found' }, { status: 404 })
  if (!poll.release_message_id) {
    return NextResponse.json({ error: 'This poll has not been released yet — FAQs can only be announced on the release email.' }, { status: 400 })
  }

  const body = await req.json() as Record<string, unknown>
  if (body.action !== 'ANNOUNCE_ALL') {
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }

  const emails = Array.isArray(body.emails)
    ? (body.emails as unknown[]).map(e => String(e).trim()).filter(Boolean)
    : []
  if (!emails.length) {
    return NextResponse.json({ error: 'Add at least one recipient' }, { status: 400 })
  }

  const allFaqs = await getFaqsByPoll(id)
  const pendingFaqs = allFaqs.filter(f => f.status === 'DRAFT')
  if (!pendingFaqs.length) {
    return NextResponse.json({ error: 'No pending FAQs to announce' }, { status: 400 })
  }

  const pollsMailbox = process.env.POLLS_MAILBOX ?? process.env.PRIYA_EMAIL!
  await forwardMessageWithHtml(process.env.PRIYA_EMAIL!, poll.release_message_id, {
    htmlBody: buildFaqAnnounceAllEmailHtml({
      pollTopic: poll.subject ?? poll.topic,
      faqs: pendingFaqs.map(f => ({ question: f.question, answer: f.answer })),
    }),
    to: [pollsMailbox],
    bcc: emails,
  })

  const announcedAt = new Date().toISOString()
  const announceEmailsJson = JSON.stringify(emails)
  for (const f of pendingFaqs) {
    await updateFaq(f.id, { status: 'ANNOUNCED', announced_at: announcedAt, announce_emails: announceEmailsJson })
  }
  await createAuditLog(id, 'FAQ_ANNOUNCED', userEmail, { faqIds: pendingFaqs.map(f => f.id), emails })

  const updated = await getFaqsByPoll(id)
  return NextResponse.json(updated)
}
