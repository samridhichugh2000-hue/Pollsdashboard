import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
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
  const userId = req.headers.get('x-user-email') ?? 'anonymous'

  const allowed = await checkRateLimit(userId, 'questions')
  if (!allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded — max 10 AI drafts per hour' }, { status: 429 })
  }

  const { topic, department, keywords, tone = 'professional', pollId } = await req.json() as {
    topic: string
    department: string
    keywords?: string
    tone?: string
    pollId?: string
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'OPENAI_API_KEY not configured' }, { status: 500 })

  const kwLine = keywords?.trim() ? `Keywords to focus on: ${keywords.trim()}` : ''
  const prompt = `You are an HR communications professional at Koenig Solutions, an IT training company in India.
Generate 3-4 poll questions for the following topic. Questions must be highly specific to the exact topic.

Topic: ${topic}
Department: ${department}
Tone: ${tone}
${kwLine}

Rules:
- 2 rating questions with scale e.g. "(1 = Very Poor, 5 = Excellent)"
- 1-2 open-ended questions
- Every question must be specific to the exact topic — no generic filler
- Indian corporate English — direct, concise

Return ONLY valid JSON array:
[{"text": "<question>", "type": "rating"}, {"text": "<question>", "type": "open_ended"}]`

  const openai = new OpenAI({ apiKey })

  try {
    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      max_tokens: 600,
    })

    const raw = completion.choices[0]?.message?.content ?? '{}'
    let questions: { text: string; type: string }[]
    try {
      const parsed = JSON.parse(raw) as { questions?: typeof questions } | typeof questions
      questions = Array.isArray(parsed) ? parsed : (parsed as { questions?: typeof questions }).questions ?? []
    } catch {
      return NextResponse.json({ error: 'AI returned invalid JSON' }, { status: 500 })
    }

    // Audit trail
    const db = getDb()
    await db.execute({
      sql: 'INSERT INTO ai_sessions (id, user_id, poll_id, type, prompt, generated_content, model_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      args: [uuidv4(), userId, pollId ?? null, 'questions', prompt, JSON.stringify(questions), MODEL, new Date().toISOString()],
    }).catch(() => { /* non-blocking */ })

    return NextResponse.json({ questions })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'AI request failed' }, { status: 500 })
  }
}
