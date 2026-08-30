import { NextRequest, NextResponse } from 'next/server'
import { getPollById, getFaqsByPoll, createFaq, updatePoll } from '@/lib/db/queries'
import { runMigrations } from '@/lib/db/schema'

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
