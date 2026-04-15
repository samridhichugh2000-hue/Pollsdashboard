import { NextRequest, NextResponse } from 'next/server'
import { getInboxMessages, markEmailAsRead } from '@/lib/graph'
import { createPoll, updatePoll, pollEmailAlreadyProcessed, createAuditLog } from '@/lib/db/queries'
import { getDb } from '@/lib/db/client'
import { generatePollDraft } from '@/lib/draft-generator'
import { generateDraftWithGemini } from '@/lib/gemini'
import { formatDate } from '@/lib/utils'
import type { GraphMessage } from '@/lib/graph'

// Keyword filter — no AI needed; mailbox access is via Microsoft Graph (Azure AD creds)
const POLL_KEYWORDS = ['poll', 'survey', 'questionnaire', 'feedback form', 'rms', 'run a poll', 'create a poll', 'sending a poll']

function filterPollRelatedEmails(messages: GraphMessage[]): GraphMessage[] {
  return messages.filter(m => {
    const text = `${m.subject} ${m.bodyPreview}`.toLowerCase()
    return POLL_KEYWORDS.some(kw => text.includes(kw))
  })
}

async function getAuthorizedEmails(): Promise<Set<string>> {
  const result = await getDb().execute('SELECT email FROM authorized_senders')
  return new Set(result.rows.map((r) => (r.email as string).toLowerCase()))
}

// GET — return today's poll-related emails, classified by Claude
export async function GET() {
  try {
    const priyaEmail = process.env.PRIYA_EMAIL!

    // Midnight UTC → include all emails received today
    const todayStart = new Date()
    todayStart.setUTCHours(0, 0, 0, 0)
    const dateFilter = `receivedDateTime ge ${todayStart.toISOString().replace('.000Z', 'Z')}`

    const messages = await getInboxMessages(priyaEmail, dateFilter)
    const filtered = filterPollRelatedEmails(messages)
    return NextResponse.json(filtered)
  } catch (err) {
    console.error('Inbox fetch error:', err)
    return NextResponse.json({ error: 'Failed to read inbox' }, { status: 500 })
  }
}

// POST — convert a specific email into a poll draft
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      messageId: string
      conversationId: string
      subject: string
      senderEmail: string
      senderName: string
      bodyPreview: string
    }

    const priyaEmail = process.env.PRIYA_EMAIL!
    const AUTHORIZED_EMAILS = await getAuthorizedEmails()

    if (!AUTHORIZED_EMAILS.has(body.senderEmail.toLowerCase())) {
      return NextResponse.json({ error: 'Sender not in authorized list. Add them in Settings → Authorized Senders first.' }, { status: 403 })
    }

    const alreadyProcessed = await pollEmailAlreadyProcessed(body.conversationId)
    if (alreadyProcessed) {
      return NextResponse.json({ error: 'A poll has already been created from this email thread.' }, { status: 409 })
    }

    const topic = body.subject.replace(/^re:\s*/i, '').trim()
    const deptMatch = body.bodyPreview.match(/(?:department|team|audience)[:\s]+([A-Za-z\s&]+?)(?:\.|,|\n|$)/i)
    const department = deptMatch?.[1]?.trim() ?? 'All Departments'

    const poll = await createPoll({
      topic,
      department,
      requested_by: body.senderEmail,
      source: 'email',
      email_thread_id: body.conversationId,
    })

    const deadline = formatDate(new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString())
    let draft
    try {
      draft = await generateDraftWithGemini({ topic, department, deadline })
    } catch {
      draft = generatePollDraft(topic, department, body.senderName, deadline)
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

    await markEmailAsRead(priyaEmail, body.messageId)

    await createAuditLog(poll.id, 'DETECTED_FROM_INBOX', 'dashboard', {
      sender: body.senderEmail,
      subject: body.subject,
    })

    return NextResponse.json({ pollId: poll.id })
  } catch (err) {
    console.error('Inbox convert error:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to create poll' }, { status: 500 })
  }
}
