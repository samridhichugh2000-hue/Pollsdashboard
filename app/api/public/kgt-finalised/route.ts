import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db/client'

// Public, API-key-gated (INDEX_DASHBOARD_API_KEY, for the Index dashboard) list of KGT (ownership-transfer) requests along with
// the employees marked "Finalised" on each one.
//
// "Finalised" is the KGT label for response entries with actionable === true
// inside poll_responses.response_data (see poll-detail.tsx / kgt page).
// Respondents are tracked by email there, so emp_code is resolved through the
// employees cache (needs employees synced with emp codes, like kgt-participation).
//
// Optional query param: kgt_name — case-insensitive substring match on topic.

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
  actionable?: boolean | null
  finalised_at?: string | null
}

interface KgtRow {
  poll_id: string
  topic: string
  department: string
  status: string
  response_data: string | null
}

export async function GET(req: NextRequest) {
  const apiKey = req.headers.get('x-api-key')
  const expectedKey = process.env.INDEX_DASHBOARD_API_KEY

  if (!expectedKey) {
    return NextResponse.json({ error: 'API not configured.' }, { status: 503, headers: CORS_HEADERS })
  }
  if (apiKey !== expectedKey) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401, headers: CORS_HEADERS })
  }

  const kgtName = req.nextUrl.searchParams.get('kgt_name')?.trim().toLowerCase()

  try {
    const db = getDb()

    const kgtResult = await db.execute(`
      SELECT p.id as poll_id, p.topic, p.department, p.status, pr.response_data
      FROM polls p
      JOIN poll_responses pr ON pr.poll_id = p.id
      WHERE p.request_type = 'KGT' AND p.status != 'ARCHIVED' AND pr.response_data IS NOT NULL
    `)

    const employeeResult = await db.execute(
      'SELECT emp_code, email_address, first_name, last_name FROM employees WHERE email_address IS NOT NULL'
    )
    const employeesByEmail = new Map<string, { emp_code: string | null; name: string | null }>()
    for (const e of employeeResult.rows as unknown as { emp_code: string | null; email_address: string; first_name: string | null; last_name: string | null }[]) {
      employeesByEmail.set(e.email_address.toLowerCase(), {
        emp_code: e.emp_code,
        name: [e.first_name, e.last_name].filter(Boolean).join(' ') || null,
      })
    }

    // Entries finalised before finalised_at existed: fall back to the audit log —
    // the latest decision for each entry index, if it was "actionable".
    const auditResult = await db.execute(`
      SELECT poll_id, metadata, created_at FROM audit_logs
      WHERE action = 'ENTRY_ACTIONABLE_UPDATED' ORDER BY created_at ASC
    `)
    const auditFinalised = new Map<string, string | null>() // `${poll_id}:${entryIndex}` -> date, null if last decision wasn't finalised
    for (const a of auditResult.rows as unknown as { poll_id: string; metadata: string | null; created_at: string }[]) {
      try {
        const m = JSON.parse(a.metadata ?? '{}') as { entryIndex?: number; actionable?: boolean | null }
        if (typeof m.entryIndex !== 'number') continue
        const key = `${a.poll_id}:${m.entryIndex}`
        // keep the first date of a continuous "finalised" run, reset on any other decision
        if (m.actionable === true) { if (!auditFinalised.get(key)) auditFinalised.set(key, a.created_at.includes('T') ? a.created_at : `${a.created_at.replace(' ', 'T')}Z`) }
        else auditFinalised.set(key, null)
      } catch { /* skip */ }
    }

    const seenPollIds = new Set<string>()
    const kgts: {
      kgt_id: string
      kgt_name: string
      department: string
      finalised_count: number
      finalised_employees: { emp_id: string | null; name: string | null; email: string | null; finalised_on: string | null }[]
    }[] = []

    for (const row of kgtResult.rows as unknown as KgtRow[]) {
      if (seenPollIds.has(row.poll_id) || !row.response_data) continue
      if (kgtName && !row.topic.toLowerCase().includes(kgtName)) continue

      try {
        const entries = JSON.parse(row.response_data) as ResponseEntry[]
        const finalised = entries
          .map((e, i) => ({ e, i }))
          .filter(({ e }) => e.actionable === true)
          .map(({ e, i }) => {
            const email = e.email?.toLowerCase() ?? null
            const emp = email ? employeesByEmail.get(email) : undefined
            return {
              emp_id: emp?.emp_code ?? null,
              name: emp?.name ?? e.respondent ?? null,
              email,
              finalised_on: e.finalised_at ?? auditFinalised.get(`${row.poll_id}:${i}`) ?? null,
            }
          })

        seenPollIds.add(row.poll_id)
        kgts.push({
          kgt_id: row.poll_id,
          kgt_name: row.topic,
          department: row.department,
          finalised_count: finalised.length,
          finalised_employees: finalised,
        })
      } catch {
        // malformed response_data — skip
      }
    }

    return NextResponse.json({ kgt_count: kgts.length, kgts }, { status: 200, headers: CORS_HEADERS })
  } catch (err) {
    console.error('KGT finalised public API error:', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500, headers: CORS_HEADERS })
  }
}
