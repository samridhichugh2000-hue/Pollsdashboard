import { NextRequest, NextResponse } from 'next/server'
import { getPollById } from '@/lib/db/queries'
import { getDb } from '@/lib/db/client'
import { v4 as uuidv4 } from 'uuid'

const CLOSED_STATUSES = ['CLOSED', 'ARCHIVED', 'RESULTS_UPLOADED']
const ALLOWED_DOMAIN = 'koenig-solutions.com'

// GET — fetch poll questions (public, no auth)
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const poll = await getPollById(id)
  if (!poll) return NextResponse.json({ error: 'Poll not found' }, { status: 404 })

  if (CLOSED_STATUSES.includes(poll.status)) {
    return NextResponse.json({ error: 'This poll is no longer accepting responses.' }, { status: 410 })
  }

  const questions: string[] = poll.questions ? JSON.parse(poll.questions) : []
  return NextResponse.json({
    id: poll.id,
    topic: poll.topic,
    department: poll.department,
    deadline: poll.deadline,
    questions,
  })
}

// POST — submit a response
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const poll = await getPollById(id)
  if (!poll) return NextResponse.json({ error: 'Poll not found' }, { status: 404 })

  if (CLOSED_STATUSES.includes(poll.status)) {
    return NextResponse.json({ error: 'This poll is no longer accepting responses.' }, { status: 410 })
  }

  const body = await req.json() as {
    answers: { question: string; answer: string }[]
    email?: string
  }

  // Validate email domain
  const email = body.email?.trim().toLowerCase()
  if (!email) {
    return NextResponse.json({ error: 'Your Koenig Solutions email is required.' }, { status: 400 })
  }
  if (!email.endsWith(`@${ALLOWED_DOMAIN}`)) {
    return NextResponse.json({ error: `Only @${ALLOWED_DOMAIN} email addresses are allowed.` }, { status: 403 })
  }

  if (!body.answers || body.answers.length === 0) {
    return NextResponse.json({ error: 'No answers provided.' }, { status: 400 })
  }

  const db = getDb()

  const nameFromEmail = email
    .split('@')[0]
    .split('.')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')

  const newEntry = {
    email,
    respondent: nameFromEmail,
    submitted_at: new Date().toISOString(),
    answers: body.answers,
  }

  const existing = await db.execute({ sql: 'SELECT id, response_data FROM poll_responses WHERE poll_id = ?', args: [id] })

  if (existing.rows.length > 0) {
    const currentData = existing.rows[0].response_data as string | null
    const currentArray: unknown[] = currentData ? JSON.parse(currentData) : []
    currentArray.push(newEntry)
    await db.execute({
      sql: 'UPDATE poll_responses SET response_data = ?, fetched_at = CURRENT_TIMESTAMP WHERE poll_id = ?',
      args: [JSON.stringify(currentArray), id],
    })
  } else {
    await db.execute({
      sql: 'INSERT INTO poll_responses (id, poll_id, response_data) VALUES (?, ?, ?)',
      args: [uuidv4(), id, JSON.stringify([newEntry])],
    })
  }

  return NextResponse.json({ success: true })
}
