import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db/client'

interface RawEntry {
  email?: string
  respondent?: string
  submitted_at?: string
}

interface PollRow {
  id: string
  topic: string
  department: string
  sent_at: string | null
  status: string
}

interface EmployeeRow {
  emp_code: string
  first_name: string | null
  last_name: string | null
  email_address: string | null
  manager_name: string | null
  department_name: string | null
  designation_name: string | null
}

export interface ParticipantPoll {
  poll_id: string
  topic: string
  department: string
  submitted_at: string | null
}

export interface Participant {
  emp_code: string | null
  full_name: string
  email: string
  manager_name: string | null
  department_name: string | null
  designation_name: string | null
  participation_count: number
  polls: ParticipantPoll[]
}

export async function GET() {
  const db = getDb()

  // Load all polls
  const pollsResult = await db.execute(
    `SELECT id, topic, department, sent_at, status FROM polls WHERE status NOT IN ('ARCHIVED','DETECTED') ORDER BY sent_at DESC`
  )
  const polls = pollsResult.rows as unknown as PollRow[]

  // Load all poll_responses
  const respResult = await db.execute(`SELECT poll_id, response_data FROM poll_responses`)

  // Load employee cache — exclude blue-collar designations
  const BLUE_COLLAR_KEYWORDS = ['housekeeping', 'driver', 'security', 'peon', 'electrician', 'cook', 'garden', 'gardener', 'gardner', 'plumber', 'sweeper', 'cleaner', 'watchman', 'guard', 'office boy', 'office girl', 'boy']
  const empResult = await db.execute(`SELECT emp_code, first_name, last_name, email_address, manager_name, department_name, designation_name FROM employees`)
  const allEmployees = empResult.rows as unknown as (EmployeeRow & { designation_name: string | null })[]
  const employees = allEmployees.filter(e => {
    const desig = (e.designation_name ?? '').toLowerCase()
    const dept = (e.department_name ?? '').toLowerCase()
    return !BLUE_COLLAR_KEYWORDS.some(kw => desig.includes(kw)) && !dept.includes('blue collar')
  })
  const empByEmail = new Map<string, EmployeeRow>()
  for (const e of employees) {
    if (e.email_address) empByEmail.set(e.email_address.toLowerCase().trim(), e)
  }

  // Build poll map
  const pollMap = new Map<string, PollRow>()
  for (const p of polls) pollMap.set(p.id, p)

  // Aggregate participation by email
  const byEmail = new Map<string, { name: string; polls: ParticipantPoll[] }>()

  for (const row of respResult.rows) {
    const pollId = row[0] as string
    const responseData = row[1] as string | null
    if (!responseData) continue

    let entries: RawEntry[] = []
    try { entries = JSON.parse(responseData) as RawEntry[] } catch { continue }

    const poll = pollMap.get(pollId)
    if (!poll) continue

    for (const entry of entries) {
      const email = (entry.email ?? '').toLowerCase().trim()
      if (!email) continue

      const existing = byEmail.get(email)
      const pollInfo: ParticipantPoll = {
        poll_id: pollId,
        topic: poll.topic,
        department: poll.department,
        submitted_at: entry.submitted_at ?? null,
      }

      if (existing) {
        // avoid duplicate poll entries
        if (!existing.polls.some(p => p.poll_id === pollId)) {
          existing.polls.push(pollInfo)
        }
      } else {
        byEmail.set(email, {
          name: entry.respondent ?? email,
          polls: [pollInfo],
        })
      }
    }
  }

  // Also include all employees from cache (even those with 0 participation)
  for (const emp of employees) {
    if (!emp.email_address) continue
    const email = emp.email_address.toLowerCase().trim()
    if (!byEmail.has(email)) {
      byEmail.set(email, { name: `${emp.first_name ?? ''} ${emp.last_name ?? ''}`.trim() || email, polls: [] })
    }
  }

  // Build final list — only include employees present in the active employee DB
  const participants: Participant[] = []
  for (const emp of employees) {
    if (!emp.email_address) continue
    const email = emp.email_address.toLowerCase().trim()
    const data = byEmail.get(email)
    participants.push({
      emp_code: emp?.emp_code ?? null,
      full_name: `${emp.first_name ?? ''} ${emp.last_name ?? ''}`.trim() || email,
      email,
      manager_name: emp?.manager_name ?? null,
      department_name: emp?.department_name ?? null,
      designation_name: emp?.designation_name ?? null,
      participation_count: data?.polls.length ?? 0,
      polls: (data?.polls ?? []).sort((a, b) => (b.submitted_at ?? '').localeCompare(a.submitted_at ?? '')),
    })
  }

  // Sort: participated first, then by name
  participants.sort((a, b) => {
    if (b.participation_count !== a.participation_count) return b.participation_count - a.participation_count
    return a.full_name.localeCompare(b.full_name)
  })

  const employeeSynced = employees.length > 0
  let lastSyncedAt: string | null = null
  if (employeeSynced) {
    const tsRow = await db.execute(`SELECT MAX(synced_at) as ts FROM employees`)
    lastSyncedAt = (tsRow.rows[0] as unknown as { ts: string | null })?.ts ?? null
  }
  // Count only employees with an email — same population as `participants`
  // (built by filtering on emp.email_address). Previously this counted every
  // non-blue-collar employee including ones with no email, so "Total
  // employees" could show a number the table below could never reach even
  // with zero filters applied.
  const totalEmployees = employees.filter(e => e.email_address).length
  return NextResponse.json({ participants, employeeSynced, totalEmployees, lastSyncedAt })
}
