import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db/client'

export async function GET() {
  const db = getDb()

  const [pollsRes, regularPollsRes, feedbackRes, kpiRes, responsesRes] = await Promise.all([
    db.execute({ sql: 'SELECT id, status, rms_task_id, results_uploaded_at, closed_at FROM polls WHERE status != ? ORDER BY created_at DESC', args: ['ARCHIVED'] }),
    db.execute('SELECT id, frequency, is_active, next_run_date, last_run_date FROM regular_polls').catch(() => ({ rows: [] })),
    db.execute('SELECT id, type, status, category, rms_task_id, task_pending, followup_done, summary, submitted_by, department, poll_title FROM feedback_items ORDER BY created_at DESC').catch(() => ({ rows: [] })),
    db.execute("SELECT process_improvements, rms_improvements, policy_announced FROM kpi_data WHERE id = 'singleton'").catch(() => ({ rows: [] })),
    db.execute('SELECT response_data FROM poll_responses').catch(() => ({ rows: [] })),
  ])

  const polls = pollsRes.rows as unknown as Array<{
    id: string
    status: string
    rms_task_id: string | null
    results_uploaded_at: string | null
    closed_at: string | null
  }>

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
  const resultNotSentSir = polls.filter(p => CLOSED_STATUSES.includes(p.status) && !p.rms_task_id).length
  const resultNotSentVoter = polls.filter(p => p.status === 'CLOSED').length // CLOSED = not yet RESULTS_UPLOADED

  const totalPolls = polls.length
  const totalPending = polls.filter(p => PENDING_STATUSES.includes(p.status)).length

  // Count individual poll responses across all polls
  const totalSuggestionsReceived = (responsesRes.rows as unknown as Array<{ response_data: string | null }>)
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

  // Feedback breakdown
  const totalSuggestions = feedbackItems.length
  const totalResponses = totalSuggestionsReceived
  const pendingForAction = feedbackItems.filter(f => f.status === 'Open' || f.status === 'In Progress').length
  const processImproved = Number(kpiRow?.process_improvements ?? 0)
  const actionable = pendingForAction + processImproved
  const nonActionable = feedbackItems.filter(f => f.type !== 'Actionable' && f.type !== 'Query').length

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
    feedbackPending: {
      rmsTaskRaised,
      actionYetToStart,
      annexurePending,
    },
    actionReport: {
      actionTaken,
      policyImproved,
      queryReplied,
      noActionReq,
      pendingReview,
      totalItems,
    },
  })
}
