import { GoogleGenerativeAI } from '@google/generative-ai'
import type { DraftPollContent, PollQuestion } from './draft-generator'

const MODEL = 'gemini-2.0-flash'

export async function generateDraftWithGemini(params: {
  topic: string
  department: string
  deadline: string
  tone?: string
  keywords?: string
  useKeywords?: boolean
}): Promise<DraftPollContent> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured')

  const { topic, department, deadline, tone = 'professional', keywords, useKeywords = true } = params
  const audience = department === 'All Departments' ? 'Team' : `${department} Team`
  const subjectLine = department === 'All Departments' ? `Poll – ${topic}` : `Poll of ${department} – ${topic}`
  const kwLine = useKeywords && keywords?.trim() ? `Keywords to highlight: ${keywords.trim()}` : ''

  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({ model: MODEL })

  const prompt = `You are an HR communications professional at Koenig Solutions, a leading IT training company in India.
Generate a concise poll email draft in the Koenig Solutions HR house style.

Topic: ${topic}
Audience: ${audience}
Department: ${department}
Response Deadline: ${deadline}
Tone: ${tone}
${kwLine}

SUBJECT: Use exactly — "${subjectLine}"

EMAIL BODY RULES (follow strictly):
1. Salutation: "Dear ${audience},"
2. Paragraph 1 (1–2 sentences): State specifically what we are assessing and why — no generic filler, no "as part of our commitment to" boilerplate
3. Paragraph 2 (1 sentence): Action line — "${tone === 'formal' ? `You are requested to submit your response via the below poll by ${deadline}.` : tone === 'urgent' ? `This is time-sensitive — request you to share your inputs via the below poll by ${deadline} without delay.` : `Request you to share your inputs via the below poll by ${deadline}.`}"
4. Paragraph 3 (1 sentence): Specific outcome — how this feedback will be used
5. Sign-off: exactly "Warm Regards,\\nTeam HR\\nPoll Dashboard"
6. NO emojis, NO bullet points, NO URLs, NO markdown formatting
7. Indian corporate English — "Request you to", "Kindly", short and direct sentences

STYLE REFERENCE (match this brevity and directness):
Subject: Poll of Sales – PLI Accuracy & Timely Payout
Dear Sales Team,

We are conducting a quick poll to ensure that PLI is being calculated correctly and paid on time.

Request you to share your response through the below poll by 13th April 2026.

Thank you.

Warm Regards,
Team HR
Poll Dashboard

QUESTIONS: Generate 3–4 questions highly specific to "${topic}":
- 2 rating questions with scale e.g. "(1 = Very Poor, 5 = Excellent)"
- 1–2 open-ended questions
- Zero generic questions — every question must be specific to the exact topic

Return ONLY valid JSON with no markdown fences:
{
  "subject": "${subjectLine}",
  "emailBody": "<full email body>",
  "questions": [
    {"text": "<question>", "type": "rating"},
    {"text": "<question>", "type": "open_ended"}
  ]
}`

  const result = await model.generateContent(prompt)
  const raw = result.response.text().trim()
  const text = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim()

  const parsed = JSON.parse(text) as { subject: string; emailBody: string; questions: PollQuestion[] }

  if (!parsed.subject || !parsed.emailBody || !Array.isArray(parsed.questions)) {
    throw new Error('Invalid Gemini response structure')
  }

  return {
    subject: parsed.subject,
    emailBody: parsed.emailBody,
    questions: parsed.questions,
  }
}
