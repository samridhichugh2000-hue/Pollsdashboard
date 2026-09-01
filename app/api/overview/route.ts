import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db/client'
import { CLOSED_POLL_STATUSES } from '@/lib/db/queries'
import { deriveAudienceLabel, buildHuntGroupEmailMap, advanceNextRunDate } from '@/lib/utils'

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

  const [pollsRes, regularPollsRes, feedbackRes, kpiRes, responsesRes, huntGroupsRes, cadenceReleaseAuditRes] = await Promise.all([
    db.execute({ sql: 'SELECT id, topic, status, source, requested_by, department, recipient_email, release_emails, created_at, rms_task_id, results_uploaded_at, closed_at, request_type FROM polls WHERE status != ? ORDER BY created_at DESC', args: ['ARCHIVED'] }),
    db.execute('SELECT id, name, frequency, is_active, next_run_date, last_run_date FROM regular_polls').catch(() => ({ rows: [] })),
    db.execute('SELECT id, type, status, category, rms_task_id, task_pending, followup_done, summary, submitted_by, department, poll_title FROM feedback_items ORDER BY created_at DESC').catch(() => ({ rows: [] })),
    db.execute("SELECT process_improvements, rms_improvements, policy_announced FROM kpi_data WHERE id = 'singleton'").catch(() => ({ rows: [] })),
    db.execute('SELECT poll_id, response_data FROM poll_responses').catch(() => ({ rows: [] })),
    db.execute('SELECT name, email FROM hunt_groups').catch(() => ({ rows: [] })),
    // Every actual cadence release (manual "Release" or cron auto-release) leaves
    // one of these, tagged with the originating template's id — the only exact
    // record of "this template fired on this date" (regular_polls itself only
    // tracks last/next run, not history). Used below to count how many times
    // each template actually ran within the selected quarter.
    db.execute("SELECT metadata, created_at FROM audit_logs WHERE action IN ('POLL_RELEASED', 'POLL_AUTO_RELEASED')").catch(() => ({ rows: [] })),
  ])

  const huntGroupsByEmail = buildHuntGroupEmailMap(huntGroupsRes.rows as unknown as { name: string; email: string }[])

  const allPolls = pollsRes.rows as unknown as Array<{
    id: string
    topic: string
    status: string
    source: string | null
    requested_by: string | null
    department: string | null
    recipient_email: string | null
    release_emails: string | null
    created_at: string
    rms_task_id: string | null
    results_uploaded_at: string | null
    closed_at: string | null
    request_type: string | null
  }>

  // Filter polls to the selected quarter (by creation date); responses follow their poll.
  const polls = allPolls.filter(p => inRange(p.created_at))
  const totalKGTs = polls.filter(p => p.request_type === 'KGT').length

  const regularPolls = regularPollsRes.rows as unknown as Array<{
    id: string
    name: string
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
  const PENDING_STATUSES = ['DETECTED', 'DRAFT', 'FORM_CREATED', 'AWAITING_APPROVAL', 'APPROVED', 'SCHEDULED', 'RMS_TASK_CREATED', 'REJECTED', 'RMS_TASK_FAILED', 'RMS_PUBLISH_FAILED', 'SEND_FAILED']
  const ACTIVE_STATUSES = ['SENT', 'REMINDER_SENT']
  const CLOSED_STATUSES: string[] = CLOSED_POLL_STATUSES

  const notSentForApproval = polls.filter(p => ['DETECTED', 'DRAFT', 'FORM_CREATED'].includes(p.status)).length
  const approvalPending = polls.filter(p => p.status === 'AWAITING_APPROVAL').length
  const activePolls = polls.filter(p => ACTIVE_STATUSES.includes(p.status)).length
  const pollsClosed = polls.filter(p => CLOSED_STATUSES.includes(p.status)).length
  const resultNotSentSir = polls.filter(p => p.status === 'CLOSED').length

  const totalPolls = polls.length
  const totalPending = polls.filter(p => PENDING_STATUSES.includes(p.status)).length

  // Cadence-originated polls are regular `polls` rows just like manual ones —
  // the only marker is requested_by, set to this exact literal by both the
  // manual RELEASE action and the auto-release cron (see
  // app/api/regular-polls/[id]/route.ts and
  // app/api/cron/regular-poll-scheduler/route.ts). Always sums to totalPolls.
  const cadenceOriginatedPolls = polls.filter(p => p.requested_by === 'Regular Poll (Auto)').length
  const manualPolls = totalPolls - cadenceOriginatedPolls

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

  // Cadence breakdown — counts actual/expected RUNS in the selected range, not
  // template count, so a monthly template contributes once per month it fires
  // rather than once total (a quarterly template still only contributes once
  // per quarter it's due). Combines:
  //  1. Already-run releases this range, from the audit log (exact — tagged
  //     with the originating template's id at release time).
  //  2. Still-upcoming releases this range, projected forward from each
  //     active template's next_run_date using the same date math the
  //     scheduler itself uses (advanceNextRunDate). Only meaningful for a
  //     bounded range — with no quarter selected (all-time) this is skipped,
  //     since "future occurrences" has no natural cutoff.
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const regularPollById = new Map(regularPolls.map(p => [p.id, p]))

  const cadenceRunsByTemplate = new Map<string, number>()
  for (const row of cadenceReleaseAuditRes.rows as unknown as Array<{ metadata: string | null; created_at: string }>) {
    if (!inRange(row.created_at)) continue
    let meta: { regular_poll_id?: string }
    try { meta = JSON.parse(row.metadata ?? '{}') as { regular_poll_id?: string } } catch { continue }
    if (!meta.regular_poll_id) continue // a manual (non-cadence) release
    cadenceRunsByTemplate.set(meta.regular_poll_id, (cadenceRunsByTemplate.get(meta.regular_poll_id) ?? 0) + 1)
  }

  if (toMs != null) {
    const rangeEnd = new Date(toMs)
    for (const p of regularPolls) {
      if (!p.is_active) continue
      let runDate = new Date(p.next_run_date)
      let guard = 0
      while (runDate <= rangeEnd && guard < 24) {
        if (inRange(runDate.toISOString())) {
          cadenceRunsByTemplate.set(p.id, (cadenceRunsByTemplate.get(p.id) ?? 0) + 1)
        }
        runDate = new Date(advanceNextRunDate(runDate.toISOString().split('T')[0], p.frequency))
        guard++
      }
    }
  }

  let totalCadence = 0, monthly = 0, quarterly = 0, biAnnual = 0, annual = 0
  for (const [templateId, count] of cadenceRunsByTemplate) {
    totalCadence += count
    switch (regularPollById.get(templateId)?.frequency) {
      case 'monthly': monthly += count; break
      case 'quarterly': quarterly += count; break
      case 'bi-annual': biAnnual += count; break
      case 'annual': annual += count; break
      // A template deleted since it ran still counts toward the total, just not a frequency bucket.
    }
  }

  const scheduledReleased = regularPolls.filter(p => p.is_active === 1 && p.last_run_date != null).length
  const overdueRegular = regularPolls.filter(p => {
    if (!p.is_active) return false
    const d = new Date(p.next_run_date); d.setHours(0, 0, 0, 0)
    return d <= today
  }).length

  // Suggestion breakdown — parse all response_data entries (same source as feedback page)
  interface ResponseEntry {
    actionable?: boolean | null
    status?: string | null
    reply_sent_at?: string | null
    classification?: string | null
    respondent?: string
    email?: string
    answers?: { question: string; answer: string }[]
  }
  const pollTopicById = new Map(polls.map(p => [p.id, p.topic]))
  const allEntries: ResponseEntry[] = []
  const taggedEntries: (ResponseEntry & { pollTopic: string })[] = []
  for (const row of responseRows) {
    try {
      const entries = JSON.parse(row.response_data ?? '[]') as ResponseEntry[]
      const topic = pollTopicById.get(row.poll_id) ?? 'Unknown poll'
      for (const e of entries) {
        allEntries.push(e)
        taggedEntries.push({ ...e, pollTopic: topic })
      }
    } catch { /* skip */ }
  }
  const totalSuggestions = allEntries.length
  const totalResponses = totalSuggestionsReceived
  const actionable = allEntries.filter(e => e.actionable === true).length
  const pendingForAction = allEntries.filter(e => e.actionable == null && e.status !== 'completed').length
  // "Process Improvement" = responses classified Non-RMS (per user: Non-RMS
  // Improvement and Process Improvement are the same thing); "RMS
  // Improvement" = responses classified RMS. Both now read the real
  // classification field instead of the disconnected status flag / manual
  // kpi_data counter, so these stay in sync with the Poll Responses page.
  const processImproved = allEntries.filter(e => e.classification === 'non_rms').length
  const rmsClassified = allEntries.filter(e => e.classification === 'rms').length
  const nonActionable = allEntries.filter(e => e.actionable === false).length
  const resultNotSentVoter = allEntries.filter(e => !e.reply_sent_at).length

  const rmsEntries = taggedEntries.filter(e => e.classification === 'rms')
  const nonRmsEntries = taggedEntries.filter(e => e.classification === 'non_rms')

  // Polls with pending feedback — responses where actionable is null (not yet reviewed), grouped by poll
  const pollMap2 = new Map(polls.map(p => [p.id, p.topic]))
  const pendingByPoll = new Map<string, { poll_title: string | null; count: number; poll_id: string | null }>()
  for (const row of responseRows) {
    let entries: ResponseEntry[] = []
    try { entries = JSON.parse(row.response_data ?? '[]') as ResponseEntry[] } catch { continue }
    const pendingCount = entries.filter(e => e.actionable == null && e.status !== 'completed').length
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
      department: deriveAudienceLabel(p, huntGroupsByEmail),
      source: p.source ?? 'dashboard',
      createdAt: p.created_at,
      status: p.status,
    }))

  return NextResponse.json({
    kpi: {
      totalPolls,
      cadenceOriginatedPolls,
      manualPolls,
      totalPending,
      totalSuggestions: totalResponses,
      suggestionsPendingReview: pendingForAction,
      processImprovements: processImproved,
      rmsImprovements: rmsClassified,
      totalKGTs,
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
    rmsEntries: rmsEntries.map(e => ({ pollTopic: e.pollTopic, respondent: e.respondent, email: e.email, answers: e.answers ?? [] })),
    nonRmsEntries: nonRmsEntries.map(e => ({ pollTopic: e.pollTopic, respondent: e.respondent, email: e.email, answers: e.answers ?? [] })),
  })
}
