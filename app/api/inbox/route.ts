import { NextRequest, NextResponse } from 'next/server'
import { getInboxMessages, markEmailAsRead } from '@/lib/graph'
import { createPoll, updatePoll, pollEmailAlreadyProcessed, createAuditLog } from '@/lib/db/queries'
import { getDb } from '@/lib/db/client'
import { generatePollDraft } from '@/lib/draft-generator'
import { generateDraftWithGemini } from '@/lib/gemini'
import { formatDate } from '@/lib/utils'
import { GoogleGenerativeAI } from '@google/generative-ai'
import type { GraphMessage } from '@/lib/graph'

// Use Gemini to semantically classify which emails are requesting a poll/survey
async function filterPollRelatedEmails(messages: GraphMessage[]): Promise<GraphMessage[]> {
  if (!messages.length) return []

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    // Fallback to keyword matching if Gemini not configured
    const kw = ['poll', 'survey', 'questionnaire', 'feedback form', 'run a poll', 'create a poll']
    return messages.filter(m => {
      const text = `${m.subject} ${m.bodyPreview}`.toLowerCase()
      return kw.some(k => text.includes(k))
    })
  }

  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })

  const emailList = messages.map((m, i) => (
    `[${i}] Subject: ${m.subject}\nFrom: ${m.from.emailAddress.name} <${m.from.emailAddress.address}>\nPreview: ${m.bodyPreview}`
  )).join('\n\n')

  const prompt = `You are an email classifier for an HR team. Review the following emails from Priya's inbox and identify which ones are:
- Requesting to create, run, or conduct a poll, survey, or questionnaire
- Asking for employee feedback via a structured format
- Mentioning sending out a poll or survey to a team or department

Return ONLY a JSON array of the zero-based indices of matching emails. Example: [0, 2, 4]
If none match, return: []
Do not return any explanation — just the JSON array.

Emails:
${emailList}`

  try {
    const result = await model.generateContent(prompt)
    const raw = result.response.text().trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim()
    const indices = JSON.parse(raw) as number[]
    return indices.map(i => messages[i]).filter(Boolean)
  } catch {
    // Fallback to keyword matching on Gemini error
    const kw = ['poll', 'survey', 'questionnaire', 'feedback form']
    return messages.filter(m => {
      const text = `${m.subject} ${m.bodyPreview}`.toLowerCase()
      return kw.some(k => text.includes(k))
    })
  }
}

async function getAuthorizedEmails(): Promise<Set<string>> {
  const result = await getDb().execute('SELECT email FROM authorized_senders')
  return new Set(result.rows.map((r) => (r.email as string).toLowerCase()))
}

// GET — return today's poll-related emails from Priya's inbox (semantic search)
export async function GET() {
  try {
    const priyaEmail = process.env.PRIYA_EMAIL!

    // Build today's start in UTC for the OData filter
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const dateFilter = `receivedDateTime ge ${todayStart.toISOString()}`

    const messages = await getInboxMessages(priyaEmail, dateFilter)
    const filtered = await filterPollRelatedEmails(messages)
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
