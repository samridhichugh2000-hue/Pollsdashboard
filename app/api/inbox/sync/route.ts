import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { getInboxMessages, getRecentPollEmails, markEmailAsRead, isSystemNotificationEmail } from '@/lib/graph'
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

// POST — manually trigger inbox reader (requires active session)
export async function POST() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await runMigrations()
  const priyaEmail = process.env.PRIYA_EMAIL!
  let processed = 0
  let skipped = 0

  try {
    const AUTHORIZED_EMAILS = await getAuthorizedEmails()

    // First pass: mark all RMS system notification emails as read so they disappear from Outlook
    const allUnread = await getInboxMessages(priyaEmail, 'isRead eq false')
    for (const msg of allUnread) {
      if (isSystemNotificationEmail(msg.subject)) {
        await markEmailAsRead(priyaEmail, msg.id)
        skipped++
      }
    }

    // Clean up existing DB polls that were created from RMS notification emails before this filter was added
    await getDb().execute(`
      UPDATE polls SET status = 'ARCHIVED', updated_at = CURRENT_TIMESTAMP
      WHERE source = 'email'
        AND status IN ('DRAFT', 'DETECTED')
        AND (
          LOWER(topic) LIKE '%acknowledgment of new task%'
          OR LOWER(topic) LIKE '%feedback by user for rms%'
        )
    `)

    // Second pass: process actual poll emails
    const candidates = await getRecentPollEmails(priyaEmail)
    const processedIds = await getProcessedMessageIds('poll', candidates.map(m => m.id))
    const messages = candidates.filter(m => !processedIds.has(m.id))

    for (const msg of messages) {
      const senderEmail = msg.from.emailAddress.address.toLowerCase()

      // Left unprocessed (not marked) so it's reconsidered if authorized later.
      if (!AUTHORIZED_EMAILS.has(senderEmail)) { skipped++; continue }

      const alreadyProcessed = await pollEmailAlreadyProcessed(msg.conversationId)
      if (alreadyProcessed) { skipped++; await markMessageProcessed('poll', msg.id); await markEmailAsRead(priyaEmail, msg.id); continue }

      const emailText = msg.body.content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
      const deptMatch = emailText.match(/(?:department|team|audience)[:\s]+([A-Za-z\s&]+?)(?:\.|,|\n|$)/i)
      const department = deptMatch?.[1]?.trim() ?? 'All Departments'
      const topic = msg.subject.replace(/^(fw|fwd|re|tr):\s*/gi, '').replace(/^(fw|fwd|re|tr):\s*/gi, '').trim()

      // Dedup by topic — catches forwarded duplicates with a different conversationId
      if (await pollTopicAlreadyExists(topic)) { skipped++; await markMessageProcessed('poll', msg.id); await markEmailAsRead(priyaEmail, msg.id); continue }

      const poll = await createPoll({
        topic, department,
        requested_by: msg.from.emailAddress.address,
        source: 'email',
        email_thread_id: msg.conversationId,
      })

      const deadline = formatDate(new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString())
      let draft
      try { draft = await generateDraftWithGemini({ topic, department, deadline }) }
      catch { draft = generatePollDraft(topic, department, msg.from.emailAddress.name, deadline) }

      const appUrl = process.env.NEXTAUTH_URL?.replace('http://localhost:3000', 'https://pollsdashboard.vercel.app') ?? 'https://pollsdashboard.vercel.app'
      await updatePoll(poll.id, {
        draft_email_body: draft.emailBody,
        subject: draft.subject,
        questions: JSON.stringify(draft.questions),
        ms_form_id: poll.id,
        ms_form_link: `${appUrl}/respond/${poll.id}`,
        status: 'DRAFT',
      })

      await markMessageProcessed('poll', msg.id)
      await markEmailAsRead(priyaEmail, msg.id)
      await createAuditLog(poll.id, 'DETECTED_FROM_INBOX', 'manual-sync', {
        sender: senderEmail, subject: msg.subject,
      })

      processed++
    }

    return NextResponse.json({ processed, skipped })
  } catch (err) {
    console.error('Inbox sync error:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Sync failed' }, { status: 500 })
  }
}
