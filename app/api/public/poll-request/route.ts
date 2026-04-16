import { NextRequest, NextResponse } from 'next/server'
import { createPoll, updatePoll, createRegularPoll } from '@/lib/db/queries'
import { generatePollDraft } from '@/lib/draft-generator'
import { generateDraftWithGemini } from '@/lib/gemini'
import { formatDate } from '@/lib/utils'
import { sendEmail } from '@/lib/graph'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      requester_name: string
      requester_email: string
      topic: string
      department: string
      questions?: string[]
      context?: string
      single_response?: boolean
      deadline?: string
      audience_emails?: string[]
      attachments?: { name: string; contentType: string; contentBytes: string }[]
      is_frequent?: boolean
      frequency?: 'monthly' | 'quarterly'
      frequency_start_date?: string
    }

    const { requester_name, requester_email, topic, department } = body

    if (!requester_name?.trim() || !requester_email?.trim() || !topic?.trim() || !department?.trim()) {
      return NextResponse.json({ error: 'Name, email, topic and department are required.' }, { status: 400 })
    }

    // Build remarks: combine context + frequency info
    const remarkParts: string[] = []
    if (body.context?.trim()) remarkParts.push(body.context.trim())
    if (body.is_frequent && body.frequency) {
      const startLabel = body.frequency_start_date
        ? new Date(body.frequency_start_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
        : 'TBD'
      remarkParts.push(`[Recurring: ${body.frequency === 'monthly' ? 'Monthly' : 'Quarterly'} — starting ${startLabel}]`)
    }
    const remarks = remarkParts.join('\n\n') || undefined

    const deadline = body.deadline
      ? formatDate(body.deadline)
      : formatDate(new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString())

    const poll = await createPoll({
      topic: topic.trim(),
      department: department.trim(),
      requested_by: `${requester_name.trim()} <${requester_email.trim()}>`,
      source: 'external',
      questions: body.questions?.filter(q => q.trim()) ?? [],
      remarks,
      single_response: body.single_response !== false,
    })

    let draft
    try {
      draft = await generateDraftWithGemini({ topic: poll.topic, department: poll.department, deadline })
    } catch {
      draft = generatePollDraft(
        poll.topic,
        poll.department,
        requester_name,
        deadline,
        body.questions?.filter(q => q.trim())
      )
    }

    const appUrl = process.env.NEXTAUTH_URL?.replace('http://localhost:3000', 'https://pollsdashboard.vercel.app') ?? 'https://pollsdashboard.vercel.app'
    const formLink = `${appUrl}/respond/${poll.id}`

    await updatePoll(poll.id, {
      subject: draft.subject,
      draft_email_body: draft.emailBody,
      questions: JSON.stringify(draft.questions),
      ms_form_id: poll.id,
      ms_form_link: formLink,
      status: 'DRAFT',
    })

    // Auto-create Regular Poll template if the requester marked this as recurring
    if (body.is_frequent && body.frequency && body.frequency_start_date) {
      try {
        const startDate = new Date(body.frequency_start_date)
        const scheduledDay = startDate.getDate()
        const nextRunDate = body.frequency_start_date.split('T')[0] // use start date as first run

        const recipients = body.audience_emails?.length
          ? body.audience_emails
          : [requester_email]

        await createRegularPoll({
          name: topic.trim(),
          description: body.context?.trim() ?? null,
          frequency: body.frequency,
          scheduled_day: scheduledDay,
          department: department.trim(),
          subject: draft.subject,
          draft_email_body: draft.emailBody,
          questions: JSON.stringify(draft.questions),
          recipients: JSON.stringify(recipients),
          ms_form_link: formLink,
          next_run_date: nextRunDate,
          last_run_date: null,
          is_active: 1,
        })
      } catch (err) {
        // Non-fatal — poll record is already created; log for debugging
        console.error('Failed to create regular poll template from external request:', err)
      }
    }

    // Send confirmation email to requester (CC: Priya + Polls mailbox)
    if (process.env.PRIYA_EMAIL) {
      try {
        const frequencyLine = body.is_frequent && body.frequency
          ? `<tr><td style="padding:6px 12px;color:#6b7280;font-size:13px;">Recurring</td><td style="padding:6px 12px;font-size:13px;">${body.frequency === 'monthly' ? 'Monthly' : 'Quarterly'}${body.frequency_start_date ? ` — starting ${new Date(body.frequency_start_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}</td></tr>`
          : ''

        const contextLine = body.context?.trim()
          ? `<tr><td style="padding:6px 12px;color:#6b7280;font-size:13px;">Context</td><td style="padding:6px 12px;font-size:13px;">${body.context.trim()}</td></tr>`
          : ''

        const questionsSection = body.questions?.filter(q => q.trim()).length
          ? `<p style="margin:20px 0 8px;font-weight:600;font-size:14px;">Questions Submitted</p>
<ol style="margin:0;padding-left:20px;font-size:13px;color:#374151;">
  ${body.questions.filter(q => q.trim()).map(q => `<li style="margin-bottom:4px;">${q}</li>`).join('')}
</ol>`
          : ''

        const attachmentNote = body.attachments?.length
          ? `<p style="margin:16px 0 0;font-size:13px;color:#6b7280;">Attachments included: <strong>${body.attachments.map(a => a.name).join(', ')}</strong></p>`
          : ''

        const htmlBody = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#111827;">
  <div style="background:#4f46e5;padding:24px 32px;border-radius:8px 8px 0 0;">
    <h2 style="margin:0;color:#fff;font-size:20px;">Poll Request Received</h2>
  </div>
  <div style="background:#f9fafb;padding:24px 32px;border-radius:0 0 8px 8px;border:1px solid #e5e7eb;border-top:none;">
    <p style="margin:0 0 20px;font-size:14px;">Hi <strong>${requester_name}</strong>,</p>
    <p style="margin:0 0 20px;font-size:14px;">Thank you! Your poll request has been received and is under review. Here is a summary of what was submitted:</p>

    <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:6px;border:1px solid #e5e7eb;margin-bottom:8px;">
      <tr style="background:#f3f4f6;">
        <td style="padding:6px 12px;color:#6b7280;font-size:13px;width:130px;">Topic</td>
        <td style="padding:6px 12px;font-size:13px;font-weight:600;">${topic}</td>
      </tr>
      <tr>
        <td style="padding:6px 12px;color:#6b7280;font-size:13px;">Department</td>
        <td style="padding:6px 12px;font-size:13px;">${department}</td>
      </tr>
      <tr style="background:#f3f4f6;">
        <td style="padding:6px 12px;color:#6b7280;font-size:13px;">Requested By</td>
        <td style="padding:6px 12px;font-size:13px;">${requester_name} &lt;${requester_email}&gt;</td>
      </tr>
      ${contextLine}
      ${frequencyLine}
    </table>

    ${questionsSection}
    ${attachmentNote}

    <p style="margin:24px 0 0;font-size:13px;color:#6b7280;">Our team will review your request and reach out to you shortly. If you have any questions, feel free to reply to this email.</p>
  </div>
</div>
`
        const ccList = [
          process.env.PRIYA_EMAIL,
          process.env.POLLS_MAILBOX ?? 'polls@koenig-solutions.com',
        ].filter(Boolean) as string[]

        await sendEmail({
          from: process.env.PRIYA_EMAIL,
          to: requester_email,
          cc: ccList,
          subject: `Poll Request Received: ${topic}`,
          htmlBody,
          attachments: body.attachments ?? [],
        })
      } catch {
        // Non-fatal — poll record is already created
      }
    }

    return NextResponse.json({ success: true, id: poll.id }, { status: 201 })
  } catch (err) {
    console.error('Public poll request error:', err)
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}
