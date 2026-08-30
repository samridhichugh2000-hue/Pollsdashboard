import { NextRequest, NextResponse } from 'next/server'
import { getPollById, getFaqById, updateFaq, deleteFaq, createAuditLog } from '@/lib/db/queries'
import { sendEmail } from '@/lib/graph'
import { buildFaqAnnounceEmailHtml } from '@/lib/utils'

const userEmail = 'gunjan.setia@koenig-solutions.com'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; faqId: string }> }) {
  const { id, faqId } = await params
  const faq = await getFaqById(faqId)
  if (!faq || faq.poll_id !== id) return NextResponse.json({ error: 'FAQ not found' }, { status: 404 })

  const body = await req.json() as Record<string, unknown>
  const { action } = body

  if (action === 'EDIT') {
    const question = (body.question as string | undefined)?.trim()
    const answer = (body.answer as string | undefined)?.trim()
    if (!question || !answer) {
      return NextResponse.json({ error: 'Question and answer are required' }, { status: 400 })
    }
    await updateFaq(faqId, { question, answer })
    await createAuditLog(id, 'FAQ_UPDATED', userEmail, { faqId })
  } else if (action === 'ANNOUNCE') {
    const emails = Array.isArray(body.emails)
      ? (body.emails as unknown[]).map(e => String(e).trim()).filter(Boolean)
      : []
    if (!emails.length) {
      return NextResponse.json({ error: 'Add at least one recipient' }, { status: 400 })
    }

    const poll = await getPollById(id)
    if (!poll) return NextResponse.json({ error: 'Poll not found' }, { status: 404 })

    const pollsMailbox = process.env.POLLS_MAILBOX ?? process.env.PRIYA_EMAIL!
    await sendEmail({
      from: process.env.PRIYA_EMAIL!,
      to: pollsMailbox,
      bcc: emails,
      subject: `FAQ – ${poll.subject ?? poll.topic}`,
      htmlBody: buildFaqAnnounceEmailHtml({ pollTopic: poll.topic, question: faq.question, answer: faq.answer }),
    })

    await updateFaq(faqId, {
      status: 'ANNOUNCED',
      announced_at: new Date().toISOString(),
      announce_emails: JSON.stringify(emails),
    })
    await createAuditLog(id, 'FAQ_ANNOUNCED', userEmail, { faqId, emails })
  } else {
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }

  const updated = await getFaqById(faqId)
  return NextResponse.json(updated)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string; faqId: string }> }) {
  const { id, faqId } = await params
  const faq = await getFaqById(faqId)
  if (!faq || faq.poll_id !== id) return NextResponse.json({ error: 'FAQ not found' }, { status: 404 })

  await deleteFaq(faqId)
  await createAuditLog(id, 'FAQ_DELETED', userEmail, { faqId })
  return NextResponse.json({ success: true })
}
