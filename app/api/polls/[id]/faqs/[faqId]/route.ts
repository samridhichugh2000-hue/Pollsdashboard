import { NextRequest, NextResponse } from 'next/server'
import { getFaqById, updateFaq, deleteFaq, createAuditLog } from '@/lib/db/queries'

const userEmail = 'gunjan.setia@koenig-solutions.com'

// Per-FAQ announcing was removed in favor of a single batch announce for all
// pending FAQs at once — see the PATCH handler on the parent /faqs route.
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
