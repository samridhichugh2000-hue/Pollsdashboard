import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db/client'

export async function GET(req: NextRequest) {
  const db = getDb()

  // Optional quarter bounds (ISO). When present, restrict polls (by created_at)
  // and their responses to the selected range.
  const fromParam = req.nextUrl.searchParams.get('from')
  const toParam = req.nextUrl.searchParams.get('to')
  const fromMs = fromParam ? new Date(fromParam).getTime() : null
  const toMs = toParam ? new Date(toParam).getTime() : null
  const inRange = (dateStr: string | null | undefined): boolean => {
    if (fromMs == null && toMs == null) return true
    if (!dateStr) return false
    const t = new Date(dateStr).getTime()
    if (Number.isNaN(t)) return false
    if (fromMs != null && t < fromMs) return false
    if (toMs != null && t > toMs) return false
    return true
  }

  const [pollsRes, regularPollsRes, feedbackRes, kpiRes, responsesRes] = await Promise.all([
    db.execute({ sql: 'SELECT id, topic, status, source, requested_by, department, created_at, rms_task_id, results_uploaded_at, closed_at FROM polls WHERE status != ? ORDER BY created_at DESC', args: ['ARCHIVED'] }),
    db.execute('SELECT id, frequency, is_active, next_run_date, last_run_date FROM regular_polls').catch(() => ({ rows: [] })),
    db.execute('SELECT id, type, status, category, rms_task_id, task_pending, followup_done, summary, submitted_by, department, poll_title FROM feedback_items ORDER BY created_at DESC').catch(() => ({ rows: [] })),
    db.execute("SELECT process_improvements, rms_improvements, policy_announced FROM kpi_data WHERE id = 'singleton'").catch(() => ({ rows: [] })),
    db.execute('SELECT poll_id, response_data FROM poll_responses').catch(() => ({ rows: [] })),
  ])

  const allPolls = pollsRes.rows as unknown as Array<{
    id: string
    topic: string
    status: string
    source: string | null
    requested_by: string | null
    department: string | null
    created_at: string
    rms_task_id: string | null
    results_uploaded_at: string | null
    closed_at: string | null
  }>

  // Filter polls to the selected quarter (by creation date); responses follow their poll.
  const polls = allPolls.filter(p => inRange(p.created_at))

  const regularPolls = regularPollsRes.rows as unknown as Array<{
    id: string
    frequency: string
    is_active: number
    next_run_date: string
    last_run_date: string | null
  }>

  const feedbackItems = feedbackRes.rows as unknown as Array<{
    id: string
    type: string | null
    status: string | null
    category: string | null
    rms_task_id: string | null
    task_pending: number | null
    followup_done: number | null
    summary: string | null
    submitted_by: string | null
    department: string | null
    poll_title: string | null
  }>

  const kpiRow = kpiRes.rows[0] as unknown as { process_improvements: number; rms_improvements: number; policy_announced: number } | undefined

  // Poll breakdown
  const PENDING_STATUSES = ['DETECTED', 'DRAFT', 'FORM_CREATED', 'AWAITING_APPROVAL', 'APPROVED', 'RMS_TASK_CREATED', 'REJECTED', 'RMS_TASK_FAILED', 'RMS_PUBLISH_FAILED', 'SEND_FAILED']
  const ACTIVE_STATUSES = ['SENT', 'REMINDER_SENT', 'RMS_PUBLISHED']
  const CLOSED_STATUSES = ['CLOSED', 'RESULTS_UPLOADED', 'RESULTS_SHARED']

  const notSentForApproval = polls.filter(p => ['DETECTED', 'DRAFT', 'FORM_CREATED'].includes(p.status)).length
  const approvalPending = polls.filter(p => p.status === 'AWAITING_APPROVAL').length
  const activePolls = polls.filter(p => ACTIVE_STATUSES.includes(p.status)).length
  const pollsClosed = polls.filter(p => CLOSED_STATUSES.includes(p.status)).length
  const resultNotSentSir = polls.filter(p => p.status === 'CLOSED').length

  const totalPolls = polls.length
  const totalPending = polls.filter(p => PENDING_STATUSES.includes(p.status)).length

  const pollIdSet = new Set(polls.map(p => p.id))
  const responseRows = (responsesRes.rows as unknown as Array<{ poll_id: string; response_data: string | null }>)
    .filter(r => pollIdSet.has(r.poll_id))
  const openPollIds = new Set(polls.filter(p => !CLOSED_STATUSES.includes(p.status)).map(p => p.id))

  // Count individual poll responses across all polls
  const totalSuggestionsReceived = responseRows
    .reduce((sum, row) => {
      try { return sum + (JSON.parse(row.response_data ?? '[]') as unknown[]).length } catch { return sum }
    }, 0)

  // Responses from polls not yet closed
  const responsesPendingReview = responseRows
    .filter(row => openPollIds.has(row.poll_id))
    .reduce((sum, row) => {
      try { return sum + (JSON.parse(row.response_data ?? '[]') as unknown[]).length } catch { return sum }
    }, 0)

  // Cadence breakdown
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const totalCadence = regularPolls.length
  const monthly = regularPolls.filter(p => p.frequency === 'monthly').length
  const quarterly = regularPolls.filter(p => p.frequency === 'quarterly').length
  const biAnnual = regularPolls.filter(p => p.frequency === 'bi-annual').length
  const annual = regularPolls.filter(p => p.frequency === 'annual').length
  const scheduledReleased = regularPolls.filter(p => p.is_active === 1 && p.last_run_date != null).length
  const overdueRegular = regularPolls.filter(p => {
    if (!p.is_active) return false
    const d = new Date(p.next_run_date); d.setHours(0, 0, 0, 0)
    return d <= today
  }).length

  // Suggestion breakdown — parse all response_data entries (same source as feedback page)
  interface ResponseEntry { actionable?: boolean | null; status?: string | null; reply_sent_at?: string | null }
  const allEntries: ResponseEntry[] = []
  for (const row of responseRows) {
    try { (JSON.parse(row.response_data ?? '[]') as ResponseEntry[]).forEach(e => allEntries.push(e)) } catch { /* skip */ }
  }
  const totalSuggestions = allEntries.length
  const totalResponses = totalSuggestionsReceived
  const actionable = allEntries.filter(e => e.actionable === true).length
  const pendingForAction = allEntries.filter(e => e.actionable == null).length
  const processImproved = allEntries.filter(e => e.status === 'process-improved').length
  const nonActionable = allEntries.filter(e => e.actionable === false).length
  const resultNotSentVoter = allEntries.filter(e => !e.reply_sent_at).length

  // Polls with pending feedback — responses where actionable is null (not yet reviewed), grouped by poll
  const pollMap2 = new Map(polls.map(p => [p.id, p.topic]))
  const pendingByPoll = new Map<string, { poll_title: string | null; count: number; poll_id: string | null }>()
  for (const row of responseRows) {
    let entries: ResponseEntry[] = []
    try { entries = JSON.parse(row.response_data ?? '[]') as ResponseEntry[] } catch { continue }
    const pendingCount = entries.filter(e => e.actionable == null).length
    if (pendingCount === 0) continue
    const poll_id = row.poll_id
    const poll_title = pollMap2.get(poll_id) ?? null
    const existing = pendingByPoll.get(poll_id)
    if (existing) existing.count += pendingCount
    else pendingByPoll.set(poll_id, { poll_title, poll_id, count: pendingCount })
  }
  const pollsWithFeedbackPending = [...pendingByPoll.values()]
    .sort((a, b) => b.count - a.count)

  // Feedback pending categories
  const rmsTaskRaised = feedbackItems.filter(f => f.category === 'RMS Task Raised')
  const actionYetToStart = feedbackItems.filter(f => f.category === 'Action Yet to Start')
  const annexurePending = feedbackItems.filter(f => f.category === 'Annexure Pending from Sir')

  // Action report widget
  const actionTaken = feedbackItems.filter(f => f.status === 'Closed' && f.type === 'Actionable').length
  const policyImproved = Number(kpiRow?.policy_announced ?? 0)
  const queryReplied = feedbackItems.filter(f => f.type === 'Query' && f.status === 'Closed').length
  const noActionReq = feedbackItems.filter(f => f.type !== 'Actionable' && f.status === 'Closed').length
  const pendingReview = pendingForAction
  const totalItems = totalSuggestions

  // Pending polls list for table
  const allSorted = [...polls].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
  const pendingPolls = polls
    .filter(p => PENDING_STATUSES.includes(p.status))
    .map(p => ({
      id: p.id,
      pollNo: `POLL-${new Date(p.created_at).getFullYear()}-${String(allSorted.findIndex(s => s.id === p.id) + 1).padStart(3, '0')}`,
      topic: p.topic,
      requestedBy: p.requested_by ?? '—',
      department: p.department ?? '—',
      source: p.source ?? 'dashboard',
      createdAt: p.created_at,
      status: p.status,
    }))

  return NextResponse.json({
    kpi: {
      totalPolls,
      totalPending,
      totalSuggestions: totalResponses,
      suggestionsPendingReview: pendingForAction,
      processImprovements: processImproved,
      rmsImprovements: Number(kpiRow?.rms_improvements ?? 0),
    },
    pollBreakdown: {
      notSentForApproval,
      approvalPending,
      activePolls,
      pollsClosed,
      resultNotSentSir,
      resultNotSentVoter,
    },
    cadenceBreakdown: {
      total: totalCadence,
      monthly,
      quarterly,
      biAnnual,
      annual,
      scheduledReleased,
      overdue: overdueRegular,
    },
    suggestionBreakdown: {
      total: totalSuggestions,
      actionable,
      pendingForAction,
      processImproved,
      nonActionable,
    },
    pollsWithFeedbackPending,
    feedbackPending: {
      rmsTaskRaised,
      actionYetToStart,
      annexurePending,
    },
    pendingPolls,
  })
}
