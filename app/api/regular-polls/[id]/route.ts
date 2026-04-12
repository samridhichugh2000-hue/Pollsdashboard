import { NextRequest, NextResponse } from 'next/server'
import {
  getRegularPollById, updateRegularPoll,
  createPoll, updatePoll, updatePollStatus, createAuditLog,
} from '@/lib/db/queries'
import { getDb } from '@/lib/db/client'
import { sendEmailGetId } from '@/lib/graph'
import { buildPollEmailHtml, formatDate } from '@/lib/utils'

function advanceNextRunDate(current: string, frequency: 'monthly' | 'quarterly'): string {
  const date = new Date(current)
  date.setMonth(date.getMonth() + (frequency === 'quarterly' ? 3 : 1))
  return date.toISOString().split('T')[0]
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const poll = await getRegularPollById(id)
  if (!poll) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(poll)
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const template = await getRegularPollById(id)
  if (!template) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json() as Record<string, unknown>
  const { action } = body

  try {
    switch (action) {
      case 'UPDATE': {
        const allowed = ['name', 'description', 'frequency', 'scheduled_day', 'department',
          'subject', 'draft_email_body', 'questions', 'recipients', 'next_run_date', 'is_active']
        const updates: Record<string, unknown> = {}
        for (const key of allowed) {
          if (key in body) updates[key] = body[key]
        }
        await updateRegularPoll(id, updates as Parameters<typeof updateRegularPoll>[1])
        break
      }

      case 'TOGGLE_ACTIVE': {
        await updateRegularPoll(id, { is_active: template.is_active ? 0 : 1 })
        break
      }

      case 'RELEASE': {
        const subject = (body.subject as string) || template.subject
        const emailBody = (body.draft_email_body as string) || template.draft_email_body
        const questionsRaw = (body.questions as string) || template.questions

        const recipients: string[] = JSON.parse(template.recipients)
        if (!recipients.length) return NextResponse.json({ error: 'No recipients configured.' }, { status: 400 })

        const appUrl = process.env.NEXTAUTH_URL?.replace('http://localhost:3000', 'https://pollsdashboard.vercel.app') ?? 'https://pollsdashboard.vercel.app'
        const deadline = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()

        // Create a standard poll record (pre-approved, skip approval workflow)
        const poll = await createPoll({
          topic: template.name,
          department: template.department,
          requested_by: 'Regular Poll (Auto)',
          source: 'dashboard',
          questions: JSON.parse(questionsRaw) as string[],
          deadline,
          remarks: `Released from regular poll template: ${template.name}`,
        })

        const formLink = `${appUrl}/respond/${poll.id}`
        await updatePoll(poll.id, {
          subject,
          draft_email_body: emailBody,
          ms_form_id: poll.id,
          ms_form_link: formLink,
        })

        const pollHtml = buildPollEmailHtml({
          emailBody,
          msFormLink: formLink,
          deadline: formatDate(deadline),
        })

        const releaseMessageId = await sendEmailGetId({
          from: process.env.PRIYA_EMAIL!,
          to: recipients,
          subject,
          htmlBody: pollHtml,
        })

        await updatePollStatus(poll.id, 'SENT', {
          sent_at: new Date().toISOString(),
          release_emails: JSON.stringify(recipients),
          release_message_id: releaseMessageId,
        })
        await createAuditLog(poll.id, 'POLL_RELEASED', 'regular-poll-system', {
          regular_poll_id: id,
          template_name: template.name,
        })

        // Advance the template's next run date
        await updateRegularPoll(id, {
          last_run_date: new Date().toISOString().split('T')[0],
          next_run_date: advanceNextRunDate(template.next_run_date, template.frequency),
        })
        break
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
    }

    const updated = await getRegularPollById(id)
    return NextResponse.json(updated)
  } catch (err) {
    console.error('Regular poll action error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Action failed' },
      { status: 500 }
    )
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await getDb().execute({ sql: 'DELETE FROM regular_polls WHERE id = ?', args: [id] })
  return NextResponse.json({ ok: true })
}
