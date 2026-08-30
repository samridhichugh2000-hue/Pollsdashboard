import { NextRequest, NextResponse } from 'next/server'
import {
  getPollById,
  updatePoll,
  updatePollStatus,
  createApproval,
  createAuditLog,
  createApprovalToken,
  getApprovalsByPoll,
  getAuditLogsByPoll,
  getPollResponse,
  updateResponseActionable,
  upsertPollResponse,
  replacePollAttachments,
  getPollAttachments,
  getPollAttachmentsMeta,
  closeOutUntouchedEntries,
  CLOSED_POLL_STATUSES,
} from '@/lib/db/queries'
import type { PollAttachment } from '@/lib/db/queries'
import { sendEmail, replyToMessageWithHtml, forwardMessageWithHtml, standardCC } from '@/lib/graph'
import { buildApprovalEmailHtml, buildPollEmailHtml, buildResultsEmailHtml, buildDeadlineExtensionAudienceHtml, buildDeadlineExtensionRequesterHtml, buildReplyToRespondentHtml, buildNoActionTakenHtml, formatDate, toISTDateStr } from '@/lib/utils'
import { releasePollNow } from '@/lib/poll-release'
import { generatePollDraft } from '@/lib/draft-generator'
import { generateDraftWithGemini } from '@/lib/gemini'
import { pushPollToKites, buildResponsesHtml, uploadPollResults } from '@/lib/kites-api'
import * as XLSX from 'xlsx'
import { writeFileSync, mkdirSync, unlinkSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { Poll } from '@/types'
import { STATUS_LABELS } from '@/types'

// Matches the client-side limit in components/polls/poll-detail.tsx — that
// limit is enforced there for UX, but a modified client or a direct API call
// could skip it, so it must also be enforced here.
const MAX_ATTACHMENT_FILE_BYTES = 3 * 1024 * 1024
const MAX_ATTACHMENT_TOTAL_BYTES = 3 * 1024 * 1024

function validateAttachmentSizes(attachments: PollAttachment[]): string | null {
  let total = 0
  for (const a of attachments) {
    const size = Math.floor((a.contentBytes.length * 3) / 4)
    if (size > MAX_ATTACHMENT_FILE_BYTES) return `Attachment "${a.name}" exceeds the 3 MB per-file limit.`
    total += size
  }
  if (total > MAX_ATTACHMENT_TOTAL_BYTES) return 'Attachments exceed the 3 MB total limit.'
  return null
}

interface ResponseEntryRecord {
  email?: string
  respondent?: string
  answers?: { question: string; answer: string }[]
  actionable?: boolean | null
  reply_sent_at?: string
  no_action_email_sent_at?: string
  [key: string]: unknown
}

function nameFromEmail(email: string): string {
  return email.split('@')[0].split('.').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ')
}

// Runs whenever a poll is closed — anyone whose response was never given an
// actionable/not-actionable decision (and who hasn't already gotten a manual
// reply) gets a closing notice so no respondent is left without any
// acknowledgement. Persists after each successful send (not once at the end)
// so a crash or timeout partway through never causes a duplicate send on retry.
async function sendNoActionTakenEmails(pollId: string, topic: string): Promise<void> {
  if (!process.env.PRIYA_EMAIL) return
  const pollResp = await getPollResponse(pollId)
  if (!pollResp?.response_data) return

  let entries: ResponseEntryRecord[]
  try {
    entries = JSON.parse(pollResp.response_data) as ResponseEntryRecord[]
  } catch {
    return
  }

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    if (entry.actionable != null || entry.reply_sent_at || entry.no_action_email_sent_at || !entry.email) continue

    try {
      await sendEmail({
        from: process.env.POLLS_MAILBOX ?? 'polls@koenig-solutions.com',
        to: entry.email,
        cc: standardCC(),
        subject: `Re: Your response to "${topic}"`,
        htmlBody: buildNoActionTakenHtml({
          name: entry.respondent ?? nameFromEmail(entry.email),
          topic,
          answers: entry.answers ?? [],
        }),
      })
    } catch (err) {
      console.error(`Failed to send no-action-taken email to ${entry.email} for poll ${pollId}:`, err)
      continue
    }

    entries[i] = { ...entry, no_action_email_sent_at: new Date().toISOString() }
    await upsertPollResponse(pollId, JSON.stringify(entries))
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const poll = await getPollById(id)
  if (!poll) return NextResponse.json({ error: 'Poll not found' }, { status: 404 })

  const [approvals, auditLogs, response, attachments] = await Promise.all([
    getApprovalsByPoll(id),
    getAuditLogsByPoll(id),
    getPollResponse(id),
    getPollAttachmentsMeta(id),
  ])

  return NextResponse.json({ poll, approvals, auditLogs, response, attachments })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const poll = await getPollById(id)
  if (!poll) return NextResponse.json({ error: 'Poll not found' }, { status: 404 })

  const body = await req.json() as Record<string, unknown>
  const { action } = body
  const userEmail = 'gunjan.setia@koenig-solutions.com'

  try {
    switch (action) {
      case 'SEND_FOR_APPROVAL': {
        if (!poll.draft_email_body) {
          return NextResponse.json({ error: 'No draft email body. Generate draft first.' }, { status: 400 })
        }
        if (!poll.ms_form_link) {
          return NextResponse.json({ error: 'Poll form not created yet.' }, { status: 400 })
        }

        const rawQuestions = poll.questions ? JSON.parse(poll.questions) as Array<string | { text: string }> : []
        const questions: string[] = rawQuestions.map((q) => (typeof q === 'string' ? q : q.text))
        const deadline = poll.deadline ? formatDate(poll.deadline) : 'TBD'

        // Generate a single-use token for this approval round
        const approvalToken = await createApprovalToken(id)
        const appUrl = process.env.NEXTAUTH_URL?.replace('http://localhost:3000', 'https://pollsdashboard.vercel.app') ?? 'https://pollsdashboard.vercel.app'
        const approveUrl = `${appUrl}/approve/${approvalToken}`
        const editUrl = `${appUrl}/approve/${approvalToken}?mode=edit`
        const feedbackUrl = `${appUrl}/approve/${approvalToken}?mode=feedback`
        const rejectUrl = `${appUrl}/approve/${approvalToken}?mode=reject`

        const approvalHtml = buildApprovalEmailHtml({
          topic: poll.topic,
          department: poll.department,
          emailBody: poll.draft_email_body,
          questions,
          msFormLink: poll.ms_form_link,
          deadline,
          approveUrl,
          editUrl,
          feedbackUrl,
          rejectUrl,
          isKGT: poll.request_type === 'KGT',
        })

        const recipients = Array.isArray(body.recipients) && (body.recipients as string[]).length > 0
          ? (body.recipients as string[])
          : [poll.requested_by]

        const approvalAttachments = Array.isArray(body.attachments)
          ? (body.attachments as PollAttachment[])
          : []

        if (approvalAttachments.length > 0) {
          const sizeError = validateAttachmentSizes(approvalAttachments)
          if (sizeError) return NextResponse.json({ error: sizeError }, { status: 400 })
        }

        // Persist the attachments so they survive through to release (and a page
        // refresh / approval from another device). Only overwrite when files were
        // actually supplied — re-sending for approval without re-picking files must
        // not wipe previously stored attachments.
        if (approvalAttachments.length > 0) {
          await replacePollAttachments(id, approvalAttachments)
        }

        const pollSubject = poll.subject ?? (poll.department && poll.department !== 'All Departments' ? `Poll of ${poll.department} – ${poll.topic}` : `Poll – ${poll.topic}`)
        // KGT requests already carry their own "KGT Opportunity – <topic>" subject —
        // the "Poll Approval Required:" prefix only applies to regular polls.
        const approvalSubject = poll.request_type === 'KGT' ? pollSubject : `Poll Approval Required: ${pollSubject}`
        await sendEmail({
          from: process.env.PRIYA_EMAIL!,
          to: recipients,
          subject: approvalSubject,
          htmlBody: approvalHtml,
          ...(approvalAttachments.length > 0 && { attachments: approvalAttachments }),
        })

        await updatePollStatus(id, 'AWAITING_APPROVAL')
        await createAuditLog(id, 'SENT_FOR_APPROVAL', userEmail, { token: approvalToken })
        break
      }

      case 'APPROVE': {
        if (poll.status !== 'AWAITING_APPROVAL') {
          return NextResponse.json({ error: `Cannot approve a poll in ${poll.status} status.` }, { status: 409 })
        }
        await createApproval(id, 'approved', body.notes as string, userEmail)
        await updatePollStatus(id, 'APPROVED', { approved_at: new Date().toISOString() })
        await createAuditLog(id, 'POLL_APPROVED', userEmail, { notes: body.notes })
        break
      }

      case 'RELEASE_POLL': {
        // SCHEDULED is allowed too, so a scheduled poll can be released early
        // ("Release Now") ahead of its scheduled date — it falls back to the
        // recipients/attachments already stored when it was scheduled.
        if (!['APPROVED', 'SCHEDULED'].includes(poll.status)) {
          return NextResponse.json({ error: `Cannot release a poll in ${poll.status} status — a double-click or retry after this poll already released would otherwise re-send to every recipient.` }, { status: 409 })
        }
        const allEmails = Array.isArray(body.allEmails) && body.allEmails.length > 0
          ? body.allEmails as string[]
          : (poll.scheduled_release_emails ? JSON.parse(poll.scheduled_release_emails) as string[] : [])
        if (!allEmails?.length) {
          return NextResponse.json({ error: 'Select at least one recipient.' }, { status: 400 })
        }
        if (!poll.ms_form_link) {
          return NextResponse.json({ error: 'Poll form not created yet.' }, { status: 400 })
        }
        if (!poll.draft_email_body) {
          return NextResponse.json({ error: 'No draft email body.' }, { status: 400 })
        }

        // Newly uploaded files from the release dialog (base64).
        const newAttachments = Array.isArray(body.attachments)
          ? (body.attachments as PollAttachment[])
          : []

        // Attachments stored at approval (or scheduling) time. The client sends
        // only the names the user explicitly removed in the release dialog, so
        // the safe default — no list, or a failed metadata load on the client —
        // keeps everything stored.
        const stored = await getPollAttachments(id)
        const removeNames = Array.isArray(body.removeAttachmentNames)
          ? new Set(body.removeAttachmentNames as string[])
          : new Set<string>()
        const keptStored = stored.filter((a) => !removeNames.has(a.name))

        // New uploads win on a name clash.
        const newNames = new Set(newAttachments.map((a) => a.name))
        const releaseAttachments: PollAttachment[] = [
          ...keptStored.filter((a) => !newNames.has(a.name)),
          ...newAttachments,
        ]

        const releaseSizeError = validateAttachmentSizes(releaseAttachments)
        if (releaseSizeError) return NextResponse.json({ error: releaseSizeError }, { status: 400 })

        await releasePollNow(poll, id, allEmails, releaseAttachments, userEmail)
        break
      }

      // Schedules a one-time poll to auto-release on a future date, without
      // making it part of the recurring Cadence system — same poll, same
      // approval flow, it just waits for the scheduled-poll-release cron to
      // send it instead of sending immediately.
      case 'SCHEDULE_RELEASE': {
        if (poll.status !== 'APPROVED') {
          return NextResponse.json({ error: `Cannot schedule a poll in ${poll.status} status.` }, { status: 409 })
        }
        const scheduledReleaseAt = body.scheduled_release_at as string
        if (!scheduledReleaseAt) {
          return NextResponse.json({ error: 'scheduled_release_at is required.' }, { status: 400 })
        }
        const scheduledDate = new Date(scheduledReleaseAt)
        if (isNaN(scheduledDate.getTime())) {
          return NextResponse.json({ error: 'Invalid date.' }, { status: 400 })
        }
        if (toISTDateStr(scheduledDate) <= toISTDateStr(new Date())) {
          return NextResponse.json({ error: 'Scheduled date must be in the future.' }, { status: 400 })
        }

        const scheduleEmails = body.allEmails as string[]
        if (!scheduleEmails?.length) {
          return NextResponse.json({ error: 'Select at least one recipient.' }, { status: 400 })
        }
        if (!poll.ms_form_link) {
          return NextResponse.json({ error: 'Poll form not created yet.' }, { status: 400 })
        }
        if (!poll.draft_email_body) {
          return NextResponse.json({ error: 'No draft email body.' }, { status: 400 })
        }

        const scheduleNewAttachments = Array.isArray(body.attachments)
          ? (body.attachments as PollAttachment[])
          : []
        const scheduleStored = await getPollAttachments(id)
        const scheduleRemoveNames = Array.isArray(body.removeAttachmentNames)
          ? new Set(body.removeAttachmentNames as string[])
          : new Set<string>()
        const scheduleKeptStored = scheduleStored.filter((a) => !scheduleRemoveNames.has(a.name))
        const scheduleNewNames = new Set(scheduleNewAttachments.map((a) => a.name))
        const scheduledAttachments: PollAttachment[] = [
          ...scheduleKeptStored.filter((a) => !scheduleNewNames.has(a.name)),
          ...scheduleNewAttachments,
        ]
        const scheduleSizeError = validateAttachmentSizes(scheduledAttachments)
        if (scheduleSizeError) return NextResponse.json({ error: scheduleSizeError }, { status: 400 })

        await replacePollAttachments(id, scheduledAttachments)
        await updatePoll(id, {
          scheduled_release_at: scheduledDate.toISOString(),
          scheduled_release_emails: JSON.stringify(scheduleEmails),
        })
        await updatePollStatus(id, 'SCHEDULED')
        await createAuditLog(id, 'POLL_SCHEDULED', userEmail, { scheduled_release_at: scheduledDate.toISOString(), emails: scheduleEmails })
        break
      }

      case 'CANCEL_SCHEDULE': {
        if (poll.status !== 'SCHEDULED') {
          return NextResponse.json({ error: 'Poll is not scheduled.' }, { status: 409 })
        }
        await updatePoll(id, { scheduled_release_at: null, scheduled_release_emails: null })
        await updatePollStatus(id, 'APPROVED')
        await createAuditLog(id, 'SCHEDULE_CANCELLED', userEmail)
        break
      }

      case 'REQUEST_EDIT': {
        await createApproval(id, 'edited', body.notes as string, userEmail)
        await updatePollStatus(id, 'DRAFT')
        await createAuditLog(id, 'EDIT_REQUESTED', userEmail, { notes: body.notes })
        break
      }

      case 'MARK_CLOSED': {
        await updatePollStatus(id, 'CLOSED', { closed_at: new Date().toISOString() })
        await createAuditLog(id, 'POLL_CLOSED', userEmail)
        break
      }

      // Sends the "no action taken" notice to any respondent still without an
      // actionable/not-actionable decision, then marks those entries resolved.
      // Deliberately a separate, explicit action from closing the poll (or
      // sharing results) — staff need a window after results go out to review
      // and act on individual responses before anyone gets an auto-reply
      // saying no action was taken.
      case 'CLOSE_PENDING_RESPONSES': {
        if (!CLOSED_POLL_STATUSES.includes(poll.status)) {
          return NextResponse.json({ error: 'Poll must be closed before closing pending responses.' }, { status: 400 })
        }
        await sendNoActionTakenEmails(id, poll.topic)
        const closedCount = await closeOutUntouchedEntries(id)
        await createAuditLog(id, 'PENDING_RESPONSES_CLOSED', userEmail, { count: closedCount })
        break
      }

      case 'CLOSE_EXTERNAL_REQUEST': {
        const closedAt = new Date()
        await updatePollStatus(id, 'CLOSED', { closed_at: closedAt.toISOString() })
        await createAuditLog(id, 'POLL_CLOSED', userEmail, { notified: true })

        // Extract requester name + email from "Name <email>" or bare "email"
        const nameEmailMatch = poll.requested_by?.match(/^(.+?)\s*<([^>]+)>$/)
        const requesterEmail = nameEmailMatch ? nameEmailMatch[2].trim() : poll.requested_by?.trim()
        const requesterName = nameEmailMatch ? nameEmailMatch[1].trim() : 'there'

        if (requesterEmail && process.env.PRIYA_EMAIL) {
          const closedDateStr = closedAt.toLocaleDateString('en-IN', {
            day: 'numeric', month: 'long', year: 'numeric',
            timeZone: 'Asia/Kolkata',
          })
          const closedTimeStr = closedAt.toLocaleTimeString('en-IN', {
            hour: '2-digit', minute: '2-digit',
            timeZone: 'Asia/Kolkata',
          })

          const closureHtml = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#111827;">
  <div style="background:#6b7280;padding:24px 32px;border-radius:8px 8px 0 0;">
    <h2 style="margin:0;color:#fff;font-size:20px;">Poll Request Closed</h2>
  </div>
  <div style="background:#f9fafb;padding:24px 32px;border-radius:0 0 8px 8px;border:1px solid #e5e7eb;border-top:none;">
    <p style="margin:0 0 16px;font-size:14px;">Hi <strong>${requesterName}</strong>,</p>
    <p style="margin:0 0 16px;font-size:14px;">We wanted to let you know that your poll request has been closed.</p>
    <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:6px;border:1px solid #e5e7eb;margin-bottom:16px;">
      <tr style="background:#f3f4f6;">
        <td style="padding:8px 12px;color:#6b7280;font-size:13px;width:130px;">Topic</td>
        <td style="padding:8px 12px;font-size:13px;font-weight:600;">${poll.topic}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;color:#6b7280;font-size:13px;">Department</td>
        <td style="padding:8px 12px;font-size:13px;">${poll.department}</td>
      </tr>
      <tr style="background:#f3f4f6;">
        <td style="padding:8px 12px;color:#6b7280;font-size:13px;">Status</td>
        <td style="padding:8px 12px;font-size:13px;">Closed</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;color:#6b7280;font-size:13px;">Closed On</td>
        <td style="padding:8px 12px;font-size:13px;">${closedDateStr} at ${closedTimeStr} IST</td>
      </tr>
    </table>
    <p style="margin:0 0 8px;font-size:14px;">If you have any concerns or questions, please feel free to reply to this email and we will be happy to assist.</p>
    <p style="margin:0;font-size:13px;color:#6b7280;">Thank you for your request.</p>
  </div>
</div>`

          await sendEmail({
            from: process.env.POLLS_MAILBOX ?? 'polls@koenig-solutions.com',
            to: requesterEmail,
            cc: process.env.PRIYA_EMAIL,
            subject: `Poll Request Closed: ${poll.topic}`,
            htmlBody: closureHtml,
          })
        }
        break
      }

      case 'REOPEN': {
        await updatePollStatus(id, 'SENT', { closed_at: null })
        await createAuditLog(id, 'POLL_REOPENED', userEmail)
        break
      }

      case 'ARCHIVE': {
        // Record the pre-archive status so unarchiving can restore it instead
        // of always forcing CLOSED regardless of what the poll actually was.
        await updatePollStatus(id, 'ARCHIVED', { archived_from_status: poll.status })
        await createAuditLog(id, 'POLL_ARCHIVED', userEmail, { from_status: poll.status })
        break
      }

      case 'REJECT': {
        await createApproval(id, 'rejected', body.reason as string | undefined, userEmail)
        await updatePollStatus(id, 'DRAFT')
        await createAuditLog(id, 'EDIT_REQUESTED', userEmail, { reason: body.reason as string | undefined })
        break
      }

      case 'REJECT_EXTERNAL_REQUEST': {
        const rejectionReason = body.reason as string
        if (!rejectionReason?.trim()) {
          return NextResponse.json({ error: 'A reason is required to reject an external request.' }, { status: 400 })
        }

        await createApproval(id, 'rejected', rejectionReason, userEmail)
        await updatePollStatus(id, 'DRAFT')
        await createAuditLog(id, 'EDIT_REQUESTED', userEmail, { reason: rejectionReason, notified: true })

        // Extract requester name + email from "Name <email>" or bare "email"
        const reqMatch = poll.requested_by?.match(/^(.+?)\s*<([^>]+)>$/)
        const requesterEmail = reqMatch ? reqMatch[2].trim() : poll.requested_by?.trim()
        const requesterName = reqMatch ? reqMatch[1].trim() : 'there'

        if (requesterEmail && process.env.PRIYA_EMAIL) {
          const rejectionHtml = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#111827;">
  <div style="background:#dc2626;padding:24px 32px;border-radius:8px 8px 0 0;">
    <h2 style="margin:0;color:#fff;font-size:20px;">Poll Request Not Approved</h2>
  </div>
  <div style="background:#f9fafb;padding:24px 32px;border-radius:0 0 8px 8px;border:1px solid #e5e7eb;border-top:none;">
    <p style="margin:0 0 16px;font-size:14px;">Hi <strong>${requesterName}</strong>,</p>
    <p style="margin:0 0 16px;font-size:14px;">We have reviewed your poll request and are unable to proceed with it at this time.</p>
    <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:6px;border:1px solid #e5e7eb;margin-bottom:16px;">
      <tr style="background:#f3f4f6;">
        <td style="padding:8px 12px;color:#6b7280;font-size:13px;width:130px;">Topic</td>
        <td style="padding:8px 12px;font-size:13px;font-weight:600;">${poll.topic}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;color:#6b7280;font-size:13px;">Department</td>
        <td style="padding:8px 12px;font-size:13px;">${poll.department}</td>
      </tr>
      <tr style="background:#f3f4f6;">
        <td style="padding:8px 12px;color:#6b7280;font-size:13px;">Status</td>
        <td style="padding:8px 12px;font-size:13px;">Not Approved</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;color:#6b7280;font-size:13px;vertical-align:top;">Reason</td>
        <td style="padding:8px 12px;font-size:13px;">${rejectionReason}</td>
      </tr>
    </table>
    <p style="margin:0 0 8px;font-size:14px;">If you have any questions or would like to discuss this further, please feel free to reply to this email.</p>
    <p style="margin:0;font-size:13px;color:#6b7280;">Thank you for your understanding.</p>
  </div>
</div>`

          await sendEmail({
            from: process.env.POLLS_MAILBOX ?? 'polls@koenig-solutions.com',
            to: requesterEmail,
            cc: process.env.PRIYA_EMAIL,
            subject: `Poll Request Not Approved: ${poll.topic}`,
            htmlBody: rejectionHtml,
          })
        }
        break
      }

      case 'UPDATE_RESPONSE': {
        await updateResponseActionable(
          id,
          body.is_actionable as boolean,
          body.email_response as string | undefined
        )
        await createAuditLog(id, 'RESPONSE_UPDATED', userEmail)
        break
      }

      case 'UPDATE_ENTRY_ACTIONABLE': {
        const entryIndex = body.entryIndex as number
        const actionable = body.actionable as boolean | null
        const remarks = body.remarks as string | undefined
        const classification = body.classification as string | null | undefined
        const pollResp = await getPollResponse(id)
        if (!pollResp?.response_data) {
          return NextResponse.json({ error: 'No responses found.' }, { status: 400 })
        }
        const entries = JSON.parse(pollResp.response_data) as Record<string, unknown>[]
        if (entryIndex < 0 || entryIndex >= entries.length) {
          return NextResponse.json({ error: 'Invalid entry index.' }, { status: 400 })
        }
        const status = body.status as string | null | undefined
        entries[entryIndex] = {
          ...entries[entryIndex],
          actionable,
          ...(remarks !== undefined ? { remarks } : {}),
          ...(classification !== undefined ? { classification } : {}),
          ...(status !== undefined ? { status } : {}),
        }
        await upsertPollResponse(id, JSON.stringify(entries))
        await createAuditLog(id, 'ENTRY_ACTIONABLE_UPDATED', userEmail, { entryIndex, actionable, remarks, classification, status })
        break
      }

      case 'CREATE_FORM': {
        const appUrl = process.env.NEXTAUTH_URL?.replace('http://localhost:3000', 'https://pollsdashboard.vercel.app') ?? 'https://pollsdashboard.vercel.app'
        const formLink = `${appUrl}/respond/${id}`
        await updatePoll(id, { ms_form_id: id, ms_form_link: formLink })
        await updatePollStatus(id, 'FORM_CREATED')
        await createAuditLog(id, 'FORM_CREATED', userEmail)
        break
      }

      case 'REGENERATE_DRAFT': {
        const section = (body.section as string) ?? 'all'
        const keywords = (body.keywords as string) ?? ''
        const tone = (body.tone as string) ?? 'professional'
        const useKeywords = (body.useKeywords as boolean) ?? true
        const deadline = poll.deadline ? formatDate(poll.deadline) : formatDate(new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString())

        let draft
        try {
          draft = await generateDraftWithGemini({
            topic: poll.topic, department: poll.department, deadline,
            tone, keywords, useKeywords,
          })
        } catch {
          draft = generatePollDraft(
            poll.topic, poll.department, poll.requested_by, deadline,
            undefined, useKeywords ? keywords : '',
            tone as 'professional' | 'friendly' | 'formal' | 'urgent'
          )
        }

        const updates: Partial<Poll> = {}
        if (section === 'email' || section === 'all') {
          updates.draft_email_body = draft.emailBody
          updates.subject = draft.subject
        }
        if (section === 'questions' || section === 'all') {
          updates.questions = JSON.stringify(draft.questions)
        }

        await updatePoll(id, updates)
        await createAuditLog(id, 'DRAFT_REGENERATED', userEmail, { section, tone, keywords, useKeywords })
        break
      }

      case 'UPDATE_DRAFT': {
        const appUrl = process.env.NEXTAUTH_URL?.replace('http://localhost:3000', 'https://pollsdashboard.vercel.app') ?? 'https://pollsdashboard.vercel.app'
        const existingFormLink = poll.ms_form_link ?? `${appUrl}/respond/${id}`
        await updatePoll(id, {
          subject: (body.subject as string) || poll.subject || undefined,
          draft_email_body: body.draft_email_body as string,
          questions: body.questions as string,
          ms_form_link: (body.ms_form_link as string) || existingFormLink,
          ms_form_id: poll.ms_form_id ?? id,
          ...(body.deadline ? { deadline: new Date(body.deadline as string).toISOString() } : {}),
        })
        await createAuditLog(id, 'DRAFT_UPDATED', userEmail)
        break
      }

      case 'UPDATE_QUESTIONS': {
        // Edit poll questions in place without changing status (e.g. fixing
        // questions on an already-approved poll before release — no re-approval).
        await updatePoll(id, { questions: body.questions as string })
        await createAuditLog(id, 'DRAFT_UPDATED', userEmail, { section: 'questions', inPlace: true })
        break
      }

      case 'SET_HAS_FAQ': {
        // Toggles whether the FAQ section is enabled for this poll —
        // independent of the poll's own status/lifecycle.
        await updatePoll(id, { has_faq: body.has_faq ? 1 : 0 })
        await createAuditLog(id, 'FAQ_TOGGLED', userEmail, { has_faq: !!body.has_faq })
        break
      }

      case 'SET_RMS_TASK': {
        await updatePollStatus(id, 'RMS_TASK_CREATED', { rms_task_id: body.rms_task_id as string })
        await createAuditLog(id, 'RMS_TASK_CREATED', userEmail, { rms_task_id: body.rms_task_id })
        break
      }

      case 'SET_RMS_NEWS': {
        if (!CLOSED_POLL_STATUSES.includes(poll.status)) {
          return NextResponse.json({ error: `This poll is still active (${STATUS_LABELS[poll.status]}) — close it and share results before setting a Koenig News ID.` }, { status: 409 })
        }
        await updatePollStatus(id, 'RMS_PUBLISHED', { rms_news_id: body.rms_news_id as string })
        await createAuditLog(id, 'RMS_PUBLISHED', userEmail, { rms_news_id: body.rms_news_id })
        break
      }

      case 'SHARE_RESULTS': {
        if (!CLOSED_POLL_STATUSES.includes(poll.status)) {
          return NextResponse.json({ error: `Cannot share results for a poll in ${poll.status} status — it must be closed first.` }, { status: 409 })
        }
        const shareRecipients = Array.isArray(body.recipients) && (body.recipients as string[]).length > 0
          ? (body.recipients as string[])
          : [process.env.RESULTS_RECIPIENT_EMAIL ?? 'ea@koenig-solutions.com']

        const pollResponse = await getPollResponse(id)
        if (!pollResponse?.response_data) {
          return NextResponse.json({ error: 'No responses available to share.' }, { status: 400 })
        }

        // Build Excel attachment from stored responses
        interface ResponseEntry { respondent?: string; email?: string; submitted_at: string; answers: { question: string; answer: string }[] }
        const entries: ResponseEntry[] = JSON.parse(pollResponse.response_data)
        const rows = entries.map((entry, i) => {
          const row: Record<string, string> = {
            '#': String(i + 1),
            Name: entry.respondent ?? 'Anonymous',
          }
          entry.answers.forEach((a, qi) => {
            row[`Q${qi + 1}: ${a.question}`] = a.answer
          })
          return row
        })
        const headers = Object.keys(rows[0] ?? {})
        const ws = XLSX.utils.aoa_to_sheet([
          [`Poll: ${poll.topic}`],
          [],
          headers,
          ...rows.map(r => headers.map(h => r[h] ?? '')),
        ])
        ws['!cols'] = headers.map((key) => ({
          wch: Math.max(key.length, ...rows.map((r) => String(r[key] ?? '').length)) + 2,
        }))
        const wb = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(wb, ws, 'Responses')
        const xlsxBase64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' }) as string
        const filename = `poll-responses-${poll.topic.slice(0, 30).replace(/\s+/g, '-').toLowerCase()}.xlsx`

        const emailHtml = buildResultsEmailHtml(poll.topic)
        const attachment = { name: filename, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', contentBytes: xlsxBase64 }

        const forwardSourceId = poll.last_reminder_message_id ?? poll.release_message_id
        if (!forwardSourceId) {
          return NextResponse.json({ error: 'No release thread found for this poll. Results can only be shared on the original poll email thread.' }, { status: 400 })
        }

        // Also attach whatever was attached at release time — forwarding the
        // last reminder already carries those along automatically (forwards
        // copy the original message's attachments), but attach them
        // explicitly too so results always include them even if the
        // reminder chain never happened (poll closed same-day as release).
        const releaseAttachments = await getPollAttachments(id)

        await forwardMessageWithHtml(process.env.PRIYA_EMAIL!, forwardSourceId, {
          htmlBody: emailHtml,
          to: shareRecipients,
          cc: standardCC(),
          attachments: [attachment, ...releaseAttachments],
        })

        await updatePollStatus(id, 'RESULTS_SHARED')
        await createAuditLog(id, 'RESULTS_SHARED', userEmail, { recipients: shareRecipients })
        break
      }

      case 'UPLOAD_RESPONSES': {
        const fileBase64 = body.fileBase64 as string
        const fileName = (body.fileName as string) ?? 'responses.xlsx'
        if (!fileBase64) {
          return NextResponse.json({ error: 'No file data provided.' }, { status: 400 })
        }
        const buffer = Buffer.from(fileBase64, 'base64')
        const wb = XLSX.read(buffer, { type: 'buffer' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: '' })
        if (rows.length === 0) {
          return NextResponse.json({ error: 'No data rows found in the file.' }, { status: 400 })
        }
        const uploadedEntries = rows.map(row => {
          const keys = Object.keys(row)
          const emailKey = keys.find(k => k.toLowerCase() === 'email') ?? ''
          const nameKey = keys.find(k => ['name', 'respondent'].includes(k.toLowerCase())) ?? ''
          const dateKey = keys.find(k => ['submitted at', 'submitted_at', 'date', 'timestamp'].includes(k.toLowerCase())) ?? ''
          const skipSet = new Set(['#', emailKey, nameKey, dateKey].filter(Boolean))
          const email = (row[emailKey] ?? '').toString().trim().toLowerCase()
          const respondent = (row[nameKey] ?? email.split('@')[0].split('.').map((p: string) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ')).toString().trim()
          const rawDate = dateKey ? row[dateKey] : ''
          const submitted_at = rawDate ? (() => { try { return new Date(rawDate).toISOString() } catch { return new Date().toISOString() } })() : new Date().toISOString()
          const answers: { question: string; answer: string }[] = Object.entries(row)
            .filter(([k]) => !skipSet.has(k))
            .map(([k, v]) => ({ question: k.replace(/^Q\d+:\s*/i, '').trim(), answer: String(v ?? '').trim() }))
          return { email, respondent, submitted_at, answers }
        }).filter(e => e.answers.length > 0)
        if (uploadedEntries.length === 0) {
          return NextResponse.json({ error: 'No valid rows found in the file.' }, { status: 400 })
        }

        // Merge with whatever responses already exist (e.g. from the public
        // form) instead of overwriting — a prior overwrite here silently
        // discarded every response collected before this upload.
        interface StoredEntry { email?: string; respondent?: string; submitted_at: string; answers: { question: string; answer: string }[] }
        const existingResp = await getPollResponse(id)
        const existingEntries: StoredEntry[] = existingResp?.response_data ? JSON.parse(existingResp.response_data) : []
        const uploadedEmails = new Set(uploadedEntries.map(e => e.email).filter(Boolean))
        const entries = [...existingEntries.filter(e => !e.email || !uploadedEmails.has(e.email)), ...uploadedEntries]

        await upsertPollResponse(id, JSON.stringify(entries))
        await createAuditLog(id, 'RESPONSES_UPLOADED', userEmail, { count: uploadedEntries.length, totalAfterMerge: entries.length, fileName })

        // Push results to Koenig News if poll has a news ID
        if (poll.rms_news_id) {
          const outcome = await uploadPollResults(poll.rms_news_id, fileBase64, entries)
          if (!outcome.success) {
            await createAuditLog(id, 'RESULTS_UPLOAD_FAILED', userEmail, { error: outcome.error, step: outcome.step })
            return NextResponse.json({
              warning: `Responses saved but Koenig News upload failed at ${outcome.step}: ${outcome.error}`,
              entriesCount: entries.length,
            })
          }
          await updatePollStatus(id, 'RESULTS_UPLOADED', { results_uploaded_at: new Date().toISOString() })
          await createAuditLog(id, 'RESULTS_UPLOADED', userEmail, {
            newsId: poll.rms_news_id,
            questions: outcome.questionResults?.length,
            totalAnswers: outcome.questionResults?.reduce((s, q) => s + q.answersSubmitted, 0),
          })
          return NextResponse.json({ success: true, entriesCount: entries.length, questionResults: outcome.questionResults })
        }

        break
      }

      case 'UPLOAD_TO_KOENIG': {
        if (!CLOSED_POLL_STATUSES.includes(poll.status)) {
          return NextResponse.json({ error: `This poll is still active (${STATUS_LABELS[poll.status]}) — close it and share results before uploading to Koenig News.` }, { status: 409 })
        }
        if (!poll.rms_news_id) {
          return NextResponse.json({ error: 'This poll has not been pushed to Koenig News yet. Push it first to get a News ID.' }, { status: 400 })
        }
        const koenigResp = await getPollResponse(id)
        if (!koenigResp?.response_data) {
          return NextResponse.json({ error: 'No responses found for this poll. Add responses via Manage first.' }, { status: 400 })
        }
        interface KoenigEntry { email?: string; respondent?: string; submitted_at: string; answers: { question: string; answer: string }[] }
        const koenigEntries: KoenigEntry[] = JSON.parse(koenigResp.response_data)
        if (koenigEntries.length === 0) {
          return NextResponse.json({ error: 'No responses to upload.' }, { status: 400 })
        }

        // Build Excel from stored responses
        const koenigRows = koenigEntries.map((entry, i) => {
          const row: Record<string, string> = {
            '#': String(i + 1),
            'Name': entry.respondent ?? '',
            'Email': entry.email ?? '',
            'Submitted At': new Date(entry.submitted_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
          }
          entry.answers.forEach((a, qi) => { row[`Q${qi + 1}: ${a.question}`] = a.answer })
          return row
        })
        const koenigHeaders = Object.keys(koenigRows[0] ?? {})
        const koenigWs = XLSX.utils.aoa_to_sheet([
          [`Poll: ${poll.topic}`],
          [],
          koenigHeaders,
          ...koenigRows.map(r => koenigHeaders.map(h => r[h] ?? '')),
        ])
        const koenigWb = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(koenigWb, koenigWs, 'Responses')

        // Save to a temp file and pass the path to the API (writable on both local Windows and Vercel)
        const repoDir = process.env.POLLS_REPO_PATH ?? tmpdir()
        mkdirSync(repoDir, { recursive: true })
        const safeSlug = poll.topic.slice(0, 40).replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()
        const repoFileName = `poll-${safeSlug}-${poll.rms_news_id}.xlsx`
        const repoFilePath = join(repoDir, repoFileName)
        const koenigBuffer = XLSX.write(koenigWb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
        writeFileSync(repoFilePath, koenigBuffer)

        const outcome = await uploadPollResults(poll.rms_news_id, repoFilePath, koenigEntries)
        try { unlinkSync(repoFilePath) } catch { /* best-effort cleanup */ }
        if (!outcome.success) {
          await createAuditLog(id, 'RESULTS_UPLOAD_FAILED', userEmail, { error: outcome.error, step: outcome.step })
          return NextResponse.json({ error: `Koenig News upload failed at ${outcome.step}: ${outcome.error}` }, { status: 502 })
        }
        await updatePollStatus(id, 'RESULTS_UPLOADED', { results_uploaded_at: new Date().toISOString() })
        await createAuditLog(id, 'RESULTS_UPLOADED', userEmail, {
          newsId: poll.rms_news_id,
          questions: outcome.questionResults?.length,
          totalAnswers: outcome.questionResults?.reduce((s, q) => s + q.answersSubmitted, 0),
        })
        return NextResponse.json({ success: true, entriesCount: koenigEntries.length, questionResults: outcome.questionResults })
      }

      case 'PUSH_TO_RMS': {
        if (!CLOSED_POLL_STATUSES.includes(poll.status)) {
          return NextResponse.json({ error: `This poll is still active (${STATUS_LABELS[poll.status]}) — close it and share results before pushing to RMS.` }, { status: 409 })
        }
        const pushResp = await getPollResponse(id)
        if (!pushResp?.response_data) {
          return NextResponse.json({ error: 'No responses available to push to RMS.' }, { status: 400 })
        }
        interface RMSEntry { respondent?: string; email?: string; submitted_at: string; answers: { question: string; answer: string }[]; actionable?: boolean | null; classification?: string | null; status?: string | null; remarks?: string; reply_sent_at?: string }
        const rmsEntries: RMSEntry[] = JSON.parse(pushResp.response_data)

        const responsesHtml = buildResponsesHtml(rmsEntries)
        const para = `<p><strong>Topic:</strong> ${poll.topic}</p><p><strong>Department:</strong> ${poll.department}</p><p><strong>Total responses:</strong> ${rmsEntries.length}</p>`

        const kitesResult = await pushPollToKites(poll, { htmlContent: responsesHtml, para })

        if (kitesResult.success) {
          const newsId = kitesResult.newsId ? String(kitesResult.newsId) : null
          await updatePollStatus(id, 'RMS_PUBLISHED', newsId ? { rms_news_id: newsId } : undefined)
          await createAuditLog(id, 'PUSHED_TO_RMS', userEmail, { rms_news_id: newsId, responses: rmsEntries.length })
        } else {
          await updatePollStatus(id, 'RMS_PUBLISH_FAILED')
          await createAuditLog(id, 'RMS_PUSH_FAILED', userEmail, { error: kitesResult.error })
          return NextResponse.json({ error: `Kites API push failed: ${kitesResult.error}` }, { status: 502 })
        }
        break
      }

      case 'REPLY_TO_RESPONDENT': {
        const entryIndex = body.entryIndex as number
        const replyMessage = (body.replyMessage as string)?.trim()
        if (!replyMessage) {
          return NextResponse.json({ error: 'Reply message is required.' }, { status: 400 })
        }
        if (!process.env.PRIYA_EMAIL) {
          return NextResponse.json({ error: 'Email not configured.' }, { status: 500 })
        }
        const pollResp = await getPollResponse(id)
        if (!pollResp?.response_data) {
          return NextResponse.json({ error: 'No responses found.' }, { status: 400 })
        }
        const replyEntries = JSON.parse(pollResp.response_data) as Record<string, unknown>[]
        if (entryIndex < 0 || entryIndex >= replyEntries.length) {
          return NextResponse.json({ error: 'Invalid entry index.' }, { status: 400 })
        }
        const replyEntry = replyEntries[entryIndex] as { email?: string; respondent?: string; answers?: { question: string; answer: string }[] }
        if (!replyEntry.email) {
          return NextResponse.json({ error: 'Respondent email not found.' }, { status: 400 })
        }
        const respondentName = replyEntry.respondent ?? (replyEntry.email.split('@')[0].split('.').map((p: string) => p.charAt(0).toUpperCase() + p.slice(1)).join(' '))
        const answers = (replyEntry.answers ?? []) as { question: string; answer: string }[]
        await sendEmail({
          from: process.env.PRIYA_EMAIL!,
          to: replyEntry.email,
          cc: standardCC(),
          subject: `Re: Your response to "${poll.topic}"`,
          htmlBody: buildReplyToRespondentHtml({ name: respondentName, topic: poll.topic, replyMessage, answers }),
        })
        replyEntries[entryIndex] = { ...replyEntries[entryIndex], reply_message: replyMessage, reply_sent_at: new Date().toISOString() }
        await upsertPollResponse(id, JSON.stringify(replyEntries))
        await createAuditLog(id, 'RESPONDENT_REPLIED', userEmail, { entryIndex, email: replyEntry.email })
        break
      }

      case 'EXTEND_DEADLINE': {
        const newDeadlineStr = body.new_deadline as string
        if (!newDeadlineStr) {
          return NextResponse.json({ error: 'new_deadline is required.' }, { status: 400 })
        }
        const newDeadline = new Date(newDeadlineStr)
        if (isNaN(newDeadline.getTime())) {
          return NextResponse.json({ error: 'Invalid date.' }, { status: 400 })
        }

        const formattedDeadline = formatDate(newDeadline.toISOString())
        await updatePoll(id, { deadline: newDeadline.toISOString() })
        await createAuditLog(id, 'DEADLINE_EXTENDED', userEmail, { new_deadline: newDeadlineStr })

        // Notify audience if the poll has already been released
        const releaseEmails: string[] = poll.release_emails ? JSON.parse(poll.release_emails) : []
        if (releaseEmails.length > 0 && poll.ms_form_link && process.env.PRIYA_EMAIL) {
          const audienceHtml = buildDeadlineExtensionAudienceHtml({
            topic: poll.topic,
            newDeadline: formattedDeadline,
            msFormLink: poll.ms_form_link,
          })
          const pollsMailboxExt = process.env.POLLS_MAILBOX ?? process.env.PRIYA_EMAIL!
          if (poll.release_message_id) {
            await replyToMessageWithHtml(process.env.PRIYA_EMAIL, poll.release_message_id, {
              subject: `Re: ${poll.subject ?? `Poll – ${poll.topic}`}`,
              htmlBody: audienceHtml,
              to: [pollsMailboxExt],
              bcc: releaseEmails,
            })
          } else {
            await sendEmail({
              from: process.env.POLLS_MAILBOX ?? 'polls@koenig-solutions.com',
              to: pollsMailboxExt,
              bcc: releaseEmails,
              subject: poll.subject ?? `Poll – ${poll.topic}`,
              htmlBody: audienceHtml,
            })
          }
        }

        // Notify requester
        const reqMatch = poll.requested_by?.match(/^(.+?)\s*<([^>]+)>$/)
        const requesterEmail = reqMatch ? reqMatch[2].trim() : poll.requested_by?.trim()
        const requesterName = reqMatch ? reqMatch[1].trim() : 'there'
        if (requesterEmail?.includes('@') && process.env.PRIYA_EMAIL) {
          await sendEmail({
            from: process.env.POLLS_MAILBOX ?? 'polls@koenig-solutions.com',
            to: requesterEmail,
            subject: `Deadline Extended: ${poll.topic}`,
            htmlBody: buildDeadlineExtensionRequesterHtml({
              topic: poll.topic,
              newDeadline: formattedDeadline,
              requesterName,
            }),
          })
        }
        break
      }

      case 'SEND_MANUAL_REMINDER': {
        if (!['SENT', 'REMINDER_SENT'].includes(poll.status)) {
          return NextResponse.json({ error: 'Poll is not in an active state.' }, { status: 400 })
        }
        if (!poll.ms_form_link) {
          return NextResponse.json({ error: 'Poll has no form link.' }, { status: 400 })
        }
        if (!poll.release_message_id) {
          return NextResponse.json({ error: 'No release thread found — cannot send threaded reminder.' }, { status: 400 })
        }
        const manualReleaseEmails: string[] = poll.release_emails ? JSON.parse(poll.release_emails) : []
        if (!manualReleaseEmails.length) {
          return NextResponse.json({ error: 'No release recipients found.' }, { status: 400 })
        }
        const manualReminderHtml = buildPollEmailHtml({
          emailBody: `<p>This is a friendly reminder to participate in our poll: <strong>${poll.topic}</strong></p>`,
          msFormLink: poll.ms_form_link,
          deadline: poll.deadline ? formatDate(poll.deadline) : 'today',
        })
        const manualReminderMessageId = await forwardMessageWithHtml(process.env.PRIYA_EMAIL!, poll.release_message_id, {
          htmlBody: manualReminderHtml,
          to: [process.env.POLLS_MAILBOX ?? process.env.PRIYA_EMAIL!],
          bcc: manualReleaseEmails,
        })
        await updatePoll(id, { last_reminder_message_id: manualReminderMessageId })
        await createAuditLog(id, 'MANUAL_REMINDER_SENT', userEmail, { emails: manualReleaseEmails })
        break
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
    }

    const updated = await getPollById(id)
    return NextResponse.json(updated)
  } catch (err) {
    console.error(`Poll action ${action} error:`, err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Action failed' },
      { status: 500 }
    )
  }
}
