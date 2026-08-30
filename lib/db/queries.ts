import { getDb } from './client'
import type { Poll, PollApproval, PollResponse, User, AuditLog, PollStatus, CreatePollInput, PollFaq } from '@/types'
import { v4 as uuidv4 } from 'uuid'

// Single source of truth for "this poll is closed" across KPI, overview, and
// reports — these three previously each had their own, disagreeing list
// (e.g. KPI omitting RESULTS_SHARED while overview included it), which is
// exactly why the same poll could count as closed on one page and not another.
// RMS_PUBLISHED ("Posted to Koenig News") is included here too — Push to RMS
// and Upload Results can now only ever be run on an already-closed poll (see
// their guards in app/api/polls/[id]/route.ts), so from here on RMS_PUBLISHED
// never represents a poll still collecting responses.
export const CLOSED_POLL_STATUSES: PollStatus[] = ['CLOSED', 'RESULTS_UPLOADED', 'RESULTS_SHARED', 'RMS_PUBLISHED']

// ─── Polls ───────────────────────────────────────────────────────────────────

export async function getAllPolls(): Promise<Poll[]> {
  const result = await getDb().execute(`SELECT * FROM polls WHERE request_type != 'KGT' ORDER BY created_at DESC`)
  return result.rows as unknown as Poll[]
}

export async function getAllKGTRequests(): Promise<Poll[]> {
  const result = await getDb().execute(`SELECT * FROM polls WHERE request_type = 'KGT' ORDER BY created_at DESC`)
  return result.rows as unknown as Poll[]
}

export async function getPollById(id: string): Promise<Poll | null> {
  const result = await getDb().execute({ sql: 'SELECT * FROM polls WHERE id = ?', args: [id] })
  return (result.rows[0] as unknown as Poll) ?? null
}

export async function getPollsByStatus(status: PollStatus | PollStatus[]): Promise<Poll[]> {
  if (Array.isArray(status)) {
    const placeholders = status.map(() => '?').join(', ')
    const result = await getDb().execute({
      sql: `SELECT * FROM polls WHERE status IN (${placeholders}) ORDER BY created_at DESC`,
      args: status,
    })
    return result.rows as unknown as Poll[]
  }
  const result = await getDb().execute({
    sql: 'SELECT * FROM polls WHERE status = ? ORDER BY created_at DESC',
    args: [status],
  })
  return result.rows as unknown as Poll[]
}

export async function getPollsBySource(source: 'email' | 'dashboard'): Promise<Poll[]> {
  const result = await getDb().execute({
    sql: 'SELECT * FROM polls WHERE source = ? ORDER BY created_at DESC',
    args: [source],
  })
  return result.rows as unknown as Poll[]
}

export async function getActivePollsThisMonth(): Promise<Poll[]> {
  const startOfMonth = new Date()
  startOfMonth.setDate(1)
  startOfMonth.setHours(0, 0, 0, 0)
  const result = await getDb().execute({
    sql: "SELECT * FROM polls WHERE created_at >= ? AND status NOT IN ('ARCHIVED') ORDER BY created_at DESC",
    args: [startOfMonth.toISOString()],
  })
  return result.rows as unknown as Poll[]
}

export async function createPoll(input: CreatePollInput): Promise<Poll> {
  const id = uuidv4()
  const deadline = input.deadline ?? new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
  const now = new Date().toISOString()

  await getDb().execute({
    sql: `INSERT INTO polls (id, topic, department, recipient_email, requested_by, source, email_thread_id, questions, deadline, remarks, single_response, request_type, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DETECTED', ?, ?)`,
    args: [
      id,
      input.topic,
      input.department,
      input.recipient_email ?? null,
      input.requested_by,
      input.source,
      input.email_thread_id ?? null,
      input.questions ? JSON.stringify(input.questions) : null,
      deadline,
      input.remarks ?? null,
      input.single_response !== false ? 1 : 0,
      input.request_type ?? 'POLL',
      now,
      now,
    ],
  })

  return (await getPollById(id))!
}

// Same allow-list discipline as updatePoll() below — extra's keys ultimately
// get interpolated into the SQL column list, so an unvalidated key is a
// SQL-injection-via-column-name vector even though every current call site
// only ever passes hardcoded literals.
const POLL_STATUS_EXTRA_ALLOWED = [
  'sent_at', 'reminder_at', 'reminder_sent_at', 'second_reminder_sent_at', 'closure_alert_sent_at',
  'approved_at', 'closed_at', 'results_uploaded_at', 'release_emails', 'release_message_id',
  'rms_task_id', 'rms_news_id', 'archived_from_status',
]

export async function updatePollStatus(id: string, status: PollStatus, extra?: Record<string, string | null>): Promise<void> {
  const now = new Date().toISOString()
  const setClauses = ['status = ?', 'updated_at = ?']
  const args: (string | null)[] = [status, now]

  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      if (!POLL_STATUS_EXTRA_ALLOWED.includes(key)) throw new Error(`updatePollStatus: column not allowed: ${key}`)
      setClauses.push(`${key} = ?`)
      args.push(value)
    }
  }

  args.push(id)
  await getDb().execute({
    sql: `UPDATE polls SET ${setClauses.join(', ')} WHERE id = ?`,
    args,
  })
}

// Atomically claim a single "already sent" marker column before firing an
// email/side-effect. Returns false if another invocation already claimed it
// (the UPDATE affects zero rows), so the caller knows to skip — this closes
// the race where two overlapping cron runs both read the same unclaimed row
// and both send.
const CLAIMABLE_COLUMNS = ['closure_alert_sent_at', 'second_reminder_sent_at', 'results_uploaded_at']

export async function claimPollColumn(id: string, column: typeof CLAIMABLE_COLUMNS[number], value: string): Promise<boolean> {
  if (!CLAIMABLE_COLUMNS.includes(column)) throw new Error(`claimPollColumn: column not allowed: ${column}`)
  const result = await getDb().execute({
    sql: `UPDATE polls SET ${column} = ?, updated_at = ? WHERE id = ? AND ${column} IS NULL`,
    args: [value, new Date().toISOString(), id],
  })
  return result.rowsAffected === 1
}

// Atomically transition SENT -> REMINDER_SENT. Guards on the poll still being
// in SENT so two overlapping cron invocations can't both send the 1st reminder.
export async function claimReminderSent(id: string, reminderSentAt: string): Promise<boolean> {
  const result = await getDb().execute({
    sql: `UPDATE polls SET status = 'REMINDER_SENT', reminder_sent_at = ?, updated_at = ? WHERE id = ? AND status = 'SENT'`,
    args: [reminderSentAt, new Date().toISOString(), id],
  })
  return result.rowsAffected === 1
}

export async function updatePoll(id: string, fields: Partial<Poll>): Promise<void> {
  const now = new Date().toISOString()
  const allowed = [
    'topic', 'department', 'requested_by', 'draft_email_body', 'subject', 'questions',
    'deadline', 'ms_form_id', 'ms_form_link', 'rms_task_id', 'rms_news_id',
    'status', 'sent_at', 'reminder_at', 'reminder_sent_at', 'second_reminder_sent_at', 'closure_alert_sent_at', 'approved_at',
    'closed_at', 'results_uploaded_at', 'closed_message', 'remarks', 'release_emails', 'release_message_id', 'last_reminder_message_id',
    'scheduled_release_at', 'scheduled_release_emails', 'has_faq',
  ]
  const setClauses: string[] = ['updated_at = ?']
  const args: (string | null | boolean | number)[] = [now]

  for (const [key, value] of Object.entries(fields)) {
    if (allowed.includes(key)) {
      setClauses.push(`${key} = ?`)
      args.push(value as string | null)
    }
  }

  args.push(id)
  await getDb().execute({
    sql: `UPDATE polls SET ${setClauses.join(', ')} WHERE id = ?`,
    args,
  })
}

// ─── Poll Attachments ──────────────────────────────────────────────────────
export type PollAttachment = { name: string; contentType: string; contentBytes: string }

// Replace the full set of stored attachments for a poll.
export async function replacePollAttachments(pollId: string, attachments: PollAttachment[]): Promise<void> {
  const db = getDb()
  await db.execute({ sql: 'DELETE FROM poll_attachments WHERE poll_id = ?', args: [pollId] })
  for (const a of attachments) {
    await db.execute({
      sql: 'INSERT INTO poll_attachments (id, poll_id, name, content_type, content_bytes) VALUES (?, ?, ?, ?, ?)',
      args: [uuidv4(), pollId, a.name, a.contentType, a.contentBytes],
    })
  }
}

// Full attachments (including base64 bytes) — used when sending email.
export async function getPollAttachments(pollId: string): Promise<PollAttachment[]> {
  const result = await getDb().execute({
    sql: 'SELECT name, content_type, content_bytes FROM poll_attachments WHERE poll_id = ? ORDER BY created_at ASC',
    args: [pollId],
  })
  return result.rows.map((r) => ({
    name: r.name as string,
    contentType: r.content_type as string,
    contentBytes: r.content_bytes as string,
  }))
}

// Lightweight metadata (no bytes) — used to list attachments in the UI.
export async function getPollAttachmentsMeta(pollId: string): Promise<{ name: string; size: number }[]> {
  const result = await getDb().execute({
    sql: 'SELECT name, length(content_bytes) AS b64len FROM poll_attachments WHERE poll_id = ? ORDER BY created_at ASC',
    args: [pollId],
  })
  return result.rows.map((r) => {
    const b64len = Number(r.b64len ?? 0)
    // Approximate decoded byte size from base64 length (4 base64 chars ≈ 3 bytes).
    return { name: r.name as string, size: Math.floor((b64len * 3) / 4) }
  })
}

// ─── Poll FAQs ─────────────────────────────────────────────────────────────
// Independent of poll lifecycle — FAQs can be added, edited, and announced
// whether the poll itself is a draft, active, or already closed/expired.

export async function getFaqsByPoll(pollId: string): Promise<PollFaq[]> {
  const result = await getDb().execute({
    sql: 'SELECT * FROM poll_faqs WHERE poll_id = ? ORDER BY created_at ASC',
    args: [pollId],
  })
  return result.rows as unknown as PollFaq[]
}

export async function getFaqById(id: string): Promise<PollFaq | null> {
  const result = await getDb().execute({ sql: 'SELECT * FROM poll_faqs WHERE id = ?', args: [id] })
  return (result.rows[0] as unknown as PollFaq) ?? null
}

export async function createFaq(pollId: string, question: string, answer: string, createdBy?: string): Promise<PollFaq> {
  const id = uuidv4()
  await getDb().execute({
    sql: 'INSERT INTO poll_faqs (id, poll_id, question, answer, created_by) VALUES (?, ?, ?, ?, ?)',
    args: [id, pollId, question, answer, createdBy ?? null],
  })
  return (await getFaqById(id))!
}

export async function updateFaq(id: string, fields: Partial<Pick<PollFaq, 'question' | 'answer' | 'status' | 'announced_at' | 'announce_emails'>>): Promise<void> {
  const now = new Date().toISOString()
  const allowed = ['question', 'answer', 'status', 'announced_at', 'announce_emails']
  const setClauses: string[] = ['updated_at = ?']
  const args: (string | null)[] = [now]

  for (const [key, value] of Object.entries(fields)) {
    if (allowed.includes(key)) {
      setClauses.push(`${key} = ?`)
      args.push(value as string | null)
    }
  }

  args.push(id)
  await getDb().execute({
    sql: `UPDATE poll_faqs SET ${setClauses.join(', ')} WHERE id = ?`,
    args,
  })
}

export async function deleteFaq(id: string): Promise<void> {
  await getDb().execute({ sql: 'DELETE FROM poll_faqs WHERE id = ?', args: [id] })
}

export async function getKPIData() {
  const startOfMonth = new Date()
  startOfMonth.setDate(1)
  startOfMonth.setHours(0, 0, 0, 0)
  const iso = startOfMonth.toISOString()
  const db = getDb()

  const closedPh = CLOSED_POLL_STATUSES.map(() => '?').join(', ')

  const [totalRes, approvalRes, activeRes, closedRes, rmsRes, resultsRes] = await Promise.all([
    db.execute({ sql: "SELECT COUNT(*) as count FROM polls WHERE created_at >= ? AND status != 'ARCHIVED'", args: [iso] }),
    db.execute({ sql: "SELECT COUNT(*) as count FROM polls WHERE status = 'AWAITING_APPROVAL'", args: [] }),
    db.execute({ sql: "SELECT COUNT(*) as count FROM polls WHERE status IN ('SENT', 'REMINDER_SENT')", args: [] }),
    db.execute({ sql: `SELECT COUNT(*) as count FROM polls WHERE status IN (${closedPh}) AND closed_at >= ?`, args: [...CLOSED_POLL_STATUSES, iso] }),
    db.execute({ sql: "SELECT COUNT(*) as total, SUM(CASE WHEN rms_task_id IS NOT NULL THEN 1 ELSE 0 END) as created FROM polls WHERE created_at >= ? AND status != 'ARCHIVED'", args: [iso] }),
    db.execute({ sql: "SELECT COUNT(*) as total, SUM(CASE WHEN results_uploaded_at IS NOT NULL THEN 1 ELSE 0 END) as uploaded FROM polls WHERE closed_at >= ? AND status != 'ARCHIVED'", args: [iso] }),
  ])

  const total = Number(totalRes.rows[0]?.count ?? 0)
  const rmsTotal = Number((rmsRes.rows[0] as Record<string, unknown>)?.total ?? 0)
  const rmsCreated = Number((rmsRes.rows[0] as Record<string, unknown>)?.created ?? 0)
  const resUploaded = Number((resultsRes.rows[0] as Record<string, unknown>)?.uploaded ?? 0)

  return {
    totalThisMonth: total,
    awaitingApproval: Number(approvalRes.rows[0]?.count ?? 0),
    active: Number(activeRes.rows[0]?.count ?? 0),
    closedThisMonth: Number(closedRes.rows[0]?.count ?? 0),
    rmsTasksCreated: rmsCreated,
    resultsUploaded: resUploaded,
  }
}

// ─── Poll Approvals ───────────────────────────────────────────────────────────

export async function createApproval(pollId: string, action: string, notes?: string, actionedBy?: string): Promise<void> {
  const id = uuidv4()
  await getDb().execute({
    sql: 'INSERT INTO poll_approvals (id, poll_id, action, notes, actioned_by) VALUES (?, ?, ?, ?, ?)',
    args: [id, pollId, action, notes ?? null, actionedBy ?? null],
  })
}

export async function getApprovalsByPoll(pollId: string): Promise<PollApproval[]> {
  const result = await getDb().execute({
    sql: 'SELECT * FROM poll_approvals WHERE poll_id = ? ORDER BY actioned_at DESC',
    args: [pollId],
  })
  return result.rows as unknown as PollApproval[]
}

// ─── Poll Responses ───────────────────────────────────────────────────────────

export async function upsertPollResponse(pollId: string, responseData: string): Promise<void> {
  const id = uuidv4()
  const db = getDb()
  const existing = await db.execute({ sql: 'SELECT id FROM poll_responses WHERE poll_id = ?', args: [pollId] })
  if (existing.rows.length > 0) {
    await db.execute({
      sql: 'UPDATE poll_responses SET response_data = ?, fetched_at = CURRENT_TIMESTAMP WHERE poll_id = ?',
      args: [responseData, pollId],
    })
  } else {
    await db.execute({
      sql: 'INSERT INTO poll_responses (id, poll_id, response_data) VALUES (?, ?, ?)',
      args: [id, pollId, responseData],
    })
  }
}

export async function updateResponseActionable(pollId: string, isActionable: boolean, emailResponse?: string): Promise<void> {
  await getDb().execute({
    sql: 'UPDATE poll_responses SET is_actionable = ?, email_response = ? WHERE poll_id = ?',
    args: [isActionable ? 1 : 0, emailResponse ?? null, pollId],
  })
}

export async function getPollResponse(pollId: string): Promise<PollResponse | null> {
  const result = await getDb().execute({ sql: 'SELECT * FROM poll_responses WHERE poll_id = ?', args: [pollId] })
  return (result.rows[0] as unknown as PollResponse) ?? null
}

// Runs when a poll closes (manual or auto) — any response entry nobody ever
// triaged (actionable still null AND no status set) is marked 'completed' so
// it drops out of "Pending for Action" once the poll stops collecting input.
// Entries with an explicit status already (wip/process-improved) or an
// explicit actionable decision are left untouched — this only resolves
// entries nobody looked at, it never overwrites a real human decision.
export async function closeOutUntouchedEntries(pollId: string): Promise<number> {
  const pollResponse = await getPollResponse(pollId)
  if (!pollResponse?.response_data) return 0

  let entries: Array<{ actionable?: boolean | null; status?: string | null; [key: string]: unknown }>
  try {
    entries = JSON.parse(pollResponse.response_data)
  } catch {
    return 0
  }

  let changed = 0
  const updated = entries.map((e) => {
    if (e.actionable == null && !e.status) {
      changed++
      return { ...e, status: 'completed' }
    }
    return e
  })

  if (changed > 0) await upsertPollResponse(pollId, JSON.stringify(updated))
  return changed
}

// ─── Users ────────────────────────────────────────────────────────────────────

export async function getUserByEmail(email: string): Promise<User | null> {
  const result = await getDb().execute({ sql: 'SELECT * FROM users WHERE email = ?', args: [email] })
  return (result.rows[0] as unknown as User) ?? null
}

export async function getAllUsers(): Promise<User[]> {
  const result = await getDb().execute('SELECT id, name, email, role, auth_provider, created_at FROM users ORDER BY created_at DESC')
  return result.rows as unknown as User[]
}

export async function createUser(name: string, email: string, role: string, authProvider: string, passwordHash?: string): Promise<User> {
  const id = uuidv4()
  await getDb().execute({
    sql: 'INSERT INTO users (id, name, email, role, auth_provider, password_hash) VALUES (?, ?, ?, ?, ?, ?)',
    args: [id, name, email, role, authProvider, passwordHash ?? null],
  })
  return (await getUserByEmail(email))!
}

// ─── Audit Logs ───────────────────────────────────────────────────────────────

export async function createAuditLog(pollId: string | null, action: string, performedBy?: string, metadata?: Record<string, unknown>): Promise<void> {
  const id = uuidv4()
  await getDb().execute({
    sql: 'INSERT INTO audit_logs (id, poll_id, action, performed_by, metadata) VALUES (?, ?, ?, ?, ?)',
    args: [id, pollId, action, performedBy ?? null, metadata ? JSON.stringify(metadata) : null],
  })
}

export async function getAuditLogsByPoll(pollId: string): Promise<AuditLog[]> {
  const result = await getDb().execute({
    sql: 'SELECT * FROM audit_logs WHERE poll_id = ? ORDER BY created_at DESC',
    args: [pollId],
  })
  return result.rows as unknown as AuditLog[]
}

// ─── Approval Tokens ──────────────────────────────────────────────────────────

export async function createApprovalToken(pollId: string): Promise<string> {
  const db = getDb()
  const id = uuidv4()
  const token = uuidv4().replace(/-/g, '') + uuidv4().replace(/-/g, '') // 64-char hex token
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

  // Invalidate any still-unused tokens from a previous SEND_FOR_APPROVAL —
  // otherwise an old approval-request email clicked after the poll was
  // edited/re-sent/already released can regress the poll's status.
  await db.execute({
    sql: `UPDATE poll_approval_tokens SET used_at = ? WHERE poll_id = ? AND used_at IS NULL`,
    args: [new Date().toISOString(), pollId],
  })

  await db.execute({
    sql: 'INSERT INTO poll_approval_tokens (id, poll_id, token, expires_at) VALUES (?, ?, ?, ?)',
    args: [id, pollId, token, expiresAt],
  })
  return token
}

export async function getApprovalToken(
  token: string
): Promise<{ poll_id: string; used_at: string | null; expires_at: string } | null> {
  const result = await getDb().execute({
    sql: 'SELECT poll_id, used_at, expires_at FROM poll_approval_tokens WHERE token = ?',
    args: [token],
  })
  return (result.rows[0] as unknown as { poll_id: string; used_at: string | null; expires_at: string }) ?? null
}

export async function consumeApprovalToken(token: string): Promise<void> {
  await getDb().execute({
    sql: 'UPDATE poll_approval_tokens SET used_at = ? WHERE token = ?',
    args: [new Date().toISOString(), token],
  })
}

// ─── Regular Polls ────────────────────────────────────────────────────────────

import type { RegularPoll } from '@/types'

export async function getAllRegularPolls(): Promise<RegularPoll[]> {
  const result = await getDb().execute('SELECT * FROM regular_polls ORDER BY next_run_date ASC')
  return result.rows as unknown as RegularPoll[]
}

export async function getRegularPollById(id: string): Promise<RegularPoll | null> {
  const result = await getDb().execute({ sql: 'SELECT * FROM regular_polls WHERE id = ?', args: [id] })
  return (result.rows[0] as unknown as RegularPoll) ?? null
}

export async function getDueRegularPolls(): Promise<RegularPoll[]> {
  const today = new Date().toISOString().split('T')[0]
  const result = await getDb().execute({
    sql: "SELECT * FROM regular_polls WHERE is_active = 1 AND next_run_date <= ? ORDER BY next_run_date ASC",
    args: [today],
  })
  return result.rows as unknown as RegularPoll[]
}

export async function createRegularPoll(fields: Omit<RegularPoll, 'id' | 'created_at' | 'updated_at'>): Promise<RegularPoll> {
  const id = uuidv4()
  const now = new Date().toISOString()
  await getDb().execute({
    sql: `INSERT INTO regular_polls (id, name, description, frequency, scheduled_day, department, subject, draft_email_body, questions, recipients, ms_form_link, next_run_date, last_run_date, is_active, auto_approve, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id, fields.name, fields.description ?? null, fields.frequency, fields.scheduled_day,
      fields.department, fields.subject, fields.draft_email_body, fields.questions,
      fields.recipients, fields.ms_form_link ?? null, fields.next_run_date,
      fields.last_run_date ?? null, fields.is_active ? 1 : 0, fields.auto_approve ? 1 : 0, now, now,
    ],
  })
  return (await getRegularPollById(id))!
}

// ─── Cadence (Regular Poll) Attachments ────────────────────────────────────
// Same shape/semantics as poll_attachments, but scoped to a cadence template
// rather than a single released poll — the default attachment set reused on
// every future auto-release until explicitly changed.

export async function replaceRegularPollAttachments(regularPollId: string, attachments: PollAttachment[]): Promise<void> {
  const db = getDb()
  await db.execute({ sql: 'DELETE FROM regular_poll_attachments WHERE regular_poll_id = ?', args: [regularPollId] })
  for (const a of attachments) {
    await db.execute({
      sql: 'INSERT INTO regular_poll_attachments (id, regular_poll_id, name, content_type, content_bytes) VALUES (?, ?, ?, ?, ?)',
      args: [uuidv4(), regularPollId, a.name, a.contentType, a.contentBytes],
    })
  }
}

// Full attachments (including base64 bytes) — used when sending the release email.
export async function getRegularPollAttachments(regularPollId: string): Promise<PollAttachment[]> {
  const result = await getDb().execute({
    sql: 'SELECT name, content_type, content_bytes FROM regular_poll_attachments WHERE regular_poll_id = ? ORDER BY created_at ASC',
    args: [regularPollId],
  })
  return result.rows.map((r) => ({
    name: r.name as string,
    contentType: r.content_type as string,
    contentBytes: r.content_bytes as string,
  }))
}

// Lightweight metadata (no bytes) — used to list attachments in the UI.
export async function getRegularPollAttachmentsMeta(regularPollId: string): Promise<{ name: string; size: number }[]> {
  const result = await getDb().execute({
    sql: 'SELECT name, length(content_bytes) AS b64len FROM regular_poll_attachments WHERE regular_poll_id = ? ORDER BY created_at ASC',
    args: [regularPollId],
  })
  return result.rows.map((r) => {
    const b64len = Number(r.b64len ?? 0)
    return { name: r.name as string, size: Math.floor((b64len * 3) / 4) }
  })
}

// Attachment counts for every template in one query — avoids N+1 when listing all cadence polls.
export async function getRegularPollAttachmentCounts(): Promise<Record<string, number>> {
  const result = await getDb().execute('SELECT regular_poll_id, COUNT(*) AS cnt FROM regular_poll_attachments GROUP BY regular_poll_id')
  const counts: Record<string, number> = {}
  for (const r of result.rows) counts[r.regular_poll_id as string] = Number(r.cnt)
  return counts
}

// Atomically advance a cadence template's next_run_date, guarded on it still
// matching the value we read when we decided this template was due. If two
// overlapping cron invocations both see the same due template, only one
// UPDATE affects a row — the other gets rowsAffected === 0 and must skip
// creating/sending anything for this cycle.
export async function claimRegularPollRun(id: string, expectedCurrentNextRunDate: string, newNextRunDate: string): Promise<boolean> {
  const result = await getDb().execute({
    sql: `UPDATE regular_polls SET next_run_date = ?, updated_at = ? WHERE id = ? AND next_run_date = ?`,
    args: [newNextRunDate, new Date().toISOString(), id, expectedCurrentNextRunDate],
  })
  return result.rowsAffected === 1
}

export async function updateRegularPoll(id: string, fields: Partial<Omit<RegularPoll, 'id' | 'created_at'>>): Promise<void> {
  const now = new Date().toISOString()
  const allowed = ['name', 'description', 'frequency', 'scheduled_day', 'department', 'subject',
    'draft_email_body', 'questions', 'recipients', 'ms_form_link', 'next_run_date', 'last_run_date', 'is_active', 'auto_approve']
  const setClauses: string[] = ['updated_at = ?']
  const args: (string | number | null)[] = [now]
  for (const [key, value] of Object.entries(fields)) {
    if (allowed.includes(key)) {
      setClauses.push(`${key} = ?`)
      args.push(value as string | number | null)
    }
  }
  args.push(id)
  await getDb().execute({ sql: `UPDATE regular_polls SET ${setClauses.join(', ')} WHERE id = ?`, args })
}

// ─── Top Voters (poll participation leaderboard) ──────────────────────────────
// Same aggregation as app/api/participation/route.ts (poll_responses joined
// against the employees cache by email), but scoped to a date range and
// limited to the top N — used to fold a "most active voters this month"
// section into the Kites votes report email.

export interface TopVoterRow {
  full_name: string
  email: string
  department_name: string | null
  designation_name: string | null
  voteCount: number
}

export async function getTopVotersInRange(startIso: string, endIsoExclusive: string, limit = 5): Promise<TopVoterRow[]> {
  const db = getDb()

  const respResult = await db.execute('SELECT response_data FROM poll_responses')
  const empResult = await db.execute('SELECT first_name, last_name, email_address, department_name, designation_name FROM employees')

  const empByEmail = new Map<string, { first_name: string | null; last_name: string | null; department_name: string | null; designation_name: string | null }>()
  for (const row of empResult.rows) {
    const email = (row.email_address as string | null)?.toLowerCase().trim()
    if (email) empByEmail.set(email, row as unknown as { first_name: string | null; last_name: string | null; department_name: string | null; designation_name: string | null })
  }

  const countByEmail = new Map<string, number>()
  for (const row of respResult.rows) {
    const responseData = row.response_data as string | null
    if (!responseData) continue
    let entries: Array<{ email?: string; submitted_at?: string }> = []
    try { entries = JSON.parse(responseData) } catch { continue }
    for (const entry of entries) {
      const email = (entry.email ?? '').toLowerCase().trim()
      if (!email || !entry.submitted_at) continue
      if (entry.submitted_at < startIso || entry.submitted_at >= endIsoExclusive) continue
      countByEmail.set(email, (countByEmail.get(email) ?? 0) + 1)
    }
  }

  return [...countByEmail.entries()]
    .map(([email, voteCount]) => {
      const emp = empByEmail.get(email)
      const full_name = emp ? `${emp.first_name ?? ''} ${emp.last_name ?? ''}`.trim() || email : email
      return {
        full_name,
        email,
        department_name: emp?.department_name ?? null,
        designation_name: emp?.designation_name ?? null,
        voteCount,
      }
    })
    .sort((a, b) => b.voteCount - a.voteCount)
    .slice(0, limit)
}

// ─── Email dedup ──────────────────────────────────────────────────────────────

export async function pollEmailAlreadyProcessed(emailThreadId: string): Promise<boolean> {
  const result = await getDb().execute({
    sql: 'SELECT id FROM polls WHERE email_thread_id = ?',
    args: [emailThreadId],
  })
  return result.rows.length > 0
}

// Strip Fw:/Re:/Fwd: prefixes (all levels) and trailing punctuation for comparison
function normalizeTopic(s: string): string {
  let prev = ''
  s = s.trim()
  while (s !== prev) {
    prev = s
    s = s.replace(/^(fw|fwd|re|tr|ant):\s*/i, '').trim()
  }
  return s.replace(/\.$/, '').toLowerCase()
}

// Returns true if a non-archived poll with the same normalized topic was created in the last 30 days.
// Catches forwarded duplicates that would otherwise bypass the conversationId dedup.
export async function pollTopicAlreadyExists(rawTopic: string): Promise<boolean> {
  const normalized = normalizeTopic(rawTopic)
  const result = await getDb().execute({
    sql: `SELECT topic FROM polls WHERE status != 'ARCHIVED' AND created_at > datetime('now', '-30 days')`,
    args: [],
  })
  return result.rows.some(row => normalizeTopic(String(row.topic ?? '')) === normalized)
}

// Returns the subset of the given Graph message IDs that the detector has
// already looked at, for the given category ('poll' | 'kgt'). Used instead of
// the mailbox's isRead flag, which anyone with mailbox access can flip —
// silently hiding a genuine request from every future scan with no record it
// ever arrived.
export async function getProcessedMessageIds(category: string, messageIds: string[]): Promise<Set<string>> {
  if (messageIds.length === 0) return new Set()
  const placeholders = messageIds.map(() => '?').join(', ')
  const result = await getDb().execute({
    sql: `SELECT message_id FROM processed_inbox_messages WHERE category = ? AND message_id IN (${placeholders})`,
    args: [category, ...messageIds],
  })
  return new Set(result.rows.map(row => String(row.message_id)))
}

export async function markMessageProcessed(category: string, messageId: string): Promise<void> {
  await getDb().execute({
    sql: 'INSERT OR IGNORE INTO processed_inbox_messages (message_id, category) VALUES (?, ?)',
    args: [messageId, category],
  })
}
