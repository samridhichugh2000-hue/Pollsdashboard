import { updatePoll, updatePollStatus, createAuditLog, replacePollAttachments } from './db/queries'
import type { PollAttachment } from './db/queries'
import { sendEmailGetId } from './graph'
import { buildPollEmailHtml, formatDate } from './utils'
import type { Poll } from '@/types'

// Matches the fallback used when a poll is first drafted with no explicit
// deadline (see app/api/public/poll-request/route.ts, app/api/polls/route.ts).
const DEFAULT_DEADLINE_WINDOW_MS = 48 * 60 * 60 * 1000

// Shared by the RELEASE_POLL action (immediate release) and the scheduled
// poll release cron (auto-release on a future date) — both end up sending
// the exact same email and moving the poll to SENT the same way.
export async function releasePollNow(
  poll: Poll,
  id: string,
  allEmails: string[],
  releaseAttachments: PollAttachment[],
  performedBy: string
): Promise<void> {
  // The stored deadline is an absolute date set whenever the poll was drafted
  // (or last edited) — if approval sat for days (or a scheduled release date
  // arrived late), that date can already be in the past by the time the poll
  // actually goes out. Sending a poll that's already "overdue" also breaks
  // the reminder/closure-alert crons downstream, since they key off this same
  // field. Bump it forward here — the one place both release paths funnel
  // through — rather than at approval time, since a scheduled release can
  // still land well after approval.
  let effectiveDeadline = poll.deadline
  const now = Date.now()
  if (!effectiveDeadline || new Date(effectiveDeadline).getTime() <= now) {
    const staleDeadline = effectiveDeadline
    effectiveDeadline = new Date(now + DEFAULT_DEADLINE_WINDOW_MS).toISOString()
    await updatePoll(id, { deadline: effectiveDeadline })
    await createAuditLog(id, 'DEADLINE_AUTO_EXTENDED', performedBy, {
      old_deadline: staleDeadline,
      new_deadline: effectiveDeadline,
    })
  }

  const pollDeadline = formatDate(effectiveDeadline)
  const pollHtml = buildPollEmailHtml({
    emailBody: poll.draft_email_body!,
    msFormLink: poll.ms_form_link!,
    deadline: pollDeadline,
  })

  const pollsMailbox = process.env.POLLS_MAILBOX ?? process.env.PRIYA_EMAIL!
  const releaseMessageId = await sendEmailGetId({
    from: process.env.PRIYA_EMAIL!,
    to: pollsMailbox,
    bcc: allEmails,
    subject: poll.subject ?? (poll.department && poll.department !== 'All Departments' ? `Poll of ${poll.department} – ${poll.topic}` : `Poll – ${poll.topic}`),
    htmlBody: pollHtml,
    attachments: releaseAttachments,
  })

  // Persist the final released set so it reflects what actually went out.
  await replacePollAttachments(id, releaseAttachments)

  await updatePollStatus(id, 'SENT', {
    sent_at: new Date().toISOString(),
    release_emails: JSON.stringify(allEmails),
    release_message_id: releaseMessageId,
  })
  await createAuditLog(id, 'POLL_RELEASED', performedBy, { emails: allEmails })
}
