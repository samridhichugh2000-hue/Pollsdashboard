import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { getUnreadPollEmails, markEmailAsRead } from '@/lib/graph'
import { createPoll, updatePoll, pollEmailAlreadyProcessed, createAuditLog } from '@/lib/db/queries'
import { getDb } from '@/lib/db/client'
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

  const priyaEmail = process.env.PRIYA_EMAIL!
  let processed = 0
  let skipped = 0

  try {
    const AUTHORIZED_EMAILS = await getAuthorizedEmails()
    const messages = await getUnreadPollEmails(priyaEmail)

    for (const msg of messages) {
      const senderEmail = msg.from.emailAddress.address.toLowerCase()

      if (!AUTHORIZED_EMAILS.has(senderEmail)) { skipped++; continue }

      const alreadyProcessed = await pollEmailAlreadyProcessed(msg.conversationId)
      if (alreadyProcessed) { skipped++; await markEmailAsRead(priyaEmail, msg.id); continue }

      const emailText = msg.body.content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
      const deptMatch = emailText.match(/(?:department|team|audience)[:\s]+([A-Za-z\s&]+?)(?:\.|,|\n|$)/i)
      const department = deptMatch?.[1]?.trim() ?? 'All Departments'
      const topic = msg.subject.replace(/^re:\s*/i, '').trim()

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
