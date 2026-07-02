import type { Poll } from '@/types'

interface KitesPayload {
  Type: number
  EmpId: number
  CreatedBy: number
  Subject: string
  NewsURL: string
  HtmlContent: string
  SendTo: string | null
  BCCEmailid: string
  SendFrom: string
  Para: string
}

export interface KitesResult {
  success: boolean
  newsId?: string | number
  data?: unknown
  error?: string
}

type PollFields = Pick<Poll,
  'topic' | 'subject' | 'draft_email_body' | 'ms_form_link' |
  'release_emails' | 'department' | 'requested_by' | 'deadline'
>

const KITES_BASE = 'https://api.koenig-solutions.com'

interface KitesTokenResult {
  accessToken: string
  deviceToken: string
}

async function getKitesToken(username: string, password: string, role: string): Promise<KitesTokenResult> {
  const res = await fetch(`${KITES_BASE}/api/Kites/Operator/GetToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userName: username, userPassword: password, userRole: role }),
  })
  if (!res.ok) throw new Error(`GetToken failed: ${res.status}`)
  const json = await res.json() as { statuscode: number; content: { accessToken: string; deviceToken: string } }
  if (json.statuscode !== 200) throw new Error(`GetToken error: ${json.statuscode}`)
  return { accessToken: json.content.accessToken, deviceToken: json.content.deviceToken }
}

export async function pushPollToKites(
  poll: PollFields,
  options?: { htmlContent?: string; para?: string }
): Promise<KitesResult> {
  const apiKey = process.env.KITES_API_KEY
  const username = process.env.KITES_USERNAME
  const password = process.env.KITES_PASSWORD
  const role = process.env.KITES_ROLE

  if (!apiKey || !username || !password || !role) {
    return { success: false, error: 'Kites API credentials not configured' }
  }

  let accessToken: string, deviceToken: string
  try {
    const tokens = await getKitesToken(username, password, role)
    accessToken = tokens.accessToken
    deviceToken = tokens.deviceToken
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to get Kites token' }
  }

  const url = `${KITES_BASE}/api/Kites/Operator/common?apikey=${encodeURIComponent(apiKey)}&accessToken=${encodeURIComponent(accessToken)}&deviceToken=${encodeURIComponent(deviceToken)}`

  const sendFrom = process.env.PRIYA_EMAIL
    ? `${process.env.PRIYA_EMAIL};`
    : 'Priya.upadhyay@koenig-solutions.com;'

  let sendTo: string | null = null
  if (poll.release_emails) {
    try {
      const emails = JSON.parse(poll.release_emails) as string[]
      sendTo = emails.join(';')
    } catch { /* leave null */ }
  }

  const htmlContent = options?.htmlContent
    ?? poll.draft_email_body
    ?? `<p>Poll: ${poll.topic}</p><p>Department: ${poll.department}</p>`

  const para = options?.para
    ?? `<p>Department: <strong>${poll.department}</strong></p><p>Requested by: ${poll.requested_by}</p>${poll.deadline ? `<p>Deadline: ${poll.deadline}</p>` : ''}`

  const payload: KitesPayload = {
    Type: 1,
    EmpId: Number(process.env.KITES_EMP_ID ?? 3904),
    CreatedBy: Number(process.env.KITES_CREATED_BY ?? 18160),
    Subject: poll.subject || poll.topic,
    NewsURL: poll.ms_form_link ?? '',
    HtmlContent: htmlContent,
    SendTo: sendTo,
    BCCEmailid: '',
    SendFrom: sendFrom,
    Para: para,
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    const text = await res.text()
    let data: unknown
    try { data = JSON.parse(text) } catch { data = text }

    if (!res.ok) {
      return { success: false, error: `Kites API ${res.status}: ${text}` }
    }

    // content is a JSON-encoded string: "[{\"Result\":3798}]"
    let newsId: string | number | undefined
    try {
      const content = (data as Record<string, unknown>)?.content
      const parsed = JSON.parse(typeof content === 'string' ? content : '[]') as { Result?: number }[]
      newsId = parsed[0]?.Result
    } catch { /* no id */ }

    return { success: true, data, newsId }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Network error' }
  }
}

// ─── Phase 2: Insert Poll Results ────────────────────────────────────────────

interface InsertPayload {
  KNewsId: string
  PPTFIle?: string
  Url?: string
  email?: string
  QuestionId?: string
  Type: string
}

interface InsertApiResponse {
  statuscode: number
  message?: string
  content?: unknown
}

async function callInsertPollApi(accessToken: string, deviceToken: string, payload: InsertPayload): Promise<InsertApiResponse> {
  const apiKey = process.env.KITES_INSERT_POLL_API_KEY ?? '212'
  const url = `${KITES_BASE}/api/Kites/Operator/common?apikey=${encodeURIComponent(apiKey)}&accessToken=${encodeURIComponent(accessToken)}&deviceToken=${encodeURIComponent(deviceToken)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Insert Poll API ${res.status}: ${text}`)
  try { return JSON.parse(text) as InsertApiResponse } catch { throw new Error(`Non-JSON response: ${text}`) }
}

function parseInsertContent(content: unknown): Record<string, unknown>[] {
  if (Array.isArray(content)) return content as Record<string, unknown>[]
  if (typeof content === 'string') {
    try { return JSON.parse(content) as Record<string, unknown>[] } catch { return [] }
  }
  return []
}

export interface UploadPollResultsOutcome {
  success: boolean
  error?: string
  step?: string
  questionResults?: { question: string; questionId: number; answersSubmitted: number }[]
}

export async function uploadPollResults(
  newsId: string,
  filePath: string,
  entries: { email?: string; answers: { question: string; answer: string }[] }[],
): Promise<UploadPollResultsOutcome> {
  const username = process.env.KITES_INSERT_POLL_USERNAME
  const password = process.env.KITES_INSERT_POLL_PASSWORD
  const role = process.env.KITES_INSERT_POLL_ROLE
  if (!username || !password || !role) {
    return { success: false, error: 'Insert Poll API credentials not configured', step: 'auth' }
  }

  let accessToken: string, deviceToken: string
  try {
    const tokens = await getKitesToken(username, password, role)
    accessToken = tokens.accessToken
    deviceToken = tokens.deviceToken
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'GetToken failed', step: 'auth' }
  }

  // Type=1 — register repository file path
  try {
    const r1 = await callInsertPollApi(accessToken, deviceToken, { KNewsId: newsId, PPTFIle: filePath, Type: '1' })
    const r1Str = JSON.stringify(r1)
    if (r1.statuscode !== 200 || r1Str.toLowerCase().includes('failed')) {
      return { success: false, error: `Type=1 failed (${r1.statuscode}): ${r1.message ?? r1Str}`, step: 'Type1' }
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Type=1 error', step: 'Type1' }
  }

  // Derive unique ordered questions from first entry
  const questions = entries[0]?.answers.map(a => a.question) ?? []
  const questionResults: { question: string; questionId: number; answersSubmitted: number }[] = []

  for (const question of questions) {
    // Type=2 — register question with sequential QuestionId
    const questionId = questionResults.length + 1
    try {
      const r2 = await callInsertPollApi(accessToken, deviceToken, {
        KNewsId: newsId,
        Url: question,
        QuestionId: String(questionId),
        Type: '2',
      })
      const r2Str = JSON.stringify(r2)
      if (r2.statuscode !== 200 || r2Str.toLowerCase().includes('result file not exist')) {
        return { success: false, error: `Type=2 failed for Q${questionId} "${question}": ${r2.message ?? r2Str}`, step: 'Type2' }
      }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : `Type=2 error for "${question}"`, step: 'Type2' }
    }

    // Type=3 — submit each respondent's answer for this question
    let answersSubmitted = 0
    for (const entry of entries) {
      const answerObj = entry.answers.find(a => a.question === question)
      if (!answerObj) continue
      try {
        const r3 = await callInsertPollApi(accessToken, deviceToken, {
          KNewsId: newsId,
          QuestionId: String(questionId),
          Url: answerObj.answer,
          email: entry.email ?? '',
          Type: '3',
        })
        const r3Str = JSON.stringify(r3)
        if (r3.statuscode !== 200 || r3Str.toLowerCase().includes('question not exist')) {
          return { success: false, error: `Type=3 failed for Q${questionId}, ${entry.email ?? 'unknown'}: ${r3.message ?? r3Str}`, step: 'Type3' }
        }
        answersSubmitted++
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'Type=3 error', step: 'Type3' }
      }
    }

    questionResults.push({ question, questionId, answersSubmitted })
  }

  return { success: true, questionResults }
}

export function buildResponsesHtml(
  entries: {
    respondent?: string
    email?: string
    submitted_at: string
    answers: { question: string; answer: string }[]
    actionable?: boolean | null
    classification?: string | null
    status?: string | null
    remarks?: string
    reply_sent_at?: string
  }[]
): string {
  if (entries.length === 0) return '<p>No responses.</p>'

  const headers = ['#', 'Name', 'Email', 'Submitted At', ...entries[0].answers.map((_, i) => `Q${i + 1}`), 'Actionable', 'Classification', 'Status', 'Replied', 'Remarks']

  const rows = entries.map((e, i) => {
    const cells = [
      i + 1,
      e.respondent ?? 'Anonymous',
      e.email ?? '',
      new Date(e.submitted_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      ...e.answers.map(a => a.answer),
      e.actionable === true ? 'Yes' : e.actionable === false ? 'No' : '',
      e.classification === 'rms' ? 'RMS' : e.classification === 'non_rms' ? 'Non-RMS' : e.classification === 'partial' ? 'Partial' : '',
      e.status === 'wip' ? 'WIP' : e.status === 'completed' ? 'Completed' : '',
      e.reply_sent_at ? 'Yes' : 'No',
      e.remarks ?? '',
    ]
    return `<tr>${cells.map(c => `<td style="padding:6px 10px;border:1px solid #d1d5db;">${c}</td>`).join('')}</tr>`
  })

  return `<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px;width:100%;">
<thead><tr style="background:#f3f4f6;">${headers.map(h => `<th style="padding:6px 10px;border:1px solid #d1d5db;text-align:left;">${h}</th>`).join('')}</tr></thead>
<tbody>${rows.join('')}</tbody>
</table>`
}
