export type PollStatus =
  | 'DETECTED'
  | 'DRAFT'
  | 'FORM_CREATED'
  | 'AWAITING_APPROVAL'
  | 'APPROVED'
  | 'RMS_TASK_CREATED'
  | 'SENT'
  | 'REMINDER_SENT'
  | 'RMS_PUBLISHED'
  | 'CLOSED'
  | 'RESULTS_UPLOADED'
  | 'ARCHIVED'
  | 'REJECTED'
  | 'RMS_TASK_FAILED'
  | 'RMS_PUBLISH_FAILED'
  | 'SEND_FAILED'

export type PollSource = 'email' | 'dashboard' | 'external'

export type ApprovalAction = 'approved' | 'edited' | 'clarification'

export type UserRole = 'super_admin' | 'admin'

export type AuthProvider = 'microsoft' | 'email'

export interface Poll {
  id: string
  topic: string
  department: string
  requested_by: string
  source: PollSource
  email_thread_id?: string | null
  draft_email_body?: string | null
  subject?: string | null
  questions?: string | null // JSON array string
  deadline?: string | null
  ms_form_id?: string | null
  ms_form_link?: string | null
  rms_task_id?: string | null
  rms_news_id?: string | null
  release_emails?: string | null // JSON array of email strings
  release_message_id?: string | null // Graph message ID of the release email
  status: PollStatus
  sent_at?: string | null
  reminder_at?: string | null
  reminder_sent_at?: string | null
  approved_at?: string | null
  closed_at?: string | null
  results_uploaded_at?: string | null
  remarks?: string | null
  created_at: string
  updated_at: string
}

export interface PollApproval {
  id: string
  poll_id: string
  action: ApprovalAction
  notes?: string | null
  actioned_by?: string | null
  actioned_at: string
}

export interface PollResponse {
  id: string
  poll_id: string
  response_data?: string | null // JSON from MS Forms
  is_actionable: boolean
  email_response?: string | null
  email_sent_at?: string | null
  fetched_at: string
}

export interface User {
  id: string
  name: string
  email: string
  role: UserRole
  auth_provider: AuthProvider
  created_at: string
}

export interface AuditLog {
  id: string
  poll_id?: string | null
  action: string
  performed_by?: string | null
  metadata?: string | null // JSON
  created_at: string
}

export interface CreatePollInput {
  topic: string
  department: string
  recipient_email?: string
  requested_by: string
  source: PollSource
  email_thread_id?: string
  questions?: string[]
  deadline?: string
  remarks?: string
  single_response?: boolean
}

export interface KPIData {
  totalThisMonth: number
  awaitingApproval: number
  active: number
  closedThisMonth: number
  rmsTasksCreatedPct: number
  resultsUploadedPct: number
}

export interface Notification {
  id: string
  type: 'new_request' | 'approval_received' | 'approval_overdue' | 'reminder_due' | 'results_ready' | 'rms_failure'
  message: string
  poll_id?: string
  read: boolean
  created_at: string
}

export interface AuthorizedSender {
  email: string
  name: string
}

export interface RegularPoll {
  id: string
  name: string
  description?: string | null
  frequency: 'monthly' | 'quarterly'
  scheduled_day: number
  department: string
  subject: string
  draft_email_body: string
  questions: string // JSON array
  recipients: string // JSON array of email strings
  ms_form_link?: string | null
  next_run_date: string // YYYY-MM-DD
  last_run_date?: string | null
  is_active: number // 1 or 0 (SQLite boolean)
  created_at: string
  updated_at: string
}

export const AUTHORIZED_SENDERS: AuthorizedSender[] = [
  { email: 'rohit.a@koenig-solutions.com', name: 'Rohit A' },
  { email: 'nupur.munjal@koenig-solutions.com', name: 'Nupur Munjal' },
  { email: 'ea@koenig-solutions.com', name: 'EA' },
  { email: 'Bhargavi.Bhimavarapu@koenig-solutions.com', name: 'Bhargavi Bhimavarapu' },
  { email: 'Nabila.Fatima@koenig-solutions.com', name: 'Nabila Fatima' },
]

export const STATUS_LABELS: Record<PollStatus, string> = {
  DETECTED: 'Detected',
  DRAFT: 'Draft',
  FORM_CREATED: 'Form Created',
  AWAITING_APPROVAL: 'Awaiting Approval',
  APPROVED: 'Approved',
  RMS_TASK_CREATED: 'RMS Task Created',
  SENT: 'Sent',
  REMINDER_SENT: 'Reminder Sent',
  RMS_PUBLISHED: 'RMS Published',
  CLOSED: 'Closed',
  RESULTS_UPLOADED: 'Results Uploaded',
  ARCHIVED: 'Archived',
  REJECTED: 'Rejected',
  RMS_TASK_FAILED: 'RMS Task Failed',
  RMS_PUBLISH_FAILED: 'RMS Publish Failed',
  SEND_FAILED: 'Send Failed',
}

export const STATUS_COLORS: Record<PollStatus, string> = {
  DETECTED: 'bg-blue-100 text-blue-800',
  DRAFT: 'bg-gray-100 text-gray-800',
  FORM_CREATED: 'bg-indigo-100 text-indigo-800',
  AWAITING_APPROVAL: 'bg-yellow-100 text-yellow-800',
  APPROVED: 'bg-green-100 text-green-800',
  RMS_TASK_CREATED: 'bg-teal-100 text-teal-800',
  SENT: 'bg-purple-100 text-purple-800',
  REMINDER_SENT: 'bg-violet-100 text-violet-800',
  RMS_PUBLISHED: 'bg-cyan-100 text-cyan-800',
  CLOSED: 'bg-slate-100 text-slate-800',
  RESULTS_UPLOADED: 'bg-emerald-100 text-emerald-800',
  ARCHIVED: 'bg-gray-200 text-gray-600',
  REJECTED: 'bg-red-100 text-red-700',
  RMS_TASK_FAILED: 'bg-red-100 text-red-800',
  RMS_PUBLISH_FAILED: 'bg-red-100 text-red-800',
  SEND_FAILED: 'bg-red-100 text-red-800',
}
