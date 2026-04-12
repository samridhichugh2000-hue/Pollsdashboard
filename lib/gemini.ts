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
  const audienceLabel = department === 'All Departments' ? 'all employees' : `${department} team`
  const kwLine = useKeywords && keywords?.trim() ? `\nKeywords to highlight: ${keywords.trim()}` : ''

  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({ model: MODEL })

  const prompt = `You are an expert HR communications professional at Koenig Solutions, a leading IT training company in India. Generate a complete poll email draft.

Topic: ${topic}
Target Audience: ${audienceLabel}
Response Deadline: ${deadline}
Tone: ${tone}${kwLine}

Return ONLY a valid JSON object — no markdown fences, no explanation, just the JSON:
{
  "subject": "Poll: <concise subject based on topic>",
  "emailBody": "<full professional email body>",
  "questions": [
    {"text": "<specific question text> (1 = Very Poor, 5 = Excellent)", "type": "rating"},
    {"text": "<specific open ended question>", "type": "open_ended"}
  ]
}

Strict rules:
- Email body: ${tone} tone, 2–3 focused paragraphs, no subject line, sign off "HR Team, Koenig Solutions"
- Exactly 3–4 questions: 2 rating (include scale hint like "(1 = Very Poor, 5 = Excellent)") + 1–2 open_ended
- Questions MUST be highly specific to the topic — zero generic questions
- ${useKeywords && keywords?.trim() ? `Naturally and prominently weave in these keywords: ${keywords.trim()}` : 'Make every question and sentence specific to the exact topic'}
- Context: Koenig Solutions is an IT training company, professional Indian corporate environment
- Return only the JSON object, nothing else`

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
