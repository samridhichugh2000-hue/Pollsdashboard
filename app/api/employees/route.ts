import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { getDb } from '@/lib/db/client'
import { runMigrations } from '@/lib/db/schema'

const KOENIG_BASE = 'https://api.koenig-solutions.com'
const KOENIG_USER = process.env.KOENIG_EMPLOYEE_USERNAME!
const KOENIG_PASS = process.env.KOENIG_EMPLOYEE_PASSWORD!
const KOENIG_ROLE = process.env.KOENIG_EMPLOYEE_ROLE!
const API_KEY = process.env.KOENIG_EMPLOYEE_API_KEY!

// Separate account used only to fetch accurate emp codes — the main account above
// returns manager/department/designation but its emp_code field comes back blank.
const EMPCODE_USER = process.env.KOENIG_EMPCODE_USERNAME!
const EMPCODE_PASS = process.env.KOENIG_EMPCODE_PASSWORD!
const EMPCODE_ROLE = process.env.KOENIG_EMPCODE_ROLE!
const EMPCODE_API_KEY = process.env.KOENIG_EMPCODE_API_KEY!

interface KoenigEmployee {
  first_name: string | null
  last_name: string | null
  email_address: string | null
  manager_name: string | null
  deparment_name: string | null  // API typo — intentionally misspelled
  designation_name: string | null
  emp_code?: string | null
}

interface KoenigEmpCodeEntry {
  user_name: string | null
  user_emp_code: string | number | null
  user_id: number | null
  user_email_address: string | null
}

async function getToken(user: string, pass: string, role: string): Promise<{ accessToken: string; deviceToken: string }> {
  const tokenRes = await fetch(`${KOENIG_BASE}/api/Kites/Operator/GetToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userName: user, userPassword: pass, userRole: role }),
  })
  const tokenData = await tokenRes.json() as { content: { accessToken: string; deviceToken: string } }
  return tokenData.content
}

async function fetchAllEmployees(): Promise<KoenigEmployee[]> {
  const { accessToken, deviceToken } = await getToken(KOENIG_USER, KOENIG_PASS, KOENIG_ROLE)

  const url = `${KOENIG_BASE}/api/Kites/Operator/common?apikey=${API_KEY}&accessToken=${encodeURIComponent(accessToken)}&deviceToken=${deviceToken}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emp_code: '0' }),
  })
  const data = await res.json() as { statuscode: number; content: string }
  if (data.statuscode !== 200 || !data.content) return []
  return JSON.parse(data.content) as KoenigEmployee[]
}

// Returns a map of lowercased email -> emp_code from the dedicated emp-code account.
async function fetchEmpCodesByEmail(): Promise<Map<string, string>> {
  const { accessToken, deviceToken } = await getToken(EMPCODE_USER, EMPCODE_PASS, EMPCODE_ROLE)

  const url = `${KOENIG_BASE}/api/Kites/Operator/common?apikey=${EMPCODE_API_KEY}&accessToken=${encodeURIComponent(accessToken)}&deviceToken=${deviceToken}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  const data = await res.json() as { statuscode: number; content: string; message?: string }
  if (data.statuscode !== 200 || !data.content) {
    console.error('[employees sync] emp-code fetch failed:', data.statuscode, data.message)
    return new Map()
  }

  const entries = JSON.parse(data.content) as KoenigEmpCodeEntry[]
  const map = new Map<string, string>()
  for (const e of entries) {
    const email = e.user_email_address?.trim().toLowerCase()
    if (email && e.user_emp_code != null) map.set(email, String(e.user_emp_code))
  }
  console.log('[employees sync] emp-code map size:', map.size)
  return map
}

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await runMigrations()
  const db = getDb()
  const rows = await db.execute(`
    SELECT emp_code, first_name, last_name, email_address, manager_name, department_name, designation_name, synced_at
    FROM employees ORDER BY CAST(emp_code AS INTEGER)
  `)
  return NextResponse.json(rows.rows)
}

export async function POST() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await runMigrations()
  const db = getDb()

  const [employees, empCodesByEmail] = await Promise.all([fetchAllEmployees(), fetchEmpCodesByEmail()])

  // Never wipe the table on an empty/failed fetch — a transient upstream
  // hiccup (rate limit, bad token) would otherwise silently delete every
  // previously-synced employee with nothing to replace them.
  if (employees.length === 0) {
    return NextResponse.json({ synced: 0, message: 'Upstream returned no employees — sync aborted, existing data untouched.', complete: false }, { status: 502 })
  }

  // Wipe and replace so removed employees don't linger
  await db.execute(`DELETE FROM employees`)

  let synced = 0
  for (const emp of employees) {
    const email = emp.email_address?.trim() ?? ''
    if (!email.toLowerCase().includes('@koenig-solutions.com')) continue
    const empCode = emp.emp_code ?? empCodesByEmail.get(email.toLowerCase()) ?? null
    await db.execute({
      sql: `INSERT INTO employees (email_address, emp_code, first_name, last_name, manager_name, department_name, designation_name, synced_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(email_address) DO UPDATE SET
              emp_code = excluded.emp_code,
              first_name = excluded.first_name,
              last_name = excluded.last_name,
              manager_name = excluded.manager_name,
              department_name = excluded.department_name,
              designation_name = excluded.designation_name,
              synced_at = CURRENT_TIMESTAMP`,
      args: [email, empCode, emp.first_name, emp.last_name, emp.manager_name, emp.deparment_name, emp.designation_name],
    })
    synced++
  }

  return NextResponse.json({ synced, empCodeMapSize: empCodesByEmail.size, message: `Synced ${synced} active employees`, complete: true })
}
