import { NextResponse } from 'next/server'
import { getPollsByStatus, updatePollStatus, createAuditLog } from '@/lib/db/queries'
import { replyToMessageWithHtml } from '@/lib/graph'
import { buildPollEmailHtml, formatDate } from '@/lib/utils'
import { isWeekend } from 'date-fns'

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000

function toISTDateStr(date: Date): string {
  return new Date(date.getTime() + IST_OFFSET_MS).toISOString().split('T')[0]
}

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const today = new Date()
  if (isWeekend(today)) {
    return NextResponse.json({ message: 'Weekend — no closure alerts today', sent: 0 })
  }

  const todayISTDate = toISTDateStr(today)
  let sent = 0

  const reminderSentPolls = await getPollsByStatus('REMINDER_SENT')

  for (const poll of reminderSentPolls) {
    if (!poll.deadline || !poll.ms_form_link || !poll.release_message_id) continue
    if (poll.closure_alert_sent_at) continue
    if (toISTDateStr(new Date(poll.deadline)) !== todayISTDate) continue

    const releaseEmails: string[] = poll.release_emails ? JSON.parse(poll.release_emails) : []
    if (!releaseEmails.length) {
      console.warn(`Poll ${poll.id} has no stored release_emails — skipping closure alert`)
      continue
    }

    try {
      const htmlBody = buildPollEmailHtml({
        emailBody: `<p>This is your <strong>final reminder</strong> — the poll <strong>${poll.topic}</strong> closes today. Please take a moment to share your response in the next few hours.</p>`,
        msFormLink: poll.ms_form_link,
        deadline: formatDate(poll.deadline),
      })

      const priyaEmail = process.env.PRIYA_EMAIL!
      await replyToMessageWithHtml(priyaEmail, poll.release_message_id, {
        subject: `Re: ${poll.subject ?? `Poll: ${poll.topic}`}`,
        htmlBody,
        to: [process.env.POLLS_MAILBOX ?? priyaEmail],
        bcc: releaseEmails,
      })

      await updatePollStatus(poll.id, 'REMINDER_SENT', {
        closure_alert_sent_at: new Date().toISOString(),
      })
      await createAuditLog(poll.id, 'CLOSURE_ALERT_SENT', 'cron', { emails: releaseEmails })
      sent++
    } catch (err) {
      console.error(`Failed to send closure alert for poll ${poll.id}:`, err)
    }
  }

  return NextResponse.json({ sent })
}
