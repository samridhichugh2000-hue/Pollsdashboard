import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db/client'

// Public, API-key-gated feed of every response ever submitted to the "Poll of
// Sales & DMs - Skills / OEM Shortage Areas." cadence poll — past and future.
//
// This poll is a monthly regular-poll template (see regular_polls); the cron
// scheduler (app/api/cron/regular-poll-scheduler) creates a fresh row in
// `polls` for it every month with topic = template.name verbatim, so matching
// on POLL_NAME below picks up every past release and, automatically, every
// future monthly release too — no code change needed when next month's poll
// fires. If this cadence poll is ever renamed in Regular Polls, POLL_NAME
// must be updated to match, or new releases will stop showing up here.
//
// There is no push/webhook out of this app — the consumer is expected to call
// this endpoint (optionally with `since`) to pick up newly submitted
// responses shortly after they land, which is as close to "real time" as a
// pull-based integration gets. Every call queries the live database directly,
// so a response submitted moments ago is already included.
const POLL_NAME = 'Poll of Sales & DMs - Skills / OEM Shortage Areas.'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'x-api-key, Content-Type',
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

interface AnswerEntry {
  question: string
  answer: string
}

interface ResponseEntry {
  email?: string
  respondent?: string
  submitted_at?: string
  answers?: AnswerEntry[]
}

interface PollRow {
  id: string
  topic: string
  status: string
  sent_at: string | null
  response_data: string | null
}

interface FlatResponse {
  name: string | null
  email: string
  poll_name: string
  poll_id: string
  poll_date: string | null
  submitted_at: string | null
  answers: AnswerEntry[]
}

function csvEscape(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

const CSV_COLUMNS = ['name', 'email', 'poll_name', 'poll_date', 'submitted_at', 'question', 'answer'] as const

function toCsv(rows: FlatResponse[]): string {
  const header = CSV_COLUMNS.join(',')
  const lines: string[] = []
  for (const r of rows) {
    const answers = r.answers.length > 0 ? r.answers : [{ question: '', answer: '' }]
    for (const a of answers) {
      lines.push(
        [r.name ?? '', r.email, r.poll_name, r.poll_date ?? '', r.submitted_at ?? '', a.question, a.answer]
          .map(v => csvEscape(String(v)))
          .join(',')
      )
    }
  }
  return [header, ...lines].join('\r\n')
}

export async function GET(req: NextRequest) {
  const apiKey = req.headers.get('x-api-key')
  const expectedKey = process.env.SALES_OEM_SHORTAGE_API_KEY

  if (!expectedKey) {
    return NextResponse.json({ error: 'API not configured.' }, { status: 503, headers: CORS_HEADERS })
  }
  if (apiKey !== expectedKey) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401, headers: CORS_HEADERS })
  }

  // Optional cursor for incremental/near-real-time polling: only responses
  // submitted strictly after this ISO timestamp are returned.
  const since = req.nextUrl.searchParams.get('since')?.trim()

  try {
    const db = getDb()

    const result = await db.execute({
      sql: `
        SELECT p.id, p.topic, p.status, p.sent_at, pr.response_data
        FROM polls p
        LEFT JOIN poll_responses pr ON pr.poll_id = p.id
        WHERE p.topic = ?
        ORDER BY p.sent_at ASC
      `,
      args: [POLL_NAME],
    })

    const employeesResult = await db.execute('SELECT email_address, first_name, last_name FROM employees')
    const namesByEmail = new Map<string, string>()
    for (const row of employeesResult.rows as unknown as { email_address: string; first_name: string | null; last_name: string | null }[]) {
      if (!row.email_address) continue
      const name = [row.first_name, row.last_name].filter(Boolean).join(' ')
      if (name) namesByEmail.set(row.email_address.toLowerCase(), name)
    }

    const responses: FlatResponse[] = []

    for (const row of result.rows as unknown as PollRow[]) {
      if (!row.response_data) continue

      let entries: ResponseEntry[]
      try {
        entries = JSON.parse(row.response_data)
      } catch {
        continue
      }

      for (const entry of entries) {
        if (!entry.email) continue
        if (since && entry.submitted_at && entry.submitted_at <= since) continue

        const email = entry.email.toLowerCase()
        responses.push({
          name: namesByEmail.get(email) ?? entry.respondent ?? null,
          email,
          poll_name: row.topic,
          poll_id: row.id,
          poll_date: row.sent_at,
          submitted_at: entry.submitted_at ?? null,
          answers: entry.answers ?? [],
        })
      }
    }

    responses.sort((a, b) => (a.submitted_at ?? '').localeCompare(b.submitted_at ?? ''))

    const format = req.nextUrl.searchParams.get('format')
    if (format === 'csv') {
      const csv = toCsv(responses)
      return new NextResponse(csv, {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="sales-oem-shortage-responses.csv"',
        },
      })
    }

    return NextResponse.json({
      poll_name: POLL_NAME,
      response_count: responses.length,
      responses,
    }, { status: 200, headers: CORS_HEADERS })
  } catch (err) {
    console.error('Sales OEM shortage poll responses public API error:', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500, headers: CORS_HEADERS })
  }
}
