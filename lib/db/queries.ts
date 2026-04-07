import { getDb } from './client'
import type { Poll, PollApproval, PollResponse, User, AuditLog, PollStatus, CreatePollInput } from '@/types'
import { v4 as uuidv4 } from 'uuid'

// ─── Polls ───────────────────────────────────────────────────────────────────

export async function getAllPolls(): Promise<Poll[]> {
  const result = await getDb().execute('SELECT * FROM polls ORDER BY created_at DESC')
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
    sql: `INSERT INTO polls (id, topic, department, recipient_email, requested_by, source, email_thread_id, questions, deadline, remarks, single_response, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DETECTED', ?, ?)`,
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
      now,
      now,
    ],
  })

  return (await getPollById(id))!
}

export async function updatePollStatus(id: string, status: PollStatus, extra?: Record<string, string | null>): Promise<void> {
  const now = new Date().toISOString()
  const setClauses = ['status = ?', 'updated_at = ?']
  const args: (string | null)[] = [status, now]

  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
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

export async function updatePoll(id: string, fields: Partial<Poll>): Promise<void> {
  const now = new Date().toISOString()
  const allowed = [
    'topic', 'department', 'requested_by', 'draft_email_body', 'subject', 'questions',
    'deadline', 'ms_form_id', 'ms_form_link', 'rms_task_id', 'rms_news_id',
    'status', 'sent_at', 'reminder_at', 'reminder_sent_at', 'approved_at',
    'closed_at', 'results_uploaded_at', 'remarks',
  ]
  const setClauses: string[] = ['updated_at = ?']
  const args: (string | null | boolean)[] = [now]

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

export async function getKPIData() {
  const startOfMonth = new Date()
  startOfMonth.setDate(1)
  startOfMonth.setHours(0, 0, 0, 0)
  const iso = startOfMonth.toISOString()
  const db = getDb()

  const [totalRes, approvalRes, activeRes, closedRes, rmsRes, resultsRes] = await Promise.all([
    db.execute({ sql: 'SELECT COUNT(*) as count FROM polls WHERE created_at >= ?', args: [iso] }),
    db.execute({ sql: "SELECT COUNT(*) as count FROM polls WHERE status = 'AWAITING_APPROVAL'", args: [] }),
    db.execute({ sql: "SELECT COUNT(*) as count FROM polls WHERE status IN ('SENT', 'REMINDER_SENT', 'RMS_PUBLISHED')", args: [] }),
    db.execute({ sql: "SELECT COUNT(*) as count FROM polls WHERE status IN ('CLOSED', 'RESULTS_UPLOADED', 'ARCHIVED') AND closed_at >= ?", args: [iso] }),
    db.execute({ sql: 'SELECT COUNT(*) as total, SUM(CASE WHEN rms_task_id IS NOT NULL THEN 1 ELSE 0 END) as created FROM polls WHERE created_at >= ?', args: [iso] }),
    db.execute({ sql: 'SELECT COUNT(*) as total, SUM(CASE WHEN results_uploaded_at IS NOT NULL THEN 1 ELSE 0 END) as uploaded FROM polls WHERE closed_at IS NOT NULL', args: [] }),
  ])

  const total = Number(totalRes.rows[0]?.count ?? 0)
  const rmsTotal = Number((rmsRes.rows[0] as Record<string, unknown>)?.total ?? 0)
  const rmsCreated = Number((rmsRes.rows[0] as Record<string, unknown>)?.created ?? 0)
  const resTotal = Number((resultsRes.rows[0] as Record<string, unknown>)?.total ?? 0)
  const resUploaded = Number((resultsRes.rows[0] as Record<string, unknown>)?.uploaded ?? 0)

  return {
    totalThisMonth: total,
    awaitingApproval: Number(approvalRes.rows[0]?.count ?? 0),
    active: Number(activeRes.rows[0]?.count ?? 0),
    closedThisMonth: Number(closedRes.rows[0]?.count ?? 0),
    rmsTasksCreatedPct: rmsTotal > 0 ? Math.round((rmsCreated / rmsTotal) * 100) : 0,
    resultsUploadedPct: resTotal > 0 ? Math.round((resUploaded / resTotal) * 100) : 0,
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

// ─── Email dedup ──────────────────────────────────────────────────────────────

export async function pollEmailAlreadyProcessed(emailThreadId: string): Promise<boolean> {
  const result = await getDb().execute({
    sql: 'SELECT id FROM polls WHERE email_thread_id = ?',
    args: [emailThreadId],
  })
  return result.rows.length > 0
}
