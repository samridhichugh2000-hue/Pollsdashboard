import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db/client'

// Public, API-key-gated feed of released polls for Trainers@koenig-solutions.com
// and Kites@koenig-solutions.com, consumed by the separate Trainer Dashboard to
// surface poll visibility only. Deliberately excludes questions, remarks, form
// links and poll_responses — this endpoint's only job is "is there a poll,
// when did it open/close, is it live".

const TARGET_AUDIENCES = ['trainers@koenig-solutions.com', 'kites@koenig-solutions.com']

// Statuses that mean "this poll has actually gone out to recipients".
const RELEASED_STATUSES = ['SENT', 'REMINDER_SENT', 'CLOSED']

// Statuses where the poll is still open and accepting responses.
const ACTIVE_STATUSES = ['SENT', 'REMINDER_SENT']

interface PollRow {
  id: string
  topic: string
  department: string
  status: string
  sent_at: string | null
  closed_at: string | null
  deadline: string | null
  recipient_email: string | null
  release_emails: string | null
  ms_form_link: string | null
}

function targetsAudience(row: PollRow): boolean {
  const haystacks = [row.recipient_email, row.release_emails, row.department]
  return haystacks.some(h => {
    const lower = h?.toLowerCase()
    return lower ? TARGET_AUDIENCES.some(a => lower.includes(a)) : false
  })
}

function csvEscape(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

const CSV_COLUMNS = ['id', 'topic', 'department', 'release_date', 'closure_date', 'is_accepting_responses', 'poll_state', 'response_link'] as const

function toCsv(polls: Record<(typeof CSV_COLUMNS)[number], string | boolean | null>[]): string {
  const header = CSV_COLUMNS.join(',')
  const lines = polls.map(p => CSV_COLUMNS.map(col => csvEscape(String(p[col] ?? ''))).join(','))
  return [header, ...lines].join('\r\n')
}

// Called cross-origin from the Trainer Dashboard's own browser-side JS, so
// responses need CORS headers or the browser blocks them before our code
// ever runs. Access is still gated by the x-api-key check below — allowing
// any origin here doesn't widen who can read the data, just who can ask.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'x-api-key, Content-Type',
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

export async function GET(req: NextRequest) {
  const apiKey = req.headers.get('x-api-key')
  const expectedKey = process.env.TRAINER_DASHBOARD_API_KEY

  if (!expectedKey) {
    return NextResponse.json({ error: 'API not configured.' }, { status: 503, headers: CORS_HEADERS })
  }
  if (apiKey !== expectedKey) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401, headers: CORS_HEADERS })
  }

  try {
    const db = getDb()
    const result = await db.execute(`
      SELECT id, topic, department, status, sent_at, closed_at, deadline, recipient_email, release_emails, ms_form_link
      FROM polls
      WHERE status IN (${RELEASED_STATUSES.map(s => `'${s}'`).join(',')})
      ORDER BY sent_at DESC
    `)

    const rows = result.rows as unknown as PollRow[]
    const now = Date.now()
    const appUrl = process.env.NEXTAUTH_URL?.replace('http://localhost:3000', 'https://pollsdashboard.vercel.app') ?? 'https://pollsdashboard.vercel.app'

    const polls = rows
      .filter(targetsAudience)
      .map(row => {
        const closureDate = row.closed_at ?? row.deadline ?? null
        const isPastClosure = closureDate ? new Date(closureDate).getTime() < now : false
        const isAcceptingResponses = ACTIVE_STATUSES.includes(row.status) && !row.closed_at && !isPastClosure

        return {
          id: row.id,
          topic: row.topic,
          department: row.department,
          release_date: row.sent_at,
          closure_date: closureDate,
          is_accepting_responses: isAcceptingResponses,
          poll_state: isAcceptingResponses ? 'active' : 'expired',
          response_link: row.ms_form_link ?? `${appUrl}/respond/${row.id}`,
        }
      })

    const format = req.nextUrl.searchParams.get('format')
    if (format === 'csv') {
      const csv = toCsv(polls)
      return new NextResponse(csv, {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="trainer-polls.csv"',
        },
      })
    }

    return NextResponse.json({ polls }, { status: 200, headers: CORS_HEADERS })
  } catch (err) {
    console.error('Trainer polls public API error:', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500, headers: CORS_HEADERS })
  }
}
