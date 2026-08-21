import { NextResponse } from 'next/server'
import { getRecentPollEmails, markEmailAsRead } from '@/lib/graph'
import { createPoll, updatePoll, pollEmailAlreadyProcessed, pollTopicAlreadyExists, createAuditLog, getProcessedMessageIds, markMessageProcessed } from '@/lib/db/queries'
import { getDb } from '@/lib/db/client'
import { runMigrations } from '@/lib/db/schema'
import { generatePollDraft } from '@/lib/draft-generator'
import { generateDraftWithGemini } from '@/lib/gemini'
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

  await runMigrations()
  const priyaEmail = process.env.PRIYA_EMAIL!
  let processed = 0
  let skipped = 0

  try {
    const AUTHORIZED_EMAILS = await getAuthorizedEmails()
    const candidates = await getRecentPollEmails(priyaEmail)
    const processedIds = await getProcessedMessageIds('poll', candidates.map(m => m.id))
    const messages = candidates.filter(m => !processedIds.has(m.id))

    for (const msg of messages) {
      const senderEmail = msg.from.emailAddress.address.toLowerCase()

      // Whitelist check — left unprocessed (not marked) so it's reconsidered
      // if the sender is authorized later.
      if (!AUTHORIZED_EMAILS.has(senderEmail)) {
        skipped++
        continue
      }

      // Dedup by conversation thread
      const alreadyProcessed = await pollEmailAlreadyProcessed(msg.conversationId)
      if (alreadyProcessed) {
        skipped++
        await markMessageProcessed('poll', msg.id)
        await markEmailAsRead(priyaEmail, msg.id)
        continue
      }

      // Extract context from email body
      const emailText = msg.body.content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()

      // Simple department extraction — looks for "department:" or "team:" in body
      const deptMatch = emailText.match(/(?:department|team|audience)[:\s]+([A-Za-z\s&]+?)(?:\.|,|\n|$)/i)
      const department = deptMatch?.[1]?.trim() ?? 'All Departments'

      // Strip all Fw:/Re:/Fwd: prefixes for a clean topic
      const topic = msg.subject.replace(/^(fw|fwd|re|tr):\s*/gi, '').replace(/^(fw|fwd|re|tr):\s*/gi, '').trim()

      // Dedup by topic — catches forwarded duplicates with a different conversationId
      if (await pollTopicAlreadyExists(topic)) {
        skipped++
        await markMessageProcessed('poll', msg.id)
        await markEmailAsRead(priyaEmail, msg.id)
        continue
      }

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
      let draft
      try {
        draft = await generateDraftWithGemini({ topic, department, deadline })
      } catch {
        draft = generatePollDraft(topic, department, msg.from.emailAddress.name, deadline)
      }

      const appUrl = process.env.NEXTAUTH_URL?.replace('http://localhost:3000', 'https://pollsdashboard.vercel.app') ?? 'https://pollsdashboard.vercel.app'
      const formLink = `${appUrl}/respond/${poll.id}`

      await updatePoll(poll.id, {
        draft_email_body: draft.emailBody,
        subject: draft.subject,
        questions: JSON.stringify(draft.questions),
        ms_form_id: poll.id,
        ms_form_link: formLink,
        status: 'DRAFT',
      })

      await markMessageProcessed('poll', msg.id)
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
