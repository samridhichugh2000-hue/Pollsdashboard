import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { format, formatDistanceToNow, addDays, isWeekend } from 'date-fns'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return '—'
  return format(new Date(date), 'MMM d, yyyy')
}

export function formatDateTime(date: string | Date | null | undefined): string {
  if (!date) return '—'
  return format(new Date(date), 'MMM d, yyyy h:mm a')
}

export function formatRelative(date: string | Date | null | undefined): string {
  if (!date) return '—'
  return formatDistanceToNow(new Date(date), { addSuffix: true })
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

export function buildApprovalEmailHtml(params: {
  topic: string
  department: string
  emailBody: string
  questions: string[]
  msFormLink: string
  deadline: string
  approveUrl: string
  editUrl: string
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
      <td style="padding:6px 0; font-weight:600;">${params.department}</td>
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
    ${params.emailBody.replace(/\n/g, '<br>')}
  </div>

  <h3 style="font-size:14px; color:#374151; margin-bottom:8px; text-transform:uppercase; letter-spacing:.05em;">Poll Questions</h3>
  <ul style="padding-left:18px; font-size:14px; line-height:1.7; margin-bottom:24px;">${questionsHtml}</ul>

  <div style="display:flex; gap:12px; margin-bottom:24px;">
    <a href="${params.approveUrl}"
       style="display:inline-block; background:#16a34a; color:#fff; padding:12px 28px; border-radius:6px; text-decoration:none; font-weight:600; font-size:15px;">
      ✓ Approve
    </a>
    <a href="${params.editUrl}"
       style="display:inline-block; background:#ffffff; color:#1d4ed8; padding:12px 28px; border-radius:6px; text-decoration:none; font-weight:600; font-size:15px; border:2px solid #1d4ed8;">
      ✏ Edit &amp; Approve
    </a>
  </div>

  <p style="font-size:12px; color:#9ca3af;">This link expires in 7 days and can only be used once. — Koenig Solutions HR</p>
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
  <div>${params.emailBody.replace(/\n/g, '<br>')}</div>
  <p><strong>Please fill out the poll by ${params.deadline}:</strong></p>
  <p><a href="${params.msFormLink}" style="background:#1e40af;color:#fff;padding:10px 20px;text-decoration:none;border-radius:4px;">Take the Poll</a></p>
</div>
`
}

export function buildResultsEmailHtml(topic: string): string {
  return `
<div style="font-family: Arial, sans-serif; max-width: 600px;">
  <p>Hi Team,</p>
  <p>PFA the results for the poll — <strong>${topic}</strong></p>
  <p>Please find the poll response export attached.</p>
  <br>
  <p>Regards,<br>polls@koenig-solutions.com</p>
</div>
`
}

export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str
  return str.slice(0, maxLength) + '...'
}
