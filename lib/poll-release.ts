import { updatePollStatus, createAuditLog, replacePollAttachments } from './db/queries'
import type { PollAttachment } from './db/queries'
import { sendEmailGetId } from './graph'
import { buildPollEmailHtml, formatDate } from './utils'
import type { Poll } from '@/types'

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
  const pollDeadline = poll.deadline ? formatDate(poll.deadline) : 'TBD'
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
