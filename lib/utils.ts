import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { format, formatDistanceToNow, addDays } from 'date-fns'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Server errors aren't always JSON — a platform-level failure (e.g. Vercel's
// 413 "Request Entity Too Large" when a request body is too big) returns
// plain text, and calling res.json() on that throws a confusing
// "Unexpected token ... is not valid JSON" instead of the real problem.
// Always route error responses through this instead of `res.json()` directly.
export async function getErrorMessage(res: Response, fallback = 'Request failed'): Promise<string> {
  if (res.status === 413) return 'The request was too large — try attaching smaller or fewer files.'
  let text = ''
  try { text = await res.text() } catch { return `${fallback} (${res.status})` }
  try {
    const json = JSON.parse(text) as { error?: string }
    if (json?.error) return json.error
  } catch { /* not JSON */ }
  return text.trim() ? text.slice(0, 200) : `${fallback} (${res.status})`
}

// SQLite CURRENT_TIMESTAMP stores as "2026-04-30 12:00:00" (no Z) — browsers
// treat that as local time. Append Z so it's always parsed as UTC.
function parseDate(date: string | Date): Date {
  if (date instanceof Date) return date
  if (!date.includes('Z') && !date.includes('+') && !date.includes('-', 10)) {
    return new Date(date.replace(' ', 'T') + 'Z')
  }
  return new Date(date)
}

export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return '—'
  return format(parseDate(date), 'MMM d, yyyy')
}

export function formatDateTime(date: string | Date | null | undefined): string {
  if (!date) return '—'
  return format(parseDate(date), 'MMM d, yyyy h:mm a')
}

export function formatRelative(date: string | Date | null | undefined): string {
  if (!date) return '—'
  return formatDistanceToNow(parseDate(date), { addSuffix: true })
}

// `department` on a poll is a free-text categorization chosen at creation
// time (often just left as "All Departments") — it does not reflect who the
// poll actually went to. The real audience lives in `release_emails` (set
// once the poll is released) or `recipient_email` (set at creation, before
// release). This resolves those email addresses to friendly hunt-group names
// (e.g. "trainers@koenig-solutions.com" -> "Trainers") for display, falling
// back to the raw address's local-part and finally to `department` if no
// audience emails are known yet.
export function deriveAudienceLabel(
  poll: { recipient_email?: string | null; release_emails?: string | null; department?: string | null },
  huntGroupsByEmail: Map<string, string>
): string {
  let emails: string[] = []
  if (poll.release_emails) {
    try { emails = JSON.parse(poll.release_emails) as string[] } catch { /* ignore */ }
  }
  if (emails.length === 0 && poll.recipient_email) {
    emails = poll.recipient_email.split(',').map(e => e.trim()).filter(Boolean)
  }
  if (emails.length === 0) return poll.department || '—'

  const labels = emails.map(email => {
    const lower = email.toLowerCase()
    const groupName = huntGroupsByEmail.get(lower)
    if (groupName) return groupName
    const localPart = lower.split('@')[0]
    return localPart.charAt(0).toUpperCase() + localPart.slice(1)
  })
  return [...new Set(labels)].join(', ')
}

export function buildHuntGroupEmailMap(huntGroups: { name: string; email: string }[]): Map<string, string> {
  return new Map(huntGroups.map(g => [g.email.toLowerCase(), g.name]))
}

// Shared IST-aware date helpers for the cron jobs. Previously each cron file
// (poll-closure, reminder-scheduler, closure-alert) had its own copy of some
// of this math, and some copies used raw server-local time (UTC on Vercel)
// for "is it the weekend" / "which day is today" checks instead of IST —
// meaning a poll's IST calendar day and the cron's notion of "today" could
// differ by up to 5.5 hours around midnight IST. Centralizing here so every
// caller agrees on one definition.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000

export function toISTDateStr(date: Date): string {
  return new Date(date.getTime() + IST_OFFSET_MS).toISOString().split('T')[0]
}

export function isISTWeekend(date: Date): boolean {
  const day = new Date(date.getTime() + IST_OFFSET_MS).getUTCDay()
  return day === 0 || day === 6
}

export function istMinutesOfDay(date: Date): number {
  const ist = new Date(date.getTime() + IST_OFFSET_MS)
  return ist.getUTCHours() * 60 + ist.getUTCMinutes()
}

// Clamp a day-of-month to the actual number of days in that month (handles
// scheduled_day 29-31 landing in a shorter month, e.g. February).
function clampToMonth(year: number, month: number, day: number): Date {
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  return new Date(year, month, Math.min(day, daysInMonth))
}

// Previously each of the 3 call sites (create, edit, and the daily cron) had
// its own copy of "add N months," and none of them clamped day overflow —
// `new Date(y, 1, 31)` silently rolls Feb 31 into Mar 3, so a template
// scheduled for day 29-31 would permanently drift forward every time its
// cycle crossed a shorter month.
export function addMonthsClamped(date: Date, months: number): Date {
  const day = date.getDate()
  const target = new Date(date.getFullYear(), date.getMonth() + months, 1)
  return clampToMonth(target.getFullYear(), target.getMonth(), day)
}

// A scheduled_day landing on a Saturday/Sunday rolls forward to the next
// working day — the release date itself, not just the follow-up reminder.
function rollToWorkingDay(date: Date): Date {
  let d = date
  while (isISTWeekend(d)) {
    d = addDays(d, 1)
  }
  return d
}

export function computeNextRunDate(frequency: string, scheduledDay: number, from: Date = new Date()): string {
  const today = new Date(from)
  today.setHours(0, 0, 0, 0)
  const thisMonthTarget = clampToMonth(today.getFullYear(), today.getMonth(), scheduledDay)
  if (thisMonthTarget >= today) return rollToWorkingDay(thisMonthTarget).toISOString().split('T')[0]
  const months = frequency === 'quarterly' ? 3 : frequency === 'bi-annual' ? 6 : frequency === 'annual' ? 12 : 1
  return rollToWorkingDay(addMonthsClamped(thisMonthTarget, months)).toISOString().split('T')[0]
}

export function advanceNextRunDate(current: string, frequency: string): string {
  const months = frequency === 'quarterly' ? 3 : frequency === 'bi-annual' ? 6 : frequency === 'annual' ? 12 : 1
  return rollToWorkingDay(addMonthsClamped(new Date(current), months)).toISOString().split('T')[0]
}

export function getNextWorkingDay(from: Date = new Date()): Date {
  let next = addDays(from, 1)
  while (isISTWeekend(next)) {
    next = addDays(next, 1)
  }
  return next
}

export function getDeadline(from: Date = new Date()): Date {
  return addDays(from, 2)
}

export function isApprovalOverdue(sentAt: string | null | undefined): boolean {
  if (!sentAt) return false
  const sent = parseDate(sentAt)
  const now = new Date()
  const hoursElapsed = (now.getTime() - sent.getTime()) / (1000 * 60 * 60)
  return hoursElapsed > 24
}

function isHtmlContent(s: string): boolean {
  return /<[a-z][\s\S]*>/i.test(s.trim())
}

// The rich-text editor's contentEditable div produces bare <p>/<div>/<ul>/<li>
// tags with no inline styling. Inside our own app those get tight spacing
// from Tailwind classes on the wrapping container — but that CSS doesn't
// travel with the HTML once it's embedded in an actual outbound email, so
// Outlook/Gmail fall back to their own (much larger) default paragraph
// margins, making a tightly-formatted draft look double- or triple-spaced
// once it lands in someone's inbox. Force the same tight, inline spacing on
// every block element so what the sender sees is what the recipient gets.
// Merge a margin declaration into a tag's existing style attribute (if any)
// instead of appending a second `style="..."` attribute, which would be
// invalid HTML and unreliably parsed by email clients.
function withMargin(attrs: string, marginStyle: string): string {
  const styleMatch = attrs.match(/style\s*=\s*"([^"]*)"/i)
  if (styleMatch) {
    const merged = `${styleMatch[1].replace(/;\s*$/, '')};${marginStyle}`
    return attrs.replace(/style\s*=\s*"[^"]*"/i, `style="${merged}"`)
  }
  return `${attrs} style="${marginStyle}"`
}

function normalizeEmailBodyHtml(html: string): string {
  if (!html) return html
  return html
    .replace(/<(p|div)((?:\s+[^>]*)?)>/gi, (_m, tag: string, attrs: string) => `<${tag}${withMargin(attrs, 'margin:0 0 10px 0;')}>`)
    .replace(/<(ul|ol)((?:\s+[^>]*)?)>/gi, (_m, tag: string, attrs: string) => `<${tag}${withMargin(attrs, 'margin:0 0 10px 0;padding-left:20px;')}>`)
    .replace(/<li((?:\s+[^>]*)?)>/gi, (_m, attrs: string) => `<li${withMargin(attrs, 'margin:0 0 4px 0;')}>`)
}

const URL_RE = /(https?:\/\/[^\s<]+)/gi

// Trim sentence-ending punctuation caught by the greedy URL match (e.g. the
// period after "...visit https://example.com." shouldn't be part of the link).
function splitTrailingPunctuation(url: string): { url: string; trailing: string } {
  const match = url.match(/^(.*[^.,;:!?'")\]])([.,;:!?'")\]]*)$/)
  return match ? { url: match[1], trailing: match[2] } : { url, trailing: '' }
}

// Auto-linkify bare URLs (typed or pasted as plain text) so they render as
// clickable links in the recipient's inbox instead of dead text. Skips
// anything already inside a real <a> tag so existing links are never
// double-wrapped or corrupted.
function linkifyUrls(html: string): string {
  if (!html) return html
  const segments = html.split(/(<a\b[^>]*>[\s\S]*?<\/a>)/gi)
  return segments
    .map(segment => {
      if (/^<a\b/i.test(segment)) return segment
      return segment.replace(URL_RE, (match) => {
        const { url, trailing } = splitTrailingPunctuation(match)
        return `<a href="${url}" target="_blank" rel="noopener noreferrer" style="color:#2563eb;text-decoration:underline;">${url}</a>${trailing}`
      })
    })
    .join('')
}

// The single choke point every outbound email body passes through: turn bare
// URLs into real links, then force tight inline spacing so it survives being
// rendered by whatever mail client the recipient uses.
function prepareEmailBodyHtml(html: string): string {
  return normalizeEmailBodyHtml(linkifyUrls(html))
}

// Plain-text fields (names, topics, question/answer text) get interpolated
// directly into outbound HTML emails below. Escape them so a respondent or
// requester can't inject markup/scripts into an email sent to someone else.
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Strip Word/Outlook clipboard overhead from pasted or stored HTML.
 *  Extracts the StartFragment…EndFragment region when present, then removes
 *  <meta>, <link>, <style> blocks, MSO conditional comments, and Office
 *  namespace tags (o:p, w:*), leaving only the readable content HTML. */
export function sanitizeWordHtml(html: string): string {
  if (!html) return html
  // Extract the clipboard fragment region if Word markers are present
  const startMarker = '<!--StartFragment-->'
  const endMarker = '<!--EndFragment-->'
  const si = html.indexOf(startMarker)
  const ei = html.indexOf(endMarker)
  if (si !== -1 && ei !== -1) html = html.slice(si + startMarker.length, ei)
  return html
    .replace(/<!--\[if[^\]]*\]>[\s\S]*?<!\[endif\]-->/gi, '') // MSO conditionals
    .replace(/<!--[\s\S]*?-->/g, '')                            // remaining comments
    .replace(/<style[\s\S]*?<\/style>/gi, '')                   // style blocks
    .replace(/<meta[^>]*\/?>/gi, '')                            // meta tags
    .replace(/<link[^>]*\/?>/gi, '')                            // link tags
    .replace(/<\/?[ow]:[a-z]+[^>]*>/gi, '')                     // o:p, w:* namespace tags
    .replace(/style="([^"]*)"/gi, (_, styles: string) => {
      const cleaned = styles
        .split(';')
        .filter(s => !/^\s*(background(-color)?|color)\s*:/i.test(s))
        .join(';')
      return cleaned.trim() ? `style="${cleaned}"` : ''
    })
    .trim()
}

/** Convert plain-text draft bodies to HTML paragraphs for the rich editor.
 *  Already-HTML content is returned unchanged. */
export function normalizeBodyForEditor(body: string): string {
  if (!body) return ''
  if (isHtmlContent(body)) return body
  return body
    .split(/\n{2,}/)
    .map(paragraph => {
      const lines = paragraph.split('\n').map(l => l || '&nbsp;').join('<br>')
      return `<p>${lines}</p>`
    })
    .join('')
}

export function buildApprovalEmailHtml(params: {
  topic: string
  department: string
  emailBody: string
  questions: string[]
  msFormLink: string
  deadline: string
  approveUrl: string
  editUrl: string
  feedbackUrl: string
  rejectUrl: string
  isKGT?: boolean
}): string {
  const questionsHtml = params.questions
    .map((q, i) => `<li style="margin-bottom:6px;">${i + 1}. ${escapeHtml(q)}</li>`)
    .join('')

  return `
<div style="font-family: Arial, sans-serif; max-width: 620px; color: #1a1a1a;">
  <h2 style="color: #1e40af; margin-bottom: 4px;">${params.isKGT ? 'KGT Approval Request' : 'Poll Approval Request'}</h2>
  <p style="margin:0 0 16px; color:#6b7280; font-size:14px;">${escapeHtml(params.topic)}</p>

  <table style="width:100%; border-collapse:collapse; margin-bottom:16px; font-size:14px;">
    <tr>
      <td style="padding:6px 12px 6px 0; color:#6b7280; width:120px;">Department</td>
      <td style="padding:6px 0; font-weight:600;">${params.department?.includes('@') ? 'Custom Recipients' : escapeHtml(params.department)}</td>
    </tr>
    <tr>
      <td style="padding:6px 12px 6px 0; color:#6b7280;">Deadline</td>
      <td style="padding:6px 0; font-weight:600;">${params.deadline}</td>
    </tr>
    <tr>
      <td style="padding:6px 12px 6px 0; color:#6b7280;">Poll Link</td>
      <td style="padding:6px 0;"><a href="${params.msFormLink}" style="color:#2563eb;">${params.msFormLink}</a></td>
    </tr>
  </table>

  <h3 style="font-size:14px; color:#374151; margin-bottom:8px; text-transform:uppercase; letter-spacing:.05em;">Draft Email Body</h3>
  <div style="background:#f8fafc; padding:14px; border-left:4px solid #3b82f6; border-radius:4px; font-size:14px; line-height:1.6; margin-bottom:16px;">
    ${isHtmlContent(params.emailBody) ? prepareEmailBodyHtml(params.emailBody) : linkifyUrls(params.emailBody.replace(/\n/g, '<br>'))}
  </div>

  <h3 style="font-size:14px; color:#374151; margin-bottom:8px; text-transform:uppercase; letter-spacing:.05em;">Poll Questions</h3>
  <ul style="padding-left:18px; font-size:14px; line-height:1.7; margin-bottom:24px;">${questionsHtml}</ul>

  <table style="border-collapse:collapse; margin-bottom:12px;">
    <tr>
      <td style="padding-right:10px; padding-bottom:10px;">
        <a href="${params.approveUrl}"
           style="display:inline-block; background:#16a34a; color:#fff; padding:12px 24px; border-radius:6px; text-decoration:none; font-weight:600; font-size:14px;">
          ✓ Approve
        </a>
      </td>
      <td style="padding-bottom:10px;">
        <a href="${params.editUrl}"
           style="display:inline-block; background:#ffffff; color:#1d4ed8; padding:12px 24px; border-radius:6px; text-decoration:none; font-weight:600; font-size:14px; border:2px solid #1d4ed8;">
          ✏ Edit &amp; Approve
        </a>
      </td>
    </tr>
    <tr>
      <td style="padding-right:10px;">
        <a href="${params.feedbackUrl}"
           style="display:inline-block; background:#ffffff; color:#b45309; padding:12px 24px; border-radius:6px; text-decoration:none; font-weight:600; font-size:14px; border:2px solid #d97706;">
          💬 Feedback
        </a>
      </td>
      <td>
        <a href="${params.rejectUrl}"
           style="display:inline-block; background:#ffffff; color:#dc2626; padding:12px 24px; border-radius:6px; text-decoration:none; font-weight:600; font-size:14px; border:2px solid #dc2626;">
          ✗ Reject
        </a>
      </td>
    </tr>
  </table>

  <p style="font-size:12px; color:#9ca3af; margin-top:8px;">This link expires in 7 days and can only be used once. — Koenig Solutions HR</p>
</div>
`
}

export function buildPollEmailHtml(params: {
  emailBody: string
  msFormLink: string
  deadline: string
}): string {
  return `
<div style="font-family: Arial, sans-serif; max-width: 600px;">
  <div>${isHtmlContent(params.emailBody) ? prepareEmailBodyHtml(params.emailBody) : linkifyUrls(params.emailBody.replace(/\n/g, '<br>'))}</div>
  <p><strong>Please fill out the poll by ${params.deadline}:</strong></p>
  <p><a href="${params.msFormLink}" style="background:#1e40af;color:#fff;padding:10px 20px;text-decoration:none;border-radius:4px;">Take the Poll</a></p>
</div>
`
}

export function buildResultsEmailHtml(topic: string, hasResponses = true): string {
  return `
<div style="font-family: Arial, sans-serif; max-width: 600px;">
  <p>Hi Team,</p>
  <p>PFA the results for the poll — <strong>${escapeHtml(topic)}</strong></p>
  ${hasResponses
    ? '<p>Please find the poll response export attached.</p>'
    : '<p>No responses received on this poll.</p>'}
  <br>
  <p>Regards,<br>polls@koenig-solutions.com</p>
</div>
`
}

export function buildAutoResponseHtml(params: {
  topic: string
  answers: { question: string; answer: string }[]
  isKGT?: boolean
}): string {
  const answersHtml = params.answers
    .map((a, i) => `
      <tr style="background:${i % 2 === 0 ? '#f9fafb' : '#fff'};">
        <td style="padding:10px 14px;font-size:13px;color:#6b7280;white-space:nowrap;vertical-align:top;width:24px;">${i + 1}.</td>
        <td style="padding:10px 14px;font-size:13px;">
          <div style="color:#374151;font-weight:600;margin-bottom:4px;">${escapeHtml(a.question)}</div>
          <div style="color:#111827;">${a.answer?.trim() ? linkifyUrls(escapeHtml(a.answer)) : '<em style="color:#9ca3af;">No answer provided</em>'}</div>
        </td>
      </tr>`)
    .join('')

  return `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#111827;">
  <div style="background:#0e7490;padding:22px 28px;border-radius:8px 8px 0 0;">
    <h2 style="margin:0;color:#fff;font-size:17px;font-weight:600;">Response Recorded</h2>
    <p style="margin:4px 0 0;color:rgba(255,255,255,0.65);font-size:13px;">${escapeHtml(params.topic)}</p>
  </div>
  <div style="background:#f9fafb;padding:22px 28px;border-radius:0 0 8px 8px;border:1px solid #e5e7eb;border-top:none;">
    <p style="margin:0 0 18px;font-size:14px;line-height:1.6;">
      ${params.isKGT
        ? 'Thank you for showing your interest. Your interest for KGT has been recorded. Next steps will be shared with you soon.'
        : 'Your response has been recorded. HR team will review and will work on it if found feasible.'}
    </p>

    <p style="margin:0 0 8px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#9ca3af;">Your Response</p>
    <table style="width:100%;border-collapse:collapse;border-radius:6px;border:1px solid #e5e7eb;overflow:hidden;margin-bottom:20px;">
      ${answersHtml}
    </table>

    <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.7;">
      Regards,<br>
      <strong style="color:#374151;">Team HR</strong><br>
      Poll Dashboard
    </p>
  </div>
</div>`
}

// Calendar-month boundary (previous month relative to `now`), end exclusive.
// Server-side equivalent of the client-only keyToRange() in lib/use-quarter.ts.
export function getLastCalendarMonthRange(now: Date): { startIso: string; endIsoExclusive: string; label: string } {
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const end = new Date(now.getFullYear(), now.getMonth(), 1)
  const label = start.toLocaleString('en-US', { month: 'long', year: 'numeric' })
  return { startIso: start.toISOString(), endIsoExclusive: end.toISOString(), label }
}

// Explicit "YYYY-MM" variant — used to re-run the report for a specific past
// month (e.g. manual testing against a month that actually has response data).
export function getCalendarMonthRange(yearMonth: string): { startIso: string; endIsoExclusive: string; label: string } {
  const [year, month] = yearMonth.split('-').map(Number)
  const start = new Date(year, month - 1, 1)
  const end = new Date(year, month, 1)
  const label = start.toLocaleString('en-US', { month: 'long', year: 'numeric' })
  return { startIso: start.toISOString(), endIsoExclusive: end.toISOString(), label }
}

export function buildTopVotersReportHtml(params: {
  monthLabel: string
  topVoters: { full_name: string; email: string; department_name: string | null; voteCount: number }[]
}): string {
  const votersHtml = params.topVoters.length > 0
    ? params.topVoters.map((v, i) => `
      <tr style="background:${i % 2 === 0 ? '#f9fafb' : '#fff'};">
        <td style="padding:10px 14px;font-size:13px;color:#6b7280;">${i + 1}</td>
        <td style="padding:10px 14px;font-size:13px;">
          <div style="color:#111827;font-weight:600;">${escapeHtml(v.full_name)}</div>
          <div style="color:#9ca3af;font-size:12px;">${escapeHtml(v.email)}</div>
        </td>
        <td style="padding:10px 14px;font-size:13px;color:#6b7280;">${escapeHtml(v.department_name ?? '—')}</td>
        <td style="padding:10px 14px;font-size:13px;color:#0e7490;font-weight:700;text-align:right;">${v.voteCount}</td>
      </tr>`).join('')
    : `<tr><td colspan="4" style="padding:20px;text-align:center;color:#9ca3af;font-size:13px;">No poll responses recorded for this period.</td></tr>`

  return `
<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#111827;">
  <div style="background:#0e7490;padding:22px 28px;border-radius:8px 8px 0 0;">
    <h2 style="margin:0;color:#fff;font-size:17px;font-weight:600;">Top ${params.topVoters.length || 5} Employees by Poll Participation - ${escapeHtml(params.monthLabel)}</h2>
  </div>
  <div style="background:#f9fafb;padding:22px 28px;border-radius:0 0 8px 8px;border:1px solid #e5e7eb;border-top:none;">
    <table style="width:100%;border-collapse:collapse;border-radius:6px;border:1px solid #e5e7eb;overflow:hidden;margin:0 0 20px;">
      <thead>
        <tr style="background:#f1f5f9;">
          <th style="padding:10px 14px;font-size:11px;text-transform:uppercase;color:#6b7280;text-align:left;">#</th>
          <th style="padding:10px 14px;font-size:11px;text-transform:uppercase;color:#6b7280;text-align:left;">Employee</th>
          <th style="padding:10px 14px;font-size:11px;text-transform:uppercase;color:#6b7280;text-align:left;">Department</th>
          <th style="padding:10px 14px;font-size:11px;text-transform:uppercase;color:#6b7280;text-align:right;">Polls Participated</th>
        </tr>
      </thead>
      <tbody>${votersHtml}</tbody>
    </table>
    <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.7;">
      Regards,<br>
      <strong style="color:#374151;">Poll Dashboard</strong>
    </p>
  </div>
</div>`
}

export function buildDeadlineExtensionAudienceHtml(params: {
  topic: string
  newDeadline: string
  msFormLink: string
}): string {
  return `
<div style="font-family:Arial,sans-serif;max-width:600px;color:#111827;">
  <p style="margin:0 0 12px;font-size:14px;">Dear Team,</p>
  <p style="margin:0 0 12px;font-size:14px;">
    The response deadline for the poll <strong>${escapeHtml(params.topic)}</strong> has been extended to <strong>${escapeHtml(params.newDeadline)}</strong>.
  </p>
  <p style="margin:0 0 20px;font-size:14px;">
    If you have not already shared your feedback, request you to do so by the updated deadline.
  </p>
  <p style="margin:0 0 24px;">
    <a href="${params.msFormLink}" style="display:inline-block;background:#1e40af;color:#fff;padding:10px 20px;text-decoration:none;border-radius:4px;font-size:14px;font-weight:600;">
      Take the Poll
    </a>
  </p>
  <p style="margin:0;font-size:14px;">Warm Regards,<br>Team HR<br>Poll Dashboard</p>
</div>`
}

export function buildDeadlineExtensionRequesterHtml(params: {
  topic: string
  newDeadline: string
  requesterName: string
}): string {
  return `
<div style="font-family:Arial,sans-serif;max-width:600px;color:#111827;">
  <p style="margin:0 0 12px;font-size:14px;">Hi <strong>${escapeHtml(params.requesterName)}</strong>,</p>
  <p style="margin:0 0 12px;font-size:14px;">
    This is to inform you that the response deadline for the poll <strong>${escapeHtml(params.topic)}</strong> has been extended to <strong>${escapeHtml(params.newDeadline)}</strong>.
  </p>
  <p style="margin:0 0 8px;font-size:14px;">Participants have been notified of the updated deadline.</p>
  <p style="margin:0;font-size:14px;">Warm Regards,<br>Team HR<br>Poll Dashboard</p>
</div>`
}

export function buildReplyToRespondentHtml(params: {
  name: string
  topic: string
  replyMessage: string
  answers: { question: string; answer: string }[]
}): string {
  const answersHtml = params.answers
    .map((a, i) => `
      <tr style="background:${i % 2 === 0 ? '#f9fafb' : '#fff'};">
        <td style="padding:10px 14px;font-size:13px;color:#6b7280;white-space:nowrap;vertical-align:top;width:24px;">${i + 1}.</td>
        <td style="padding:10px 14px;font-size:13px;">
          <div style="color:#374151;font-weight:600;margin-bottom:4px;">${escapeHtml(a.question)}</div>
          <div style="color:#111827;">${a.answer?.trim() ? linkifyUrls(escapeHtml(a.answer)) : '<em style="color:#9ca3af;">No answer provided</em>'}</div>
        </td>
      </tr>`)
    .join('')

  return `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#111827;">
  <div style="background:#1e40af;padding:22px 28px;border-radius:8px 8px 0 0;">
    <h2 style="margin:0;color:#fff;font-size:17px;font-weight:600;">Response from HR</h2>
    <p style="margin:4px 0 0;color:rgba(255,255,255,0.65);font-size:13px;">${escapeHtml(params.topic)}</p>
  </div>
  <div style="background:#f9fafb;padding:22px 28px;border-radius:0 0 8px 8px;border:1px solid #e5e7eb;border-top:none;">
    <p style="margin:0 0 6px;font-size:14px;">Hi <strong>${escapeHtml(params.name)}</strong>,</p>
    <p style="margin:0 0 18px;font-size:14px;line-height:1.6;">Thank you for submitting your response with us.</p>
    <div style="background:#fff;border-left:4px solid #1e40af;border-radius:4px;padding:14px 18px;margin-bottom:24px;font-size:14px;line-height:1.7;color:#1a1a1a;">
      ${linkifyUrls(escapeHtml(params.replyMessage).replace(/\n/g, '<br>'))}
    </div>
    <p style="margin:0 0 8px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#9ca3af;">Your Response</p>
    <table style="width:100%;border-collapse:collapse;border-radius:6px;border:1px solid #e5e7eb;overflow:hidden;margin-bottom:20px;">
      ${answersHtml}
    </table>
    <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.7;">
      Regards,<br>
      <strong style="color:#374151;">Priya</strong><br>
      Poll Dashboard
    </p>
  </div>
</div>`
}

// Sent in bulk to respondents whose entry was never classified (actionable
// left null) by the time HR closes the poll — i.e. no decision was ever
// recorded for their specific suggestion.
export function buildNoActionTakenHtml(params: {
  name: string
  topic: string
  answers: { question: string; answer: string }[]
}): string {
  const answersHtml = params.answers
    .map((a, i) => `
      <tr style="background:${i % 2 === 0 ? '#f9fafb' : '#fff'};">
        <td style="padding:10px 14px;font-size:13px;color:#6b7280;white-space:nowrap;vertical-align:top;width:24px;">${i + 1}.</td>
        <td style="padding:10px 14px;font-size:13px;">
          <div style="color:#374151;font-weight:600;margin-bottom:4px;">${escapeHtml(a.question)}</div>
          <div style="color:#111827;">${a.answer?.trim() ? linkifyUrls(escapeHtml(a.answer)) : '<em style="color:#9ca3af;">No answer provided</em>'}</div>
        </td>
      </tr>`)
    .join('')

  return `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#111827;">
  <div style="background:#1e40af;padding:22px 28px;border-radius:8px 8px 0 0;">
    <h2 style="margin:0;color:#fff;font-size:17px;font-weight:600;">Response from HR</h2>
    <p style="margin:4px 0 0;color:rgba(255,255,255,0.65);font-size:13px;">${escapeHtml(params.topic)}</p>
  </div>
  <div style="background:#f9fafb;padding:22px 28px;border-radius:0 0 8px 8px;border:1px solid #e5e7eb;border-top:none;">
    <p style="margin:0 0 12px;font-size:14px;">Hi <strong>${escapeHtml(params.name)}</strong>,</p>
    <p style="margin:0 0 12px;font-size:14px;line-height:1.6;">Thank you for taking the time to share your feedback through the poll.</p>
    <p style="margin:0 0 12px;font-size:14px;line-height:1.6;">We have reviewed your suggestion and though no immediate action, we will consider it for future policy changes.</p>
    <p style="margin:0 0 18px;font-size:14px;line-height:1.6;">We appreciate your participation and encourage you to continue sharing your valuable feedback in future polls.</p>
    <p style="margin:0 0 8px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#9ca3af;">Your Response</p>
    <table style="width:100%;border-collapse:collapse;border-radius:6px;border:1px solid #e5e7eb;overflow:hidden;margin-bottom:20px;">
      ${answersHtml}
    </table>
    <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.7;">
      Regards,<br>
      <strong style="color:#374151;">Team HR</strong><br>
      Poll Dashboard
    </p>
  </div>
</div>`
}

export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str
  return str.slice(0, maxLength) + '...'
}
