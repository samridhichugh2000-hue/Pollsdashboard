import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import {
  getRegularPollById, updateRegularPoll,
  createPoll, updatePoll, updatePollStatus, createAuditLog,
  getRegularPollAttachments, getRegularPollAttachmentsMeta, replaceRegularPollAttachments,
  replacePollAttachments,
} from '@/lib/db/queries'
import type { PollAttachment } from '@/lib/db/queries'
import { getDb } from '@/lib/db/client'
import { sendEmailGetId } from '@/lib/graph'
import { buildPollEmailHtml, formatDate, computeNextRunDate, advanceNextRunDate } from '@/lib/utils'

const MAX_ATTACHMENT_FILE_BYTES = 3 * 1024 * 1024
const MAX_ATTACHMENT_TOTAL_BYTES = 3 * 1024 * 1024

function decodedSize(base64: string): number {
  return Math.floor((base64.length * 3) / 4)
}

function validateNewAttachments(existing: PollAttachment[], incoming: PollAttachment[]): string | null {
  for (const a of incoming) {
    if (decodedSize(a.contentBytes) > MAX_ATTACHMENT_FILE_BYTES) return `Attachment "${a.name}" exceeds the 3 MB per-file limit.`
  }
  const total = [...existing, ...incoming].reduce((sum, a) => sum + decodedSize(a.contentBytes), 0)
  if (total > MAX_ATTACHMENT_TOTAL_BYTES) return 'Attachments exceed the 3 MB total limit.'
  return null
}

// Merge existing stored attachments with client-submitted new files and removals —
// same three-way merge used by the one-off poll RELEASE_POLL flow.
async function mergeAttachments(regularPollId: string, newAttachments: PollAttachment[], removeNames: string[]): Promise<PollAttachment[] | null | { error: string }> {
  if (newAttachments.length === 0 && removeNames.length === 0) return null // nothing to change
  const existing = await getRegularPollAttachments(regularPollId)
  const removeSet = new Set(removeNames)
  const kept = existing.filter(a => !removeSet.has(a.name))
  const newNames = new Set(newAttachments.map(a => a.name))
  const sizeError = validateNewAttachments(kept, newAttachments)
  if (sizeError) return { error: sizeError }
  const merged = [...kept.filter(a => !newNames.has(a.name)), ...newAttachments]
  await replaceRegularPollAttachments(regularPollId, merged)
  return merged
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const poll = await getRegularPollById(id)
  if (!poll) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const attachments = await getRegularPollAttachmentsMeta(id)
  return NextResponse.json({ ...poll, attachments })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const template = await getRegularPollById(id)
  if (!template) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json() as Record<string, unknown>
  const { action } = body

  try {
    switch (action) {
      case 'UPDATE': {
        // next_run_date is intentionally NOT client-controllable — it's always
        // derived server-side from frequency/scheduled_day so create and edit
        // can't disagree on it (edit used to trust whatever the client sent
        // verbatim, computed against the client's own clock/timezone).
        const allowed = ['name', 'description', 'frequency', 'scheduled_day', 'department',
          'subject', 'draft_email_body', 'questions', 'recipients', 'is_active']
        const updates: Record<string, unknown> = {}
        for (const key of allowed) {
          if (key in body) updates[key] = body[key]
        }
        if ('frequency' in updates || 'scheduled_day' in updates) {
          const freq = (updates.frequency as string | undefined) ?? template.frequency
          const day = Number((updates.scheduled_day as number | undefined) ?? template.scheduled_day)
          updates.next_run_date = computeNextRunDate(freq, day)
        }
        await updateRegularPoll(id, updates as Parameters<typeof updateRegularPoll>[1])

        const newAttachments = (body.newAttachments as PollAttachment[] | undefined) ?? []
        const removeAttachmentNames = (body.removeAttachmentNames as string[] | undefined) ?? []
        const mergeResult = await mergeAttachments(id, newAttachments, removeAttachmentNames)
        if (mergeResult && 'error' in mergeResult) return NextResponse.json({ error: mergeResult.error }, { status: 400 })
        break
      }

      // Standalone attachment update — used from the "upcoming release" banner so
      // the user can swap the file(s) without reopening the full edit form. This
      // only changes what regular_poll_attachments holds for THIS template; every
      // future release (auto or manual) reads that table fresh at send time, so
      // the new file goes out from the very next release onward.
      case 'UPDATE_ATTACHMENTS': {
        const newAttachments = (body.newAttachments as PollAttachment[] | undefined) ?? []
        const removeAttachmentNames = (body.removeAttachmentNames as string[] | undefined) ?? []
        const merged = await mergeAttachments(id, newAttachments, removeAttachmentNames)
        if (merged && 'error' in merged) return NextResponse.json({ error: merged.error }, { status: 400 })
        return NextResponse.json({ ok: true, attachments: (merged ?? await getRegularPollAttachmentsMeta(id)) })
      }

      case 'TOGGLE_ACTIVE': {
        await updateRegularPoll(id, { is_active: template.is_active ? 0 : 1 })
        break
      }

      case 'TOGGLE_AUTO_APPROVE': {
        const currentAA = (template as unknown as Record<string, unknown>).auto_approve as number ?? 0
        await updateRegularPoll(id, { auto_approve: currentAA ? 0 : 1 } as Parameters<typeof updateRegularPoll>[1])
        break
      }

      case 'RELEASE': {
        const subject = (body.subject as string) || template.subject
        const emailBody = (body.draft_email_body as string) || template.draft_email_body
        const questionsRaw = (body.questions as string) || template.questions

        const recipients: string[] = JSON.parse(template.recipients)
        if (!recipients.length) return NextResponse.json({ error: 'No recipients configured.' }, { status: 400 })

        const appUrl = process.env.NEXTAUTH_URL?.replace('http://localhost:3000', 'https://pollsdashboard.vercel.app') ?? 'https://pollsdashboard.vercel.app'
        const deadlineRaw = body.deadline as string | undefined
        const deadline = deadlineRaw ? new Date(deadlineRaw).toISOString() : new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()

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

        // Use whatever is currently stored against this cadence template — the
        // original attachment if never updated, or the replacement if it was.
        const attachments = await getRegularPollAttachments(id)

        const pollsMailbox = process.env.POLLS_MAILBOX ?? process.env.PRIYA_EMAIL!
        const releaseMessageId = await sendEmailGetId({
          from: process.env.PRIYA_EMAIL!,
          to: pollsMailbox,
          bcc: recipients,
          subject,
          htmlBody: pollHtml,
          ...(attachments.length > 0 && { attachments }),
        })

        if (attachments.length > 0) await replacePollAttachments(poll.id, attachments)

        await updatePollStatus(poll.id, 'SENT', {
          sent_at: new Date().toISOString(),
          release_emails: JSON.stringify(recipients),
          release_message_id: releaseMessageId,
        })
        await createAuditLog(poll.id, 'POLL_RELEASED', 'regular-poll-system', {
          regular_poll_id: id,
          template_name: template.name,
          attachments: attachments.map(a => a.name),
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
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const db = getDb()
  await db.execute({ sql: 'DELETE FROM regular_poll_attachments WHERE regular_poll_id = ?', args: [id] })
  await db.execute({ sql: 'DELETE FROM regular_polls WHERE id = ?', args: [id] })
  return NextResponse.json({ ok: true })
}
