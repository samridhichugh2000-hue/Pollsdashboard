import { NextResponse } from 'next/server'
import { getPollsByStatus, claimReminderSent, claimPollColumn, createAuditLog, updatePoll } from '@/lib/db/queries'
import { forwardMessageWithHtml } from '@/lib/graph'
import { buildPollEmailHtml, formatDate, getNextWorkingDay, toISTDateStr, isISTWeekend } from '@/lib/utils'

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const today = new Date()
  if (isISTWeekend(today)) {
    return NextResponse.json({ message: 'Weekend — no reminders today', sent: 0 })
  }

  const todayISTDate = toISTDateStr(today)

  let sent = 0

  // Snapshot both query results BEFORE any updates so Block 2 never picks up
  // a poll that Block 1 just promoted from SENT → REMINDER_SENT in this same run.
  const [sentPolls, reminderSentPolls] = await Promise.all([
    getPollsByStatus('SENT'),
    getPollsByStatus('REMINDER_SENT'),
  ])

  // ── 1st reminder: next working day after release ──────────────────────────
  {
    for (const poll of sentPolls) {
      if (!poll.sent_at || !poll.ms_form_link) continue

      const sendDate = new Date(poll.sent_at)
      const reminderDate = poll.reminder_at ? new Date(poll.reminder_at) : getNextWorkingDay(sendDate)

      // Compare IST calendar days as strings, not raw Date/setHours — the
      // Vercel runtime's "local" timezone is UTC, so truncating with
      // setHours(0,0,0,0) anchors to UTC midnight and can be up to 5.5 hours
      // off from the true IST calendar day boundary.
      if (toISTDateStr(today) < toISTDateStr(reminderDate)) continue

      const releaseEmails: string[] = poll.release_emails ? JSON.parse(poll.release_emails) : []
      if (!releaseEmails.length) {
        console.warn(`Poll ${poll.id} has no stored release_emails — skipping 1st reminder`)
        continue
      }

      if (!poll.release_message_id) {
        console.warn(`Poll ${poll.id} has no release_message_id — skipping 1st reminder (cannot thread)`)
        continue
      }

      // Atomically claim (SENT -> REMINDER_SENT) before sending — if two
      // overlapping cron invocations reach this poll together, only one
      // UPDATE actually matches (WHERE status = 'SENT'), so only one sends.
      const claimed = await claimReminderSent(poll.id, new Date().toISOString())
      if (!claimed) continue

      try {
        const deadline = poll.deadline ? formatDate(poll.deadline) : 'today'
        const htmlBody = buildPollEmailHtml({
          emailBody: `<p>This is a friendly reminder to participate in our poll: <strong>${poll.topic}</strong></p>`,
          msFormLink: poll.ms_form_link,
          deadline,
        })

        const priyaEmail = process.env.PRIYA_EMAIL!
        const newMessageId = await forwardMessageWithHtml(priyaEmail, poll.release_message_id, {
          htmlBody,
          to: [process.env.POLLS_MAILBOX ?? priyaEmail],
          bcc: releaseEmails,
        })
        await updatePoll(poll.id, { last_reminder_message_id: newMessageId })

        await createAuditLog(poll.id, 'REMINDER_SENT', 'cron', { emails: releaseEmails })
        sent++
      } catch (err) {
        console.error(`Failed to send 1st reminder for poll ${poll.id}:`, err)
      }
    }
  }

  // ── 2nd reminder: deadline day at 8 AM IST ───────────────────────────────
  for (const poll of reminderSentPolls) {
    if (!poll.deadline || !poll.ms_form_link || !poll.release_message_id) continue
    if (poll.second_reminder_sent_at) continue
    if (toISTDateStr(new Date(poll.deadline)) !== todayISTDate) continue

    const releaseEmails: string[] = poll.release_emails ? JSON.parse(poll.release_emails) : []
    if (!releaseEmails.length) {
      console.warn(`Poll ${poll.id} has no stored release_emails — skipping 2nd reminder`)
      continue
    }

    // Atomically claim before sending — see 1st-reminder block above.
    const claimed = await claimPollColumn(poll.id, 'second_reminder_sent_at', new Date().toISOString())
    if (!claimed) continue

    try {
      const htmlBody = buildPollEmailHtml({
        emailBody: `<p>A gentle reminder — today is the <strong>last day</strong> to complete our poll: <strong>${poll.topic}</strong>. Please share your response before end of day.</p>`,
        msFormLink: poll.ms_form_link,
        deadline: formatDate(poll.deadline),
      })

      const priyaEmail2 = process.env.PRIYA_EMAIL!
      const newMessageId2 = await forwardMessageWithHtml(priyaEmail2, poll.release_message_id, {
        htmlBody,
        to: [process.env.POLLS_MAILBOX ?? priyaEmail2],
        bcc: releaseEmails,
      })
      await updatePoll(poll.id, { last_reminder_message_id: newMessageId2 })

      await createAuditLog(poll.id, 'SECOND_REMINDER_SENT', 'cron', { emails: releaseEmails })
      sent++
    } catch (err) {
      console.error(`Failed to send 2nd reminder for poll ${poll.id}:`, err)
    }
  }

  return NextResponse.json({ sent })
}
