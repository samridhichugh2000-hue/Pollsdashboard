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
} from '@/lib/db/queries'
import { sendEmail, sendEmailGetId, replyToMessageWithHtml } from '@/lib/graph'
import { buildApprovalEmailHtml, buildPollEmailHtml, buildResultsEmailHtml, buildDeadlineExtensionAudienceHtml, buildDeadlineExtensionRequesterHtml, buildReplyToRespondentHtml, formatDate } from '@/lib/utils'
import { generatePollDraft } from '@/lib/draft-generator'
import { generateDraftWithGemini } from '@/lib/gemini'
import { pushPollToKites, buildResponsesHtml } from '@/lib/kites-api'
import * as XLSX from 'xlsx'
import type { Poll } from '@/types'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const poll = await getPollById(id)
  if (!poll) return NextResponse.json({ error: 'Poll not found' }, { status: 404 })

  const [approvals, auditLogs, response] = await Promise.all([
    getApprovalsByPoll(id),
    getAuditLogsByPoll(id),
    getPollResponse(id),
  ])

  return NextResponse.json({ poll, approvals, auditLogs, response })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const poll = await getPollById(id)
  if (!poll) return NextResponse.json({ error: 'Poll not found' }, { status: 404 })

  const body = await req.json() as Record<string, unknown>
  const { action } = body
  const userEmail = 'priya.upadhyay@koenig-solutions.com'

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
        })

        const recipients = Array.isArray(body.recipients) && (body.recipients as string[]).length > 0
          ? (body.recipients as string[])
          : [poll.requested_by]

        const approvalAttachments = Array.isArray(body.attachments)
          ? (body.attachments as { name: string; contentType: string; contentBytes: string }[])
          : []

        const pollSubject = poll.subject ?? (poll.department && poll.department !== 'All Departments' ? `Poll of ${poll.department} – ${poll.topic}` : `Poll – ${poll.topic}`)
        await sendEmail({
          from: process.env.PRIYA_EMAIL!,
          to: recipients,
          subject: `Poll Approval Required: ${pollSubject}`,
          htmlBody: approvalHtml,
          ...(approvalAttachments.length > 0 && { attachments: approvalAttachments }),
        })

        await updatePollStatus(id, 'AWAITING_APPROVAL')
        await createAuditLog(id, 'SENT_FOR_APPROVAL', userEmail, { token: approvalToken })
        break
      }

      case 'APPROVE': {
        await createApproval(id, 'approved', body.notes as string, userEmail)
        await updatePollStatus(id, 'APPROVED', { approved_at: new Date().toISOString() })
        await createAuditLog(id, 'POLL_APPROVED', userEmail, { notes: body.notes })
        break
      }

      case 'RELEASE_POLL': {
        const allEmails = body.allEmails as string[]
        if (!allEmails?.length) {
          return NextResponse.json({ error: 'Select at least one recipient.' }, { status: 400 })
        }
        if (!poll.ms_form_link) {
          return NextResponse.json({ error: 'Poll form not created yet.' }, { status: 400 })
        }
        if (!poll.draft_email_body) {
          return NextResponse.json({ error: 'No draft email body.' }, { status: 400 })
        }

        const pollDeadline = poll.deadline ? formatDate(poll.deadline) : 'TBD'
        const pollHtml = buildPollEmailHtml({
          emailBody: poll.draft_email_body,
          msFormLink: poll.ms_form_link,
          deadline: pollDeadline,
        })

        const releaseAttachments = Array.isArray(body.attachments)
          ? (body.attachments as { name: string; contentType: string; contentBytes: string }[])
          : []

        const pollsMailbox = process.env.POLLS_MAILBOX ?? process.env.PRIYA_EMAIL!
        const releaseMessageId = await sendEmailGetId({
          from: process.env.PRIYA_EMAIL!,
          to: pollsMailbox,
          bcc: allEmails,
          subject: poll.subject ?? (poll.department && poll.department !== 'All Departments' ? `Poll of ${poll.department} – ${poll.topic}` : `Poll – ${poll.topic}`),
          htmlBody: pollHtml,
          attachments: releaseAttachments,
        })

        await updatePollStatus(id, 'SENT', {
          sent_at: new Date().toISOString(),
          release_emails: JSON.stringify(allEmails),
          release_message_id: releaseMessageId,
        })
        await createAuditLog(id, 'POLL_RELEASED', userEmail, { emails: allEmails })
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
            from: process.env.PRIYA_EMAIL,
            to: requesterEmail,
            cc: process.env.POLLS_MAILBOX ?? 'polls@koenig-solutions.com',
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
        await updatePollStatus(id, 'ARCHIVED')
        await createAuditLog(id, 'POLL_ARCHIVED', userEmail)
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
            from: process.env.PRIYA_EMAIL,
            to: requesterEmail,
            cc: process.env.POLLS_MAILBOX ?? 'polls@koenig-solutions.com',
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

      case 'SET_RMS_TASK': {
        await updatePollStatus(id, 'RMS_TASK_CREATED', { rms_task_id: body.rms_task_id as string })
        await createAuditLog(id, 'RMS_TASK_CREATED', userEmail, { rms_task_id: body.rms_task_id })
        break
      }

      case 'SET_RMS_NEWS': {
        await updatePollStatus(id, 'RMS_PUBLISHED', { rms_news_id: body.rms_news_id as string })
        await createAuditLog(id, 'RMS_PUBLISHED', userEmail, { rms_news_id: body.rms_news_id })
        break
      }

      case 'SHARE_RESULTS': {
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

        if (!poll.release_message_id) {
          return NextResponse.json({ error: 'No release thread found for this poll. Results can only be shared on the original poll email thread.' }, { status: 400 })
        }

        await replyToMessageWithHtml(process.env.PRIYA_EMAIL!, poll.release_message_id, {
          subject: `Re: ${poll.subject ?? `Poll: ${poll.topic}`}`,
          htmlBody: emailHtml,
          to: shareRecipients,
          attachments: [attachment],
        })

        await updatePollStatus(id, 'RESULTS_UPLOADED', { results_uploaded_at: new Date().toISOString() })
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
        const entries = rows.map(row => {
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
        if (entries.length === 0) {
          return NextResponse.json({ error: 'No valid rows found in the file.' }, { status: 400 })
        }
        await upsertPollResponse(id, JSON.stringify(entries))
        await createAuditLog(id, 'RESPONSES_UPLOADED', userEmail, { count: entries.length, fileName })
        break
      }

      case 'PUSH_TO_RMS': {
        const pushResp = await getPollResponse(id)
        if (!pushResp?.response_data) {
          return NextResponse.json({ error: 'No responses available to push to RMS.' }, { status: 400 })
        }
        interface RMSEntry { respondent?: string; email?: string; submitted_at: string; answers: { question: string; answer: string }[]; actionable?: boolean | null; classification?: string | null; status?: string | null; remarks?: string; reply_sent_at?: string }
        const rmsEntries: RMSEntry[] = JSON.parse(pushResp.response_data)
        const rmsRows = rmsEntries.map((entry, i) => {
          const row: Record<string, string> = {
            '#': String(i + 1),
            'Email': entry.email ?? 'Not provided',
            'Name': entry.respondent ?? 'Anonymous',
            'Submitted At': new Date(entry.submitted_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
          }
          entry.answers.forEach((a, qi) => { row[`Q${qi + 1}: ${a.question}`] = a.answer })
          row['Actionable'] = entry.actionable === true ? 'Yes' : entry.actionable === false ? 'No' : ''
          row['Classification'] = entry.classification === 'rms' ? 'RMS' : entry.classification === 'non_rms' ? 'Non-RMS' : entry.classification === 'partial' ? 'Partial' : ''
          row['Status'] = entry.status === 'wip' ? 'WIP' : entry.status === 'completed' ? 'Completed' : ''
          row['Replied'] = entry.reply_sent_at ? 'Yes' : 'No'
          row['Remarks'] = entry.remarks ?? ''
          return row
        })
        const rmsWs = XLSX.utils.json_to_sheet(rmsRows)
        rmsWs['!cols'] = Object.keys(rmsRows[0] ?? {}).map(key => ({ wch: Math.max(key.length, ...rmsRows.map(r => String(r[key] ?? '').length)) + 2 }))
        const rmsWb = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(rmsWb, rmsWs, 'Responses')
        void XLSX.write(rmsWb, { type: 'base64', bookType: 'xlsx' })

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
          from: process.env.PRIYA_EMAIL,
          to: replyEntry.email,
          cc: process.env.POLLS_MAILBOX ?? 'polls@koenig-solutions.com',
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
              from: process.env.PRIYA_EMAIL,
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
            from: process.env.PRIYA_EMAIL,
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
        if (!['SENT', 'REMINDER_SENT', 'RMS_PUBLISHED'].includes(poll.status)) {
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
        await replyToMessageWithHtml(process.env.PRIYA_EMAIL!, poll.release_message_id, {
          subject: `Re: ${poll.subject ?? `Poll: ${poll.topic}`}`,
          htmlBody: manualReminderHtml,
          to: [manualPollsMailbox],
          bcc: manualReleaseEmails,
        })
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
