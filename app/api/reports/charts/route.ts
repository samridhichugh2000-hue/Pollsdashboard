import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db/client'

interface MonthBucket {
  month: string   // "YYYY-MM"
  label: string   // "Jan 2025"
  count: number
}

function buildMonthBuckets(months: string[]): MonthBucket[] {
  return months.map(m => {
    const [year, mon] = m.split('-')
    const label = new Date(Number(year), Number(mon) - 1, 1)
      .toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
    return { month: m, label, count: 0 }
  })
}

function monthsBetween(from: string, to: string): string[] {
  const result: string[] = []
  const [fy, fm] = from.split('-').map(Number)
  const [ty, tm] = to.split('-').map(Number)
  let y = fy, m = fm
  while (y < ty || (y === ty && m <= tm)) {
    result.push(`${y}-${String(m).padStart(2, '0')}`)
    m++; if (m > 12) { m = 1; y++ }
  }
  return result
}

function last12Months(): [string, string] {
  const now = new Date()
  const to = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const from12 = new Date(now.getFullYear(), now.getMonth() - 11, 1)
  const from = `${from12.getFullYear()}-${String(from12.getMonth() + 1).padStart(2, '0')}`
  return [from, to]
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const [defaultFrom, defaultTo] = last12Months()
  const from = url.searchParams.get('from') ?? defaultFrom
  const to = url.searchParams.get('to') ?? defaultTo
  const db = getDb()
  const months = monthsBetween(from, to)

  // Month-wise polls (by sent_at)
  const pollsResult = await db.execute(`
    SELECT strftime('%Y-%m', sent_at) as month, COUNT(*) as cnt
    FROM polls
    WHERE sent_at IS NOT NULL
      AND status NOT IN ('ARCHIVED', 'DETECTED')
    GROUP BY month
    ORDER BY month
  `)

  const monthlyPolls = buildMonthBuckets(months)
  for (const row of pollsResult.rows) {
    const m = row[0] as string
    const bucket = monthlyPolls.find(b => b.month === m)
    if (bucket) bucket.count = Number(row[1])
  }

  // Month-wise responses — parse submitted_at from response_data JSON entries.
  // Joined against polls with the same ARCHIVED/DETECTED exclusion as the
  // polls query above — previously this had no filter at all, so responses
  // belonging to archived/detected polls leaked into the chart.
  const respResult = await db.execute(`
    SELECT pr.response_data
    FROM poll_responses pr
    JOIN polls p ON p.id = pr.poll_id
    WHERE pr.response_data IS NOT NULL
      AND p.status NOT IN ('ARCHIVED', 'DETECTED')
  `)

  const responseCounts: Record<string, number> = {}
  for (const row of respResult.rows) {
    try {
      const entries = JSON.parse(row[0] as string) as { submitted_at?: string }[]
      for (const entry of entries) {
        if (!entry.submitted_at) continue
        const m = entry.submitted_at.slice(0, 7) // "YYYY-MM"
        responseCounts[m] = (responseCounts[m] ?? 0) + 1
      }
    } catch { /* skip malformed */ }
  }

  const monthlyResponses = buildMonthBuckets(months)
  for (const bucket of monthlyResponses) {
    bucket.count = responseCounts[bucket.month] ?? 0
  }

  return NextResponse.json({ monthlyPolls, monthlyResponses, from, to })
}
