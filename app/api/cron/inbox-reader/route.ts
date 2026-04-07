import { NextResponse } from 'next/server'
import { getUnreadPollEmails, markEmailAsRead } from '@/lib/graph'
import { createPoll, updatePoll, pollEmailAlreadyProcessed, createAuditLog } from '@/lib/db/queries'
import { getDb } from '@/lib/db/client'
import { generatePollDraft } from '@/lib/draft-generator'
import { formatDate } from '@/lib/utils'

async function getAuthorizedEmails(): Promise<Set<string>> {
  const result = await getDb().execute('SELECT email FROM authorized_senders')
  return new Set(result.rows.map((r) => (r.email as string).toLowerCase()))
}

export async function GET(req: Request) {
  // Verify cron secret to prevent unauthorized calls
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const priyaEmail = process.env.PRIYA_EMAIL!
  let processed = 0
  let skipped = 0

  try {
    const AUTHORIZED_EMAILS = await getAuthorizedEmails()
    const messages = await getUnreadPollEmails(priyaEmail)

    for (const msg of messages) {
      const senderEmail = msg.from.emailAddress.address.toLowerCase()

      // Whitelist check
      if (!AUTHORIZED_EMAILS.has(senderEmail)) {
        skipped++
        continue
      }

      // Dedup check — don't process same thread twice in 7 days
      const alreadyProcessed = await pollEmailAlreadyProcessed(msg.conversationId)
      if (alreadyProcessed) {
        skipped++
        await markEmailAsRead(priyaEmail, msg.id)
        continue
      }

      // Extract context from email body
      const emailText = msg.body.content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()

      // Simple department extraction — looks for "department:" or "team:" in body
      const deptMatch = emailText.match(/(?:department|team|audience)[:\s]+([A-Za-z\s&]+?)(?:\.|,|\n|$)/i)
      const department = deptMatch?.[1]?.trim() ?? 'All Departments'

      const topic = msg.subject.replace(/^re:\s*/i, '').trim()

      // Create poll record
      const poll = await createPoll({
        topic,
        department,
        requested_by: msg.from.emailAddress.address,
        source: 'email',
        email_thread_id: msg.conversationId,
      })

      // Generate AI draft
      const deadline = formatDate(new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString())
      const draft = generatePollDraft(
        topic,
        department,
        msg.from.emailAddress.name,
        deadline
      )

      await updatePoll(poll.id, {
        draft_email_body: draft.emailBody,
        questions: JSON.stringify(draft.questions),
        status: 'DRAFT',
      })

      await markEmailAsRead(priyaEmail, msg.id)

      await createAuditLog(poll.id, 'DETECTED_FROM_INBOX', 'cron', {
        sender: senderEmail,
        subject: msg.subject,
      })

      processed++
    }

    return NextResponse.json({ processed, skipped, total: messages.length })
  } catch (err) {
    console.error('Inbox reader error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Inbox reader failed' },
      { status: 500 }
    )
  }
}
