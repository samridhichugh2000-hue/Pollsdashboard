import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { format, formatDistanceToNow, addDays, isWeekend } from 'date-fns'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
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

export function getNextWorkingDay(from: Date = new Date()): Date {
  let next = addDays(from, 1)
  while (isWeekend(next)) {
    next = addDays(next, 1)
  }
  return next
}

export function getDeadline(from: Date = new Date()): Date {
  return addDays(from, 2)
}

export function isApprovalOverdue(sentAt: string | null | undefined): boolean {
  if (!sentAt) return false
  const sent = new Date(sentAt)
  const now = new Date()
  const hoursElapsed = (now.getTime() - sent.getTime()) / (1000 * 60 * 60)
  return hoursElapsed > 24
}

function isHtmlContent(s: string): boolean {
  return /<[a-z][\s\S]*>/i.test(s.trim())
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
}): string {
  const questionsHtml = params.questions
    .map((q, i) => `<li style="margin-bottom:6px;">${i + 1}. ${q}</li>`)
    .join('')

  return `
<div style="font-family: Arial, sans-serif; max-width: 620px; color: #1a1a1a;">
  <h2 style="color: #1e40af; margin-bottom: 4px;">Poll Approval Request</h2>
  <p style="margin:0 0 16px; color:#6b7280; font-size:14px;">${params.topic}</p>

  <table style="width:100%; border-collapse:collapse; margin-bottom:16px; font-size:14px;">
    <tr>
      <td style="padding:6px 12px 6px 0; color:#6b7280; width:120px;">Department</td>
      <td style="padding:6px 0; font-weight:600;">${params.department?.includes('@') ? 'Custom Recipients' : params.department}</td>
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
    ${isHtmlContent(params.emailBody) ? params.emailBody : params.emailBody.replace(/\n/g, '<br>')}
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
  <div>${isHtmlContent(params.emailBody) ? params.emailBody : params.emailBody.replace(/\n/g, '<br>')}</div>
  <p><strong>Please fill out the poll by ${params.deadline}:</strong></p>
  <p><a href="${params.msFormLink}" style="background:#1e40af;color:#fff;padding:10px 20px;text-decoration:none;border-radius:4px;">Take the Poll</a></p>
</div>
`
}

export function buildResultsEmailHtml(topic: string, hasResponses = true): string {
  return `
<div style="font-family: Arial, sans-serif; max-width: 600px;">
  <p>Hi Team,</p>
  <p>PFA the results for the poll — <strong>${topic}</strong></p>
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
}): string {
  const answersHtml = params.answers
    .map((a, i) => `
      <tr style="background:${i % 2 === 0 ? '#f9fafb' : '#fff'};">
        <td style="padding:10px 14px;font-size:13px;color:#6b7280;white-space:nowrap;vertical-align:top;width:24px;">${i + 1}.</td>
        <td style="padding:10px 14px;font-size:13px;">
          <div style="color:#374151;font-weight:600;margin-bottom:4px;">${a.question}</div>
          <div style="color:#111827;">${a.answer?.trim() || '<em style="color:#9ca3af;">No answer provided</em>'}</div>
        </td>
      </tr>`)
    .join('')

  return `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#111827;">
  <div style="background:#0e7490;padding:22px 28px;border-radius:8px 8px 0 0;">
    <h2 style="margin:0;color:#fff;font-size:17px;font-weight:600;">Response Recorded</h2>
    <p style="margin:4px 0 0;color:rgba(255,255,255,0.65);font-size:13px;">${params.topic}</p>
  </div>
  <div style="background:#f9fafb;padding:22px 28px;border-radius:0 0 8px 8px;border:1px solid #e5e7eb;border-top:none;">
    <p style="margin:0 0 18px;font-size:14px;line-height:1.6;">
      Your response has been recorded. HR team will review and will work on it if found feasible.
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

export function buildDeadlineExtensionAudienceHtml(params: {
  topic: string
  newDeadline: string
  msFormLink: string
}): string {
  return `
<div style="font-family:Arial,sans-serif;max-width:600px;color:#111827;">
  <p style="margin:0 0 12px;font-size:14px;">Dear Team,</p>
  <p style="margin:0 0 12px;font-size:14px;">
    The response deadline for the poll <strong>${params.topic}</strong> has been extended to <strong>${params.newDeadline}</strong>.
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
  <p style="margin:0 0 12px;font-size:14px;">Hi <strong>${params.requesterName}</strong>,</p>
  <p style="margin:0 0 12px;font-size:14px;">
    This is to inform you that the response deadline for the poll <strong>${params.topic}</strong> has been extended to <strong>${params.newDeadline}</strong>.
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
          <div style="color:#374151;font-weight:600;margin-bottom:4px;">${a.question}</div>
          <div style="color:#111827;">${a.answer?.trim() || '<em style="color:#9ca3af;">No answer provided</em>'}</div>
        </td>
      </tr>`)
    .join('')

  return `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#111827;">
  <div style="background:#1e40af;padding:22px 28px;border-radius:8px 8px 0 0;">
    <h2 style="margin:0;color:#fff;font-size:17px;font-weight:600;">Response from HR</h2>
    <p style="margin:4px 0 0;color:rgba(255,255,255,0.65);font-size:13px;">${params.topic}</p>
  </div>
  <div style="background:#f9fafb;padding:22px 28px;border-radius:0 0 8px 8px;border:1px solid #e5e7eb;border-top:none;">
    <p style="margin:0 0 6px;font-size:14px;">Hi <strong>${params.name}</strong>,</p>
    <p style="margin:0 0 18px;font-size:14px;line-height:1.6;">Thank you for submitting your response with us.</p>
    <div style="background:#fff;border-left:4px solid #1e40af;border-radius:4px;padding:14px 18px;margin-bottom:24px;font-size:14px;line-height:1.7;color:#1a1a1a;">
      ${params.replyMessage.replace(/\n/g, '<br>')}
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

export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str
  return str.slice(0, maxLength) + '...'
}
