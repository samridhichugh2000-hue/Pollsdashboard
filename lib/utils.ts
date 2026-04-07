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
}): string {
  const questionsHtml = params.questions
    .map((q, i) => `<li>${i + 1}. ${q}</li>`)
    .join('')

  return `
<div style="font-family: Arial, sans-serif; max-width: 600px;">
  <h2 style="color: #1e40af;">Poll Approval Request: ${params.topic}</h2>
  <p><strong>Department:</strong> ${params.department}</p>
  <p><strong>Deadline:</strong> ${params.deadline}</p>

  <h3>Draft Email Body</h3>
  <div style="background: #f8fafc; padding: 12px; border-left: 4px solid #3b82f6;">
    ${params.emailBody.replace(/\n/g, '<br>')}
  </div>

  <h3>Poll Questions</h3>
  <ul>${questionsHtml}</ul>

  <h3>Poll Form</h3>
  <p><a href="${params.msFormLink}">${params.msFormLink}</a></p>

  <hr>
  <p>To approve, reply with <strong>APPROVED</strong>.</p>
  <p>To request edits, reply with your suggested changes.</p>
  <p>For clarification, reply with <strong>CLARIFICATION NEEDED</strong> and your question.</p>
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
