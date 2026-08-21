import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { getRecentKGTEmails, markEmailAsRead } from '@/lib/graph'
import { createPoll, updatePoll, pollEmailAlreadyProcessed, pollTopicAlreadyExists, createAuditLog, getProcessedMessageIds, markMessageProcessed } from '@/lib/db/queries'
import { getDb } from '@/lib/db/client'
import { runMigrations } from '@/lib/db/schema'
import { generateDefaultKGTDraft } from '@/lib/kgt-draft-generator'

async function getAuthorizedKGTEmails(): Promise<Set<string>> {
  const result = await getDb().execute('SELECT email FROM kgt_authorized_senders')
  return new Set(result.rows.map((r) => (r.email as string).toLowerCase()))
}

// POST — manually trigger KGT inbox reader (requires active session)
export async function POST() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await runMigrations()
  const priyaEmail = process.env.PRIYA_EMAIL!
  let processed = 0
  let skipped = 0

  try {
    const AUTHORIZED_EMAILS = await getAuthorizedKGTEmails()
    const candidates = await getRecentKGTEmails(priyaEmail, AUTHORIZED_EMAILS)
    const processedIds = await getProcessedMessageIds('kgt', candidates.map(m => m.id))
    const messages = candidates.filter(m => !processedIds.has(m.id))

    for (const msg of messages) {
      const senderEmail = msg.from.emailAddress.address.toLowerCase()

      const alreadyProcessed = await pollEmailAlreadyProcessed(msg.conversationId)
      if (alreadyProcessed) { skipped++; await markMessageProcessed('kgt', msg.id); await markEmailAsRead(priyaEmail, msg.id); continue }

      const topic = msg.subject.replace(/^(fw|fwd|re|tr):\s*/gi, '').replace(/^(fw|fwd|re|tr):\s*/gi, '').trim()

      if (await pollTopicAlreadyExists(topic)) { skipped++; await markMessageProcessed('kgt', msg.id); await markEmailAsRead(priyaEmail, msg.id); continue }

      const poll = await createPoll({
        topic,
        department: 'All Departments',
        requested_by: msg.from.emailAddress.address,
        source: 'email',
        email_thread_id: msg.conversationId,
        request_type: 'KGT',
      })

      const emailText = msg.body.content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
      const draft = generateDefaultKGTDraft(topic, emailText || undefined)

      await updatePoll(poll.id, {
        draft_email_body: draft.emailBody,
        subject: draft.subject,
        questions: JSON.stringify(draft.questions),
        status: 'DRAFT',
      })

      await markMessageProcessed('kgt', msg.id)
      await markEmailAsRead(priyaEmail, msg.id)
      await createAuditLog(poll.id, 'DETECTED_FROM_INBOX_KGT', 'manual-sync', {
        sender: senderEmail, subject: msg.subject,
      })

      processed++
    }

    return NextResponse.json({ processed, skipped })
  } catch (err) {
    console.error('KGT inbox sync error:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Sync failed' }, { status: 500 })
  }
}
