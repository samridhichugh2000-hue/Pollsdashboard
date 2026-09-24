import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db/client'

// Public, API-key-gated lookup: given an employee's email, return how many
// polls they've responded to, plus the topic/department of each one.
// Respondent identity is tracked by email inside poll_responses.response_data
// (a JSON array per poll).
//
// Input is email, not emp_code: the employees table's emp_code column is
// always NULL today (Koenig's bulk employee-sync API doesn't return it — see
// lib/db/schema.ts), so an emp_code-keyed lookup would never match anyone.
//
// Participation is counted directly from poll_responses by email — it does
// NOT require the email to exist in the employees table first. That table is
// just a sync cache (569 rows) and is missing plenty of real respondents
// (e.g. Janet Berger, Ishwin Khokhar have dozens of recorded responses but
// were never in the employees cache) — gating on it produced false "0/404"
// results for people who had actually voted. employees is now only consulted
// for a nicer display name, never to decide whether someone participated.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'x-api-key, Content-Type',
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

interface ResponseEntry {
  email?: string
  respondent?: string
  submitted_at?: string
}

interface PollResponseRow {
  poll_id: string
  topic: string
  department: string
  response_data: string | null
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

  const inputEmail = req.nextUrl.searchParams.get('email')?.trim().toLowerCase()
  if (!inputEmail) {
    return NextResponse.json({ error: 'email query parameter is required.' }, { status: 400, headers: CORS_HEADERS })
  }

  try {
    const db = getDb()

    const responsesResult = await db.execute(`
      SELECT pr.poll_id, p.topic, p.department, pr.response_data
      FROM poll_responses pr
      JOIN polls p ON p.id = pr.poll_id
      WHERE pr.response_data IS NOT NULL
    `)

    let matchedRespondentName: string | null = null
    const pollsParticipatedList: { poll_id: string; topic: string; department: string; submitted_at: string | null }[] = []
    for (const row of responsesResult.rows as unknown as PollResponseRow[]) {
      if (!row.response_data) continue
      try {
        const entries = JSON.parse(row.response_data) as ResponseEntry[]
        const match = entries.find(e => e.email?.toLowerCase() === inputEmail)
        if (match) {
          matchedRespondentName ??= match.respondent ?? null
          pollsParticipatedList.push({
            poll_id: row.poll_id,
            topic: row.topic,
            department: row.department,
            submitted_at: match.submitted_at ?? null,
          })
        }
      } catch {
        // malformed response_data — skip
      }
    }
    pollsParticipatedList.sort((a, b) => (b.submitted_at ?? '').localeCompare(a.submitted_at ?? ''))
    const pollsParticipated = pollsParticipatedList.length

    // employees is only used to fill in a nicer display name (and emp_code,
    // when Koenig's sync eventually starts populating it) — its absence never
    // blocks the participation count above.
    const employeeResult = await db.execute({
      sql: 'SELECT first_name, last_name, emp_code FROM employees WHERE LOWER(email_address) = ?',
      args: [inputEmail],
    })
    const employee = employeeResult.rows[0] as unknown as { first_name: string | null; last_name: string | null; emp_code: string | null } | undefined
    const name = (employee && [employee.first_name, employee.last_name].filter(Boolean).join(' ')) || matchedRespondentName

    return NextResponse.json({
      email: inputEmail,
      name: name || null,
      emp_code: employee?.emp_code ?? null,
      polls_participated: pollsParticipated,
      polls: pollsParticipatedList,
    }, { status: 200, headers: CORS_HEADERS })
  } catch (err) {
    console.error('Employee participation public API error:', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500, headers: CORS_HEADERS })
  }
}
