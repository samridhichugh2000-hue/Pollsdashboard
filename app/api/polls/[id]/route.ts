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
import { buildApprovalEmailHtml, buildPollEmailHtml, buildResultsEmailHtml, formatDate } from '@/lib/utils'
import { generatePollDraft } from '@/lib/draft-generator'
import { generateDraftWithGemini } from '@/lib/gemini'
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

        const approvalHtml = buildApprovalEmailHtml({
          topic: poll.topic,
          department: poll.department,
          emailBody: poll.draft_email_body,
          questions,
          msFormLink: poll.ms_form_link,
          deadline,
          approveUrl,
          editUrl,
        })

        const recipients = Array.isArray(body.recipients) && (body.recipients as string[]).length > 0
          ? (body.recipients as string[])
          : [poll.requested_by]

        await sendEmail({
          from: process.env.PRIYA_EMAIL!,
          to: recipients,
          subject: poll.subject ?? `Poll Approval Required: ${poll.topic}`,
          htmlBody: approvalHtml,
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

        const pollsMailbox = process.env.POLLS_MAILBOX ?? process.env.PRIYA_EMAIL!
        const releaseMessageId = await sendEmailGetId({
          from: process.env.PRIYA_EMAIL!,
          to: pollsMailbox,
          bcc: allEmails,
          subject: poll.subject ?? `Poll: ${poll.topic}`,
          htmlBody: pollHtml,
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

      case 'ARCHIVE': {
        await updatePollStatus(id, 'ARCHIVED')
        await createAuditLog(id, 'POLL_ARCHIVED', userEmail)
        break
      }

      case 'REJECT': {
        await updatePollStatus(id, 'REJECTED')
        await createAuditLog(id, 'POLL_REJECTED', userEmail, { reason: body.reason as string | undefined })
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
        const pollResp = await getPollResponse(id)
        if (!pollResp?.response_data) {
          return NextResponse.json({ error: 'No responses found.' }, { status: 400 })
        }
        const entries = JSON.parse(pollResp.response_data) as Record<string, unknown>[]
        if (entryIndex < 0 || entryIndex >= entries.length) {
          return NextResponse.json({ error: 'Invalid entry index.' }, { status: 400 })
        }
        entries[entryIndex] = { ...entries[entryIndex], actionable }
        await upsertPollResponse(id, JSON.stringify(entries))
        await createAuditLog(id, 'ENTRY_ACTIONABLE_UPDATED', userEmail, { entryIndex, actionable })
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
            Email: entry.email ?? 'Not provided',
            Name: entry.respondent ?? 'Anonymous',
            'Submitted At': new Date(entry.submitted_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
          }
          entry.answers.forEach((a, qi) => {
            row[`Q${qi + 1}: ${a.question.slice(0, 60)}${a.question.length > 60 ? '...' : ''}`] = a.answer
          })
          return row
        })
        const ws = XLSX.utils.json_to_sheet(rows)
        ws['!cols'] = Object.keys(rows[0] ?? {}).map((key) => ({
          wch: Math.max(key.length, ...rows.map((r) => String(r[key] ?? '').length)) + 2,
        }))
        const wb = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(wb, ws, 'Responses')
        const xlsxBase64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' }) as string
        const filename = `poll-responses-${poll.topic.slice(0, 30).replace(/\s+/g, '-').toLowerCase()}.xlsx`

        const emailHtml = buildResultsEmailHtml(poll.topic)
        const attachment = { name: filename, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', contentBytes: xlsxBase64 }

        if (poll.release_message_id) {
          // Reply on the same thread as the original release email
          await replyToMessageWithHtml(process.env.PRIYA_EMAIL!, poll.release_message_id, {
            subject: `Re: Poll Results: ${poll.topic}`,
            htmlBody: emailHtml,
            to: shareRecipients,
            attachments: [attachment],
          })
        } else {
          // Fallback: fresh email if no release message ID stored
          await sendEmail({
            from: process.env.PRIYA_EMAIL!,
            to: shareRecipients,
            subject: `Poll Results: ${poll.topic}`,
            htmlBody: emailHtml,
            attachments: [attachment],
          })
        }

        await updatePollStatus(id, 'RESULTS_UPLOADED', { results_uploaded_at: new Date().toISOString() })
        await createAuditLog(id, 'RESULTS_SHARED', userEmail, { recipients: shareRecipients })
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
