'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  ClipboardList, Clock, MessageSquare, TrendingUp, BarChart3, Zap,
  CalendarClock, ChevronDown, ChevronUp, Loader2
} from 'lucide-react'

interface OverviewData {
  kpi: {
    totalPolls: number
    totalPending: number
    totalSuggestions: number
    suggestionsPendingReview: number
    processImprovements: number
    rmsImprovements: number
  }
  pollBreakdown: {
    notSentForApproval: number
    approvalPending: number
    activePolls: number
    pollsClosed: number
    resultNotSentSir: number
    resultNotSentVoter: number
  }
  cadenceBreakdown: {
    total: number
    monthly: number
    quarterly: number
    biAnnual: number
    annual: number
    scheduledReleased: number
    overdue: number
  }
  suggestionBreakdown: {
    total: number
    actionable: number
    pendingForAction: number
    processImproved: number
    nonActionable: number
  }
  feedbackPending: {
    rmsTaskRaised: FeedbackItem[]
    actionYetToStart: FeedbackItem[]
    annexurePending: FeedbackItem[]
  }
  actionReport: {
    actionTaken: number
    policyImproved: number
    queryReplied: number
    noActionReq: number
    pendingReview: number
    totalItems: number
  }
}

interface FeedbackItem {
  id: string
  summary: string | null
  submitted_by: string | null
  department: string | null
  poll_title: string | null
  rms_task_id: string | null
  task_pending: number | null
  followup_done: number | null
}

const defaultData: OverviewData = {
  kpi: { totalPolls: 0, totalPending: 0, totalSuggestions: 0, suggestionsPendingReview: 0, processImprovements: 0, rmsImprovements: 0 },
  pollBreakdown: { notSentForApproval: 0, approvalPending: 0, activePolls: 0, pollsClosed: 0, resultNotSentSir: 0, resultNotSentVoter: 0 },
  cadenceBreakdown: { total: 0, monthly: 0, quarterly: 0, biAnnual: 0, annual: 0, scheduledReleased: 0, overdue: 0 },
  suggestionBreakdown: { total: 0, actionable: 0, pendingForAction: 0, processImproved: 0, nonActionable: 0 },
  feedbackPending: { rmsTaskRaised: [], actionYetToStart: [], annexurePending: [] },
  actionReport: { actionTaken: 0, policyImproved: 0, queryReplied: 0, noActionReq: 0, pendingReview: 0, totalItems: 0 },
}

function BreakdownRow({ label, value, color = 'bg-slate-400', href }: { label: string; value: number; color?: string; href?: string }) {
  const router = useRouter()
  return (
    <div
      onClick={href ? () => router.push(href) : undefined}
      className={`flex items-center justify-between py-2.5 border-b border-gray-50 last:border-0 ${href ? 'cursor-pointer hover:bg-gray-50 rounded-lg px-1 -mx-1 transition-colors' : ''}`}
    >
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full flex-shrink-0 ${color}`} />
        <span className="text-sm text-gray-600">{label}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-sm font-bold text-gray-900">{value}</span>
        {href && <span className="text-xs text-gray-300">→</span>}
      </div>
    </div>
  )
}

function FeedbackCategory({
  title, items, color, expandedBg,
}: {
  title: string
  items: FeedbackItem[]
  color: string
  expandedBg: string
}) {
  const [open, setOpen] = useState(false)
  if (items.length === 0) return null
  return (
    <div className="border border-gray-100 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${color}`}>{items.length}</span>
          <span className="text-sm font-semibold text-gray-800">{title}</span>
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
      </button>
      {open && (
        <div className={`divide-y divide-gray-100 ${expandedBg}`}>
          {items.map(item => (
            <div key={item.id} className="px-4 py-3 grid grid-cols-2 gap-x-4 gap-y-1">
              <div className="col-span-2">
                <p className="text-sm font-medium text-gray-800">{item.summary ?? '—'}</p>
                <p className="text-xs text-gray-500">{item.poll_title ?? ''}{item.department ? ` · ${item.department}` : ''}</p>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-gray-600">
                <span className="font-medium">RMS Task ID:</span>
                <span>{item.rms_task_id ?? 'N/A'}</span>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-gray-600">
                <span className="font-medium">Task Pending:</span>
                <span className={item.task_pending ? 'text-red-600 font-semibold' : 'text-emerald-600'}>
                  {item.task_pending ? 'Yes' : 'No'}
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-gray-600">
                <span className="font-medium">Follow-up:</span>
                <span className={item.followup_done ? 'text-emerald-600 font-semibold' : 'text-amber-600'}>
                  {item.followup_done ? 'Done' : 'Pending'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function DashboardPage() {
  const router = useRouter()
  const [data, setData] = useState<OverviewData>(defaultData)
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(() =>
    fetch('/api/overview')
      .then(r => r.ok ? r.json() : defaultData)
      .then((d: OverviewData) => setData(d))
      .catch(console.error)
  , [])

  useEffect(() => {
    fetchData().finally(() => setLoading(false))
    const interval = setInterval(fetchData, 60_000)
    return () => clearInterval(interval)
  }, [fetchData])

  const kpiCards = [
    {
      label: 'Total Polls',
      value: data.kpi.totalPolls,
      icon: ClipboardList,
      color: 'text-purple-600',
      iconBg: 'bg-purple-50',
      onClick: () => router.push('/poll-requests?card=total'),
    },
    {
      label: 'Total Pending Polls',
      value: data.kpi.totalPending,
      icon: Clock,
      color: 'text-cyan-600',
      iconBg: 'bg-cyan-50',
      onClick: () => router.push('/poll-requests'),
    },
    {
      label: 'Total Suggestions Received',
      value: data.kpi.totalSuggestions,
      icon: MessageSquare,
      color: 'text-blue-600',
      iconBg: 'bg-blue-50',
      onClick: undefined,
    },
    {
      label: 'Suggestions Pending Review',
      value: data.kpi.suggestionsPendingReview,
      icon: BarChart3,
      color: 'text-amber-600',
      iconBg: 'bg-amber-50',
      onClick: undefined,
    },
    {
      label: 'Process Improvement',
      value: data.kpi.processImprovements,
      icon: TrendingUp,
      color: 'text-emerald-600',
      iconBg: 'bg-emerald-50',
      onClick: undefined,
    },
    {
      label: 'RMS Improvement',
      value: data.kpi.rmsImprovements,
      icon: Zap,
      color: 'text-teal-600',
      iconBg: 'bg-teal-50',
      onClick: undefined,
    },
  ]

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-cyan-500" />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* KPI Row */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {kpiCards.map(({ label, value, icon: Icon, color, iconBg, onClick }) => (
          <div
            key={label}
            onClick={onClick}
            className={`rounded-2xl bg-white px-4 py-5 shadow-[0_8px_30px_rgba(0,0,0,0.12)] transition-transform duration-200 hover:-translate-y-0.5 ${onClick ? 'cursor-pointer hover:ring-2 hover:ring-offset-1 hover:ring-cyan-300' : ''}`}
          >
            <div className={`mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl ${iconBg}`}>
              <Icon className={`h-5 w-5 ${color}`} />
            </div>
            <div className={`text-3xl font-bold ${color}`}>{value}</div>
            <p className="mt-1 text-sm font-medium text-gray-700">{label}</p>
            {onClick && <p className="text-xs text-gray-400 mt-0.5">Click to view →</p>}
          </div>
        ))}
      </div>

      {/* 3 Breakdown Tables */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Poll Breakdown */}
        <div className="rounded-2xl bg-white shadow-[0_8px_30px_rgba(0,0,0,0.12)] px-5 py-4">
          <div className="flex items-center gap-2 mb-4 pb-3 border-b border-gray-100">
            <ClipboardList className="h-4 w-4 text-purple-500" />
            <h2 className="font-semibold text-gray-900">Total Polls Breakdown</h2>
          </div>
          <BreakdownRow label="Not Sent for Approval" value={data.pollBreakdown.notSentForApproval} color="bg-gray-400"    href="/poll-requests?card=not-sent" />
          <BreakdownRow label="Approval Pending"       value={data.pollBreakdown.approvalPending}    color="bg-amber-400"   href="/poll-requests?card=approval-pending" />
          <BreakdownRow label="Active Polls"           value={data.pollBreakdown.activePolls}        color="bg-emerald-400" href="/poll-requests?card=active" />
          <BreakdownRow label="Polls Closed"           value={data.pollBreakdown.pollsClosed}        color="bg-slate-400"   href="/poll-requests?card=closed" />
          <BreakdownRow label="Result Not Sent to Sir" value={data.pollBreakdown.resultNotSentSir}   color="bg-orange-400"  href="/poll-requests?card=result-sir" />
          <BreakdownRow label="Result Not Sent to Voter" value={data.pollBreakdown.resultNotSentVoter} color="bg-red-400"   href="/poll-requests?card=result-voter" />
        </div>

        {/* Cadence Breakdown */}
        <div className="rounded-2xl bg-white shadow-[0_8px_30px_rgba(0,0,0,0.12)] px-5 py-4">
          <div className="flex items-center gap-2 mb-4 pb-3 border-b border-gray-100">
            <CalendarClock className="h-4 w-4 text-cyan-500" />
            <h2 className="font-semibold text-gray-900">Cadence Breakdown</h2>
          </div>
          <BreakdownRow label="Total Cadence" value={data.cadenceBreakdown.total} color="bg-cyan-400" />
          <BreakdownRow label="Monthly" value={data.cadenceBreakdown.monthly} color="bg-blue-400" />
          <BreakdownRow label="Quarterly" value={data.cadenceBreakdown.quarterly} color="bg-indigo-400" />
          {data.cadenceBreakdown.biAnnual > 0 && <BreakdownRow label="Bi-Annual" value={data.cadenceBreakdown.biAnnual} color="bg-violet-400" />}
          {data.cadenceBreakdown.annual > 0 && <BreakdownRow label="Annual" value={data.cadenceBreakdown.annual} color="bg-purple-400" />}
          <BreakdownRow label="Scheduled & Released" value={data.cadenceBreakdown.scheduledReleased} color="bg-emerald-400" />
          <BreakdownRow label="Overdue" value={data.cadenceBreakdown.overdue} color="bg-red-400" />
        </div>

        {/* Suggestion Breakdown */}
        <div className="rounded-2xl bg-white shadow-[0_8px_30px_rgba(0,0,0,0.12)] px-5 py-4">
          <div className="flex items-center gap-2 mb-4 pb-3 border-b border-gray-100">
            <MessageSquare className="h-4 w-4 text-blue-500" />
            <h2 className="font-semibold text-gray-900">Suggestion Breakdown</h2>
          </div>
          <BreakdownRow label="Total" value={data.suggestionBreakdown.total} color="bg-blue-400" />
          <BreakdownRow label="Actionable" value={data.suggestionBreakdown.actionable} color="bg-orange-400" />
          <BreakdownRow label="Pending for Action" value={data.suggestionBreakdown.pendingForAction} color="bg-amber-400" />
          <BreakdownRow label="Process Improved" value={data.suggestionBreakdown.processImproved} color="bg-emerald-400" />
          <BreakdownRow label="Non-Actionable" value={data.suggestionBreakdown.nonActionable} color="bg-slate-400" />
        </div>
      </div>

      {/* Feedback Pending for Review */}
      <div id="feedback-pending" className="rounded-2xl bg-white shadow-[0_8px_30px_rgba(0,0,0,0.12)] px-5 py-4">
        <div className="flex items-center gap-2 mb-4 pb-3 border-b border-gray-100">
          <MessageSquare className="h-4 w-4 text-amber-500" />
          <h2 className="font-semibold text-gray-900">Feedback Pending for Review</h2>
          <span className="ml-auto text-xs text-gray-400">
            {data.feedbackPending.rmsTaskRaised.length + data.feedbackPending.actionYetToStart.length + data.feedbackPending.annexurePending.length} items
          </span>
        </div>
        {data.feedbackPending.rmsTaskRaised.length === 0 &&
         data.feedbackPending.actionYetToStart.length === 0 &&
         data.feedbackPending.annexurePending.length === 0 ? (
          <p className="text-center py-8 text-sm text-gray-400">No feedback pending for review</p>
        ) : (
          <div className="space-y-2">
            <FeedbackCategory
              title="RMS Task Raised"
              items={data.feedbackPending.rmsTaskRaised}
              color="bg-orange-100 text-orange-700"
              expandedBg="bg-orange-50"
            />
            <FeedbackCategory
              title="Action Yet to Start"
              items={data.feedbackPending.actionYetToStart}
              color="bg-amber-100 text-amber-700"
              expandedBg="bg-amber-50"
            />
            <FeedbackCategory
              title="Annexure Pending from Sir"
              items={data.feedbackPending.annexurePending}
              color="bg-red-100 text-red-700"
              expandedBg="bg-red-50"
            />
          </div>
        )}
      </div>
    </div>
  )
}
