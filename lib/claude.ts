import Anthropic from '@anthropic-ai/sdk'

export interface PollQuestion {
  text: string
  type: 'rating' | 'open_ended'
}

export interface ClaudeDraft {
  subject: string
  emailBody: string
  questions: PollQuestion[]
}

export async function generateDraftWithClaude(params: {
  topic: string
  department: string
  deadline: string
  tone: string
  keywords?: string
  useKeywords: boolean
}): Promise<ClaudeDraft> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey || apiKey === 'PENDING') {
    throw new Error('ANTHROPIC_API_KEY not configured')
  }

  const client = new Anthropic({ apiKey })
  const { topic, department, deadline, tone, keywords, useKeywords } = params

  const audienceLabel = department === 'All Departments' ? 'all employees' : `${department} team`
  const kwLine = useKeywords && keywords?.trim() ? `\nKeywords to highlight: ${keywords.trim()}` : ''

  const prompt = `You are an expert HR communications professional at Koenig Solutions, India. Generate a poll email draft.

Topic: ${topic}
Target Audience: ${audienceLabel}
Response Deadline: ${deadline}
Tone: ${tone}${kwLine}

Return ONLY a valid JSON object with this exact structure (no markdown, no explanation):
{
  "subject": "concise subject line starting with 'Poll:'",
  "emailBody": "full email body text",
  "questions": [
    {"text": "question text (1 = Very Poor, 5 = Excellent)", "type": "rating"},
    {"text": "open ended question text", "type": "open_ended"}
  ]
}

Rules:
- Email body: ${tone} tone, 2-3 short paragraphs, no subject line, sign off as "HR Team, Koenig Solutions"
- Questions: exactly 3-4 questions — 2 rating type (include scale hint in parentheses) and 1-2 open_ended
- Questions must be highly specific and relevant to the topic and audience
- ${useKeywords && keywords?.trim() ? `Naturally weave in these keywords: ${keywords.trim()}` : 'Do not add generic filler content'}
- Return only valid JSON`

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  })

  const content = message.content[0]
  if (content.type !== 'text') throw new Error('Unexpected Claude response type')

  // Strip any accidental markdown fences
  const text = content.text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim()
  const parsed = JSON.parse(text) as ClaudeDraft

  // Validate structure
  if (!parsed.subject || !parsed.emailBody || !Array.isArray(parsed.questions)) {
    throw new Error('Invalid Claude response structure')
  }

  return parsed
}
