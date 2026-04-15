import { NextRequest, NextResponse } from 'next/server'
import { getPollById, getPollResponse } from '@/lib/db/queries'
import * as XLSX from 'xlsx'

interface ResponseEntry {
  respondent?: string
  email?: string
  submitted_at: string
  answers: { question: string; answer: string }[]
  actionable?: boolean | null
  remarks?: string
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [poll, pollResponse] = await Promise.all([getPollById(id), getPollResponse(id)])

  if (!poll) return NextResponse.json({ error: 'Poll not found' }, { status: 404 })
  if (!pollResponse?.response_data) {
    return NextResponse.json({ error: 'No responses available.' }, { status: 404 })
  }

  const entries: ResponseEntry[] = JSON.parse(pollResponse.response_data)

  // Build flat rows — one row per respondent
  const rows = entries.map((entry, i) => {
    const row: Record<string, string> = {
      '#': String(i + 1),
      'Email': entry.email ?? 'Not provided',
      'Name': entry.respondent ?? 'Anonymous',
      'Submitted At': new Date(entry.submitted_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
    }
    entry.answers.forEach((a, qi) => {
      row[`Q${qi + 1}: ${a.question.slice(0, 60)}${a.question.length > 60 ? '...' : ''}`] = a.answer
    })
    row['Actionable'] = entry.actionable === true ? 'Yes' : entry.actionable === false ? 'No' : ''
    row['Remarks'] = entry.remarks ?? ''
    return row
  })

  const ws = XLSX.utils.json_to_sheet(rows)

  // Auto-width columns
  const colWidths = Object.keys(rows[0] ?? {}).map((key) => ({
    wch: Math.max(key.length, ...rows.map((r) => String(r[key] ?? '').length)) + 2,
  }))
  ws['!cols'] = colWidths

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Responses')

  const buf = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' }) as string
  const binary = atob(buf)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  const blob = new Blob([bytes.buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })

  const filename = `poll-responses-${poll.topic.slice(0, 30).replace(/\s+/g, '-').toLowerCase()}.xlsx`

  return new Response(blob, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
