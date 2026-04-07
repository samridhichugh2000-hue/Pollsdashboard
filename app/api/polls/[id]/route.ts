import { NextRequest, NextResponse } from 'next/server'
import {
  getPollById,
  updatePoll,
  updatePollStatus,
  createApproval,
  createAuditLog,
  getApprovalsByPoll,
  getAuditLogsByPoll,
  getPollResponse,
  updateResponseActionable,
} from '@/lib/db/queries'
import { sendEmail, replyToEmail } from '@/lib/graph'
import { buildApprovalEmailHtml, buildResultsEmailHtml, formatDate } from '@/lib/utils'
import { generatePollDraft } from '@/lib/draft-generator'
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

        const questions: string[] = poll.questions ? JSON.parse(poll.questions) : []
        const deadline = poll.deadline ? formatDate(poll.deadline) : 'TBD'

        const approvalHtml = buildApprovalEmailHtml({
          topic: poll.topic,
          department: poll.department,
          emailBody: poll.draft_email_body,
          questions,
          msFormLink: poll.ms_form_link,
          deadline,
        })

        if (poll.email_thread_id) {
          // Reply in same thread
          await replyToEmail(
            process.env.PRIYA_EMAIL!,
            poll.email_thread_id,
            approvalHtml
          )
        } else {
          // Email the requester
          await sendEmail({
            from: process.env.PRIYA_EMAIL!,
            to: poll.requested_by,
            subject: poll.subject ?? `Poll Approval Required: ${poll.topic}`,
            htmlBody: approvalHtml,
          })
        }

        await updatePollStatus(id, 'AWAITING_APPROVAL')
        await createAuditLog(id, 'SENT_FOR_APPROVAL', userEmail)
        break
      }

      case 'APPROVE': {
        await createApproval(id, 'approved', body.notes as string, userEmail)
        await updatePollStatus(id, 'APPROVED', { approved_at: new Date().toISOString() })
        await createAuditLog(id, 'POLL_APPROVED', userEmail, { notes: body.notes })
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
        if (!['CLOSED', 'RESULTS_UPLOADED'].includes(poll.status)) {
          return NextResponse.json({ error: 'Poll must be CLOSED before archiving.' }, { status: 400 })
        }
        await updatePollStatus(id, 'ARCHIVED')
        await createAuditLog(id, 'POLL_ARCHIVED', userEmail)
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
        const deadline = poll.deadline ? formatDate(poll.deadline) : formatDate(new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString())

        const draft = generatePollDraft(poll.topic, poll.department, poll.requested_by, deadline, undefined, keywords, tone as 'professional' | 'friendly' | 'formal' | 'urgent')

        const updates: Partial<Poll> = {}
        if (section === 'email' || section === 'all') {
          updates.draft_email_body = draft.emailBody
          updates.subject = draft.subject
        }
        if (section === 'questions' || section === 'all') {
          updates.questions = JSON.stringify(draft.questions)
        }

        await updatePoll(id, updates)
        await createAuditLog(id, 'DRAFT_REGENERATED', userEmail, { section, tone, keywords })
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
        const emailHtml = buildResultsEmailHtml(poll.topic)
        await sendEmail({
          from: process.env.POLLS_MAILBOX!,
          to: process.env.RESULTS_RECIPIENT_EMAIL ?? 'ea@koenig-solutions.com',
          subject: `Poll Results: ${poll.topic}`,
          htmlBody: emailHtml,
        })
        await updatePollStatus(id, 'RESULTS_UPLOADED', { results_uploaded_at: new Date().toISOString() })
        await createAuditLog(id, 'RESULTS_SHARED', userEmail)
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
