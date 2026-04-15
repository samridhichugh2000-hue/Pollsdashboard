import { NextResponse } from 'next/server'
import { getDueRegularPolls, updateRegularPoll, createPoll, updatePoll, updatePollStatus, createAuditLog } from '@/lib/db/queries'
import { sendEmailGetId } from '@/lib/graph'
import { buildPollEmailHtml, formatDate } from '@/lib/utils'

function advanceNextRunDate(current: string, frequency: 'monthly' | 'quarterly'): string {
  const date = new Date(current)
  date.setMonth(date.getMonth() + (frequency === 'quarterly' ? 3 : 1))
  return date.toISOString().split('T')[0]
}

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const dueTemplates = await getDueRegularPolls()
  let released = 0
  let failed = 0

  for (const template of dueTemplates) {
    try {
      const appUrl = process.env.NEXTAUTH_URL?.replace('http://localhost:3000', 'https://pollsdashboard.vercel.app') ?? 'https://pollsdashboard.vercel.app'
      const deadline = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
      const recipients: string[] = JSON.parse(template.recipients)

      if (!recipients.length) {
        console.warn(`Regular poll ${template.id} has no recipients — skipping`)
        continue
      }

      // Create a standard poll record (pre-approved, skip approval workflow)
      const poll = await createPoll({
        topic: template.name,
        department: template.department,
        requested_by: 'Regular Poll (Auto)',
        source: 'dashboard',
        questions: JSON.parse(template.questions) as string[],
        deadline,
        remarks: `Auto-released from regular poll template: ${template.name}`,
      })

      const formLink = `${appUrl}/respond/${poll.id}`
      await updatePoll(poll.id, {
        subject: template.subject,
        draft_email_body: template.draft_email_body,
        ms_form_id: poll.id,
        ms_form_link: formLink,
      })

      const pollHtml = buildPollEmailHtml({
        emailBody: template.draft_email_body,
        msFormLink: formLink,
        deadline: formatDate(deadline),
      })

      const pollsMailbox = process.env.POLLS_MAILBOX ?? process.env.PRIYA_EMAIL!
      const releaseMessageId = await sendEmailGetId({
        from: process.env.PRIYA_EMAIL!,
        to: pollsMailbox,
        bcc: recipients,
        subject: template.subject,
        htmlBody: pollHtml,
      })

      await updatePollStatus(poll.id, 'SENT', {
        sent_at: new Date().toISOString(),
        release_emails: JSON.stringify(recipients),
        release_message_id: releaseMessageId,
      })

      await createAuditLog(poll.id, 'POLL_AUTO_RELEASED', 'cron', {
        regular_poll_id: template.id,
        template_name: template.name,
      })

      // Advance template's next run date so it doesn't re-trigger tomorrow
      await updateRegularPoll(template.id, {
        last_run_date: new Date().toISOString().split('T')[0],
        next_run_date: advanceNextRunDate(template.next_run_date, template.frequency),
      })

      released++
    } catch (err) {
      console.error(`Failed to auto-release regular poll ${template.id}:`, err)
      failed++
    }
  }

  return NextResponse.json({ released, failed, total: dueTemplates.length })
}
