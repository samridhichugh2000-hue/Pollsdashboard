import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { getAllRegularPolls, createRegularPoll, replaceRegularPollAttachments, getRegularPollAttachmentCounts } from '@/lib/db/queries'
import { runMigrations } from '@/lib/db/schema'
import { computeNextRunDate } from '@/lib/utils'
import type { PollAttachment } from '@/lib/db/queries'
import type { RegularPollFrequency } from '@/types'

// Attachments are base64 (~33% larger than raw bytes) and sent as JSON.
// Matches the client-side limit in app/(dashboard)/cadence/page.tsx — that
// limit is enforced there for UX, but a modified client or a direct API call
// could skip it, so it must also be enforced here.
const MAX_ATTACHMENT_FILE_BYTES = 3 * 1024 * 1024
const MAX_ATTACHMENT_TOTAL_BYTES = 3 * 1024 * 1024

function decodedSize(base64: string): number {
  return Math.floor((base64.length * 3) / 4)
}

function validateAttachments(attachments: PollAttachment[]): string | null {
  let total = 0
  for (const a of attachments) {
    const size = decodedSize(a.contentBytes)
    if (size > MAX_ATTACHMENT_FILE_BYTES) return `Attachment "${a.name}" exceeds the 3 MB per-file limit.`
    total += size
  }
  if (total > MAX_ATTACHMENT_TOTAL_BYTES) return 'Attachments exceed the 3 MB total limit.'
  return null
}

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await runMigrations()
  const [polls, counts] = await Promise.all([getAllRegularPolls(), getRegularPollAttachmentCounts()])
  return NextResponse.json(polls.map(p => ({ ...p, attachmentCount: counts[p.id] ?? 0 })))
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await runMigrations()
  const body = await req.json() as Record<string, unknown>
  const { name, description, frequency, scheduled_day, department, subject, draft_email_body, questions, recipients, attachments } = body

  if (!name || !frequency || !scheduled_day || !department || !subject || !draft_email_body || !questions || !recipients) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  if (Array.isArray(attachments) && attachments.length > 0) {
    const sizeError = validateAttachments(attachments as PollAttachment[])
    if (sizeError) return NextResponse.json({ error: sizeError }, { status: 400 })
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

  if (Array.isArray(attachments) && attachments.length > 0) {
    await replaceRegularPollAttachments(poll.id, attachments as PollAttachment[])
  }

  return NextResponse.json(poll, { status: 201 })
}
