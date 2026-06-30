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
    return { success: false, error: 'Kites API credentials not configured (KITES_API_KEY / KITES_USERNAME / KITES_PASSWORD / KITES_ROLE)' }
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

  const sendFrom = `${process.env.POLLS_MAILBOX ?? 'polls@koenig-solutions.com'};`

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
    EmpId: Number(process.env.KITES_EMP_ID ?? 3599),
    CreatedBy: Number(process.env.KITES_CREATED_BY ?? 16384),
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

    const newsId = (data as Record<string, unknown>)?.id
      ?? (data as Record<string, unknown>)?.Id
      ?? (data as Record<string, unknown>)?.newsId

    return { success: true, data, newsId: newsId as string | number | undefined }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Network error' }
  }
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
