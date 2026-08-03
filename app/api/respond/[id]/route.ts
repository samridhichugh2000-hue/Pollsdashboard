import { NextRequest, NextResponse } from 'next/server'
import { getPollById } from '@/lib/db/queries'
import { getDb } from '@/lib/db/client'
import { sendEmail } from '@/lib/graph'
import { buildAutoResponseHtml } from '@/lib/utils'
import { v4 as uuidv4 } from 'uuid'

const CLOSED_STATUSES = ['CLOSED', 'ARCHIVED', 'RESULTS_UPLOADED', 'RESULTS_SHARED']
const ALLOWED_DOMAIN = 'koenig-solutions.com'
const BASIC_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// A poll released to at least one non-koenig-solutions.com recipient is treated
// as external-facing: the respondent's real email (whatever domain) is required
// and stored as-is — it must never be forced/rewritten to @koenig-solutions.com.
function isExternalPoll(releaseEmailsJson: string | null | undefined): boolean {
  if (!releaseEmailsJson) return false
  try {
    const emails = JSON.parse(releaseEmailsJson) as string[]
    return emails.some(e => !e.toLowerCase().endsWith(`@${ALLOWED_DOMAIN}`))
  } catch {
    return false
  }
}

// GET — fetch poll questions (public, no auth)
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const poll = await getPollById(id)
  if (!poll) return NextResponse.json({ error: 'Poll not found' }, { status: 404 })

  if (CLOSED_STATUSES.includes(poll.status)) {
    return NextResponse.json({ error: 'This poll is no longer accepting responses.' }, { status: 410 })
  }

  const rawQuestions = poll.questions ? JSON.parse(poll.questions) as Array<string | { text: string; type: string }> : []
  const questions = rawQuestions.map((q) =>
    typeof q === 'string'
      ? { text: q, type: /rate|rating|scale|satisfied|satisfaction|recommend|\(1\s*[=-]/i.test(q) ? 'rating' : 'open_ended' }
      : q
  )
  return NextResponse.json({
    id: poll.id,
    topic: poll.topic,
    subject: poll.subject,
    deadline: poll.deadline,
    questions,
    isExternal: isExternalPoll(poll.release_emails),
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

  const email = body.email?.trim().toLowerCase()
  if (!email) {
    return NextResponse.json({ error: 'Your email is required.' }, { status: 400 })
  }

  // External-facing polls accept the respondent's real email, whatever the
  // domain — it is stored exactly as submitted, never rewritten or replaced.
  // Internal polls keep the existing @koenig-solutions.com requirement.
  if (isExternalPoll(poll.release_emails)) {
    if (!BASIC_EMAIL_RE.test(email)) {
      return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 })
    }
  } else if (!email.endsWith(`@${ALLOWED_DOMAIN}`)) {
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
    const currentArray: Array<{ email?: string }> = currentData ? JSON.parse(currentData) : []

    // Server-side dedup — the only source of truth for "already responded".
    // single_response defaults to on (matches createPoll()'s default).
    if (poll.single_response !== 0 && currentArray.some(e => e.email?.toLowerCase() === email)) {
      return NextResponse.json({ error: 'You have already submitted a response to this poll.' }, { status: 409 })
    }

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

  // Auto-response confirmation email — non-fatal if it fails
  try {
    if (process.env.PRIYA_EMAIL) {
      await sendEmail({
        from: process.env.PRIYA_EMAIL,
        to: email,
        subject: `Your response has been recorded – ${poll.topic}`,
        htmlBody: buildAutoResponseHtml({ topic: poll.topic, answers: body.answers, isKGT: poll.request_type === 'KGT' }),
      })
    }
  } catch (emailErr) {
    console.error('Auto-response email failed (non-fatal):', emailErr)
  }

  return NextResponse.json({ success: true })
}
