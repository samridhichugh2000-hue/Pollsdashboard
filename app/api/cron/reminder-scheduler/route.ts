import { NextResponse } from 'next/server'
import { getPollsByStatus, updatePollStatus, createAuditLog } from '@/lib/db/queries'
import { sendEmail } from '@/lib/graph'
import { buildPollEmailHtml, formatDate, getNextWorkingDay } from '@/lib/utils'
import { isWeekend } from 'date-fns'

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const today = new Date()
  if (isWeekend(today)) {
    return NextResponse.json({ message: 'Weekend — no reminders today', sent: 0 })
  }

  const sentPolls = await getPollsByStatus('SENT')
  let sent = 0

  for (const poll of sentPolls) {
    if (!poll.sent_at || !poll.ms_form_link) continue

    // Check if reminder is due (next working day after send)
    const sendDate = new Date(poll.sent_at)
    const reminderDate = poll.reminder_at ? new Date(poll.reminder_at) : getNextWorkingDay(sendDate)

    if (today < reminderDate) continue

    // Must have stored release recipients — skip polls released before this feature
    const releaseEmails: string[] = poll.release_emails ? JSON.parse(poll.release_emails) : []
    if (!releaseEmails.length) {
      console.warn(`Poll ${poll.id} has no stored release_emails — skipping reminder`)
      continue
    }

    try {
      const deadline = poll.deadline ? formatDate(poll.deadline) : 'today'
      const htmlBody = buildPollEmailHtml({
        emailBody: `<p>This is a friendly reminder to participate in our poll: <strong>${poll.topic}</strong></p>`,
        msFormLink: poll.ms_form_link,
        deadline,
      })

      await sendEmail({
        from: process.env.PRIYA_EMAIL!,
        to: releaseEmails,
        subject: `Reminder: ${poll.topic} — Poll Closing Soon`,
        htmlBody,
      })

      await updatePollStatus(poll.id, 'REMINDER_SENT', {
        reminder_sent_at: new Date().toISOString(),
      })

      await createAuditLog(poll.id, 'REMINDER_SENT', 'cron', { emails: releaseEmails })
      sent++
    } catch (err) {
      console.error(`Failed to send reminder for poll ${poll.id}:`, err)
    }
  }

  return NextResponse.json({ sent })
}
