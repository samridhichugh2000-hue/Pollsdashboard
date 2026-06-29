import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db/client'
import { runMigrations } from '@/lib/db/schema'

const KOENIG_BASE = 'https://api.koenig-solutions.com'
const KOENIG_USER = 'Samridhi_GetEmployeeDeta'
const KOENIG_PASS = 'JZ4Xf8KxU!bH'
const KOENIG_ROLE = 'Get Employee Details (PMS)'
const API_KEY = '236'

interface KoenigEmployee {
  first_name: string | null
  last_name: string | null
  email_address: string | null
  manager_name: string | null
  deparment_name: string | null  // API typo — intentionally misspelled
  designation_name: string | null
  emp_code?: string | null
}

async function fetchAllEmployees(): Promise<KoenigEmployee[]> {
  const tokenRes = await fetch(`${KOENIG_BASE}/api/Kites/Operator/GetToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userName: KOENIG_USER, userPassword: KOENIG_PASS, userRole: KOENIG_ROLE }),
  })
  const tokenData = await tokenRes.json() as { content: { accessToken: string; deviceToken: string } }
  const { accessToken, deviceToken } = tokenData.content

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

export async function GET() {
  await runMigrations()
  const db = getDb()
  const rows = await db.execute(`
    SELECT emp_code, first_name, last_name, email_address, manager_name, department_name, designation_name, synced_at
    FROM employees ORDER BY CAST(emp_code AS INTEGER)
  `)
  return NextResponse.json(rows.rows)
}

export async function POST() {
  await runMigrations()
  const db = getDb()

  const employees = await fetchAllEmployees()

  // Wipe and replace so removed employees don't linger
  await db.execute(`DELETE FROM employees`)

  let synced = 0
  for (const emp of employees) {
    const email = emp.email_address?.trim() ?? ''
    if (!email.toLowerCase().includes('@koenig-solutions.com')) continue
    await db.execute({
      sql: `INSERT INTO employees (email_address, emp_code, first_name, last_name, manager_name, department_name, designation_name, synced_at)
            VALUES (?, NULL, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(email_address) DO UPDATE SET
              first_name = excluded.first_name,
              last_name = excluded.last_name,
              manager_name = excluded.manager_name,
              department_name = excluded.department_name,
              designation_name = excluded.designation_name,
              synced_at = CURRENT_TIMESTAMP`,
      args: [email, emp.first_name, emp.last_name, emp.manager_name, emp.deparment_name, emp.designation_name],
    })
    synced++
  }

  return NextResponse.json({ synced, message: `Synced ${synced} active employees`, complete: true })
}
