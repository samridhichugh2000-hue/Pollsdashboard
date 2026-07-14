import { NextResponse } from 'next/server'
import { getDueRegularPolls, updateRegularPoll, claimRegularPollRun, createPoll, updatePoll, updatePollStatus, createAuditLog, getRegularPollAttachments, replacePollAttachments } from '@/lib/db/queries'
import { runMigrations } from '@/lib/db/schema'
import { sendEmailGetId } from '@/lib/graph'
import { buildPollEmailHtml, formatDate, advanceNextRunDate } from '@/lib/utils'

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  await runMigrations()
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

      // Atomically claim this template before creating/sending anything — if
      // two overlapping cron invocations both see the same due template, only
      // one UPDATE actually matches (WHERE next_run_date = the value we just
      // read), so only one of them proceeds to release. The other sees
      // rowsAffected === 0 and skips.
      const newNextRunDate = advanceNextRunDate(template.next_run_date, template.frequency)
      const claimed = await claimRegularPollRun(template.id, template.next_run_date, newNextRunDate)
      if (!claimed) continue

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

      // Use whatever is currently stored against this cadence template — the
      // original attachment if never updated, or the replacement if it was
      // swapped via the "Update Attachment" action before this release fired.
      const attachments = await getRegularPollAttachments(template.id)

      const pollsMailbox = process.env.POLLS_MAILBOX ?? process.env.PRIYA_EMAIL!
      const releaseMessageId = await sendEmailGetId({
        from: process.env.PRIYA_EMAIL!,
        to: pollsMailbox,
        bcc: recipients,
        subject: template.subject,
        htmlBody: pollHtml,
        ...(attachments.length > 0 && { attachments }),
      })

      if (attachments.length > 0) await replacePollAttachments(poll.id, attachments)

      await updatePollStatus(poll.id, 'SENT', {
        sent_at: new Date().toISOString(),
        release_emails: JSON.stringify(recipients),
        release_message_id: releaseMessageId,
      })

      await createAuditLog(poll.id, 'POLL_AUTO_RELEASED', 'cron', {
        regular_poll_id: template.id,
        template_name: template.name,
        attachments: attachments.map(a => a.name),
      })

      // next_run_date was already advanced atomically by claimRegularPollRun()
      // above, before this template was released — only last_run_date remains.
      await updateRegularPoll(template.id, {
        last_run_date: new Date().toISOString().split('T')[0],
      })

      released++
    } catch (err) {
      console.error(`Failed to auto-release regular poll ${template.id}:`, err)
      failed++
    }
  }

  return NextResponse.json({ released, failed, total: dueTemplates.length })
}
