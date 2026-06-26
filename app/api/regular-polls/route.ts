import { NextRequest, NextResponse } from 'next/server'
import { getAllRegularPolls, createRegularPoll } from '@/lib/db/queries'
import type { RegularPollFrequency } from '@/types'

function computeNextRunDate(frequency: RegularPollFrequency, scheduledDay: number): string {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const thisMonth = new Date(today.getFullYear(), today.getMonth(), scheduledDay)
  if (thisMonth >= today) return thisMonth.toISOString().split('T')[0]
  const next = new Date(thisMonth)
  const months = frequency === 'quarterly' ? 3 : frequency === 'bi-annual' ? 6 : frequency === 'annual' ? 12 : 1
  next.setMonth(next.getMonth() + months)
  return next.toISOString().split('T')[0]
}

export async function GET() {
  const polls = await getAllRegularPolls()
  return NextResponse.json(polls)
}

export async function POST(req: NextRequest) {
  const body = await req.json() as Record<string, unknown>
  const { name, description, frequency, scheduled_day, department, subject, draft_email_body, questions, recipients } = body

  if (!name || !frequency || !scheduled_day || !department || !subject || !draft_email_body || !questions || !recipients) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const freq = frequency as RegularPollFrequency
  const day = Number(scheduled_day)
  const appUrl = process.env.NEXTAUTH_URL?.replace('http://localhost:3000', 'https://pollsdashboard.vercel.app') ?? 'https://pollsdashboard.vercel.app'

  const poll = await createRegularPoll({
    name: name as string,
    description: (description as string) || null,
    frequency: freq,
    scheduled_day: day,
    department: department as string,
    subject: subject as string,
    draft_email_body: draft_email_body as string,
    questions: typeof questions === 'string' ? questions : JSON.stringify(questions),
    recipients: typeof recipients === 'string' ? recipients : JSON.stringify(recipients),
    ms_form_link: `${appUrl}/respond/regular-${Date.now()}`,
    next_run_date: computeNextRunDate(freq, day),
    last_run_date: null,
    is_active: 1,
    auto_approve: 0,
  })

  return NextResponse.json(poll, { status: 201 })
}
