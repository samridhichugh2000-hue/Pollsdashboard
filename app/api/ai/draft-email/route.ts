import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { auth } from '@/lib/auth'
import { getDb } from '@/lib/db/client'
import { v4 as uuidv4 } from 'uuid'

const MODEL = 'gpt-4o-mini'
const RATE_LIMIT = 10 // calls per user per hour

async function checkRateLimit(userId: string, type: string): Promise<boolean> {
  const db = getDb()
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const res = await db.execute({
    sql: 'SELECT COUNT(*) as count FROM ai_sessions WHERE user_id = ? AND type = ? AND created_at > ?',
    args: [userId, type, since],
  })
  const count = Number((res.rows[0] as unknown as { count: number }).count ?? 0)
  return count < RATE_LIMIT
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = session.user.email

  const allowed = await checkRateLimit(userId, 'email')
  if (!allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded — max 10 AI drafts per hour' }, { status: 429 })
  }

  const { topic, department, deadline, keywords, tone = 'professional', pollId } = await req.json() as {
    topic: string
    department: string
    deadline: string
    keywords?: string
    tone?: string
    pollId?: string
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'OPENAI_API_KEY not configured' }, { status: 500 })

  const audience = department === 'All Departments' ? 'Team' : `${department} Team`
  const subjectLine = department === 'All Departments' ? `Poll – ${topic}` : `Poll of ${department} – ${topic}`
  const kwLine = keywords?.trim() ? `Keywords to highlight: ${keywords.trim()}` : ''

  const actionLine = tone === 'formal'
    ? `You are requested to submit your response via the below poll by ${deadline}.`
    : tone === 'urgent'
      ? `This is time-sensitive — request you to share your inputs via the below poll by ${deadline} without delay.`
      : `Request you to share your inputs via the below poll by ${deadline}.`

  const prompt = `You are an HR communications professional at Koenig Solutions, an IT training company in India.
Generate a concise poll email body in the Koenig Solutions HR house style.

Topic: ${topic}
Audience: ${audience}
Department: ${department}
Response Deadline: ${deadline}
Tone: ${tone}
${kwLine}

EMAIL BODY RULES:
1. Salutation: "Dear ${audience},"
2. Paragraph 1 (1-2 sentences): State specifically what we are assessing and why — no generic filler
3. Paragraph 2 (1 sentence): Action line — "${actionLine}"
4. Paragraph 3 (1 sentence): How this feedback will be used
5. Sign-off: exactly "Warm Regards,\\nTeam HR\\nPoll Dashboard"
6. NO emojis, NO bullet points, NO URLs, NO markdown formatting
7. Indian corporate English — "Request you to", "Kindly", short and direct sentences

Return ONLY valid JSON:
{"subject": "${subjectLine}", "emailBody": "<full email body>"}`

  const openai = new OpenAI({ apiKey })

  try {
    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      max_tokens: 500,
    })

    const raw = completion.choices[0]?.message?.content ?? '{}'
    let result: { subject: string; emailBody: string }
    try {
      result = JSON.parse(raw) as { subject: string; emailBody: string }
    } catch {
      return NextResponse.json({ error: 'AI returned invalid JSON' }, { status: 500 })
    }

    // Audit trail
    const db = getDb()
    await db.execute({
      sql: 'INSERT INTO ai_sessions (id, user_id, poll_id, type, prompt, generated_content, model_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      args: [uuidv4(), userId, pollId ?? null, 'email', prompt, JSON.stringify(result), MODEL, new Date().toISOString()],
    }).catch(() => { /* non-blocking */ })

    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'AI request failed' }, { status: 500 })
  }
}
