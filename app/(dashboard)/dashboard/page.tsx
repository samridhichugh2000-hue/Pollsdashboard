'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  ClipboardList, Clock, MessageSquare, TrendingUp, BarChart3, Zap,
  CalendarClock, ChevronDown, ChevronUp, Loader2, ArrowRight, Handshake
} from 'lucide-react'

import Link from 'next/link'
import { useQuarter } from '@/lib/use-quarter'

interface PendingPoll {
  id: string
  pollNo: string
  topic: string
  requestedBy: string
  department: string
  source: string
  createdAt: string
  status: string
}

interface OverviewData {
  kpi: {
    totalPolls: number
    totalPending: number
    totalSuggestions: number
    suggestionsPendingReview: number
    processImprovements: number
    rmsImprovements: number
    totalKGTs: number
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
  pollsWithFeedbackPending: { poll_title: string | null; poll_id: string | null; count: number }[]
  feedbackPending: {
    rmsTaskRaised: FeedbackItem[]
    actionYetToStart: FeedbackItem[]
    annexurePending: FeedbackItem[]
  }
  pendingPolls: PendingPoll[]
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
  kpi: { totalPolls: 0, totalPending: 0, totalSuggestions: 0, suggestionsPendingReview: 0, processImprovements: 0, rmsImprovements: 0, totalKGTs: 0 },
  pollBreakdown: { notSentForApproval: 0, approvalPending: 0, activePolls: 0, pollsClosed: 0, resultNotSentSir: 0, resultNotSentVoter: 0 },
  cadenceBreakdown: { total: 0, monthly: 0, quarterly: 0, biAnnual: 0, annual: 0, scheduledReleased: 0, overdue: 0 },
  suggestionBreakdown: { total: 0, actionable: 0, pendingForAction: 0, processImproved: 0, nonActionable: 0 },
  pollsWithFeedbackPending: [],
  feedbackPending: { rmsTaskRaised: [], actionYetToStart: [], annexurePending: [] },
  pendingPolls: [],
}

function BreakdownRow({ label, value, color = 'bg-slate-400', href }: { label: string; value: number; color?: string; href?: string }) {
  const router = useRouter()
  return (
    <div
      onClick={href ? () => router.push(href) : undefined}
      className={`flex items-center justify-between py-2.5 border-b border-gray-50 dark:border-slate-700/50 last:border-0 ${href ? "cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700/40 rounded-lg px-1 -mx-1 transition-colors" : ""}`}
    >
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full flex-shrink-0 ${color}`} />
        <span className="text-sm text-gray-600 dark:text-slate-300">{label}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-sm font-bold text-gray-900 dark:text-white">{value}</span>
        {href && <span className="text-xs text-gray-300 dark:text-slate-600">→</span>}
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
    <div className="border border-gray-100 dark:border-slate-700 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-slate-700/40 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${color}`}>{items.length}</span>
          <span className="text-sm font-semibold text-gray-800 dark:text-slate-100">{title}</span>
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
  const { from, to } = useQuarter()
  const [data, setData] = useState<OverviewData>(defaultData)
  const [loading, setLoading] = useState(true)
  const [showAllPending, setShowAllPending] = useState(false)

  const fetchData = useCallback((ignoreRef: { current: boolean }) => {
    const params = new URLSearchParams()
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    const qs = params.toString()
    return fetch(`/api/overview${qs ? `?${qs}` : ''}`)
      .then(r => r.ok ? r.json() : defaultData)
      .then((d: OverviewData) => { if (!ignoreRef.current) setData(d) })
      .catch(console.error)
  }, [from, to])

  useEffect(() => {
    // Guard against a slower request for a since-changed quarter resolving
    // after a newer one and overwriting fresh data with stale data.
    const ignoreRef = { current: false }
    fetchData(ignoreRef).finally(() => { if (!ignoreRef.current) setLoading(false) })
    const interval = setInterval(() => void fetchData(ignoreRef), 60_000)
    return () => { ignoreRef.current = true; clearInterval(interval) }
  }, [fetchData])

  const kpiCards = [
    {
      label: 'Total Polls',
      value: data.kpi.totalPolls,
      icon: ClipboardList,
      color: 'text-purple-600',
      iconBg: 'bg-purple-50',
      onClick: () => router.push('/polls?card=total'),
    },
    {
      label: 'Total Pending Polls',
      value: data.kpi.totalPending,
      icon: Clock,
      color: 'text-cyan-600',
      iconBg: 'bg-cyan-50',
      onClick: () => router.push('/polls?card=pending'),
    },
    {
      label: 'Total Suggestions Received',
      value: data.kpi.totalSuggestions,
      icon: MessageSquare,
      color: 'text-blue-600',
      iconBg: 'bg-blue-50',
      onClick: () => router.push('/feedback'),
    },
    {
      label: 'Suggestions Pending Review',
      value: data.kpi.suggestionsPendingReview,
      icon: BarChart3,
      color: 'text-amber-600',
      iconBg: 'bg-amber-50',
      onClick: () => {
        const el = document.getElementById('feedback-pending-section')
        if (el) el.scrollIntoView({ behavior: 'smooth' })
      },
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
    {
      label: 'Total KGTs',
      value: data.kpi.totalKGTs,
      icon: Handshake,
      color: 'text-fuchsia-600',
      iconBg: 'bg-fuchsia-50',
      onClick: () => router.push('/kgt'),
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
            className={`rounded-2xl bg-white dark:bg-[#1e2535] px-4 py-5 shadow-[0_8px_30px_rgba(0,0,0,0.12)] dark:shadow-[0_8px_30px_rgba(0,0,0,0.4)] transition-transform duration-200 hover:-translate-y-0.5 ${onClick ? 'cursor-pointer hover:ring-2 hover:ring-offset-1 hover:ring-purple-400' : ''}`}
          >
            <div className={`mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl ${iconBg}`}>
              <Icon className={`h-5 w-5 ${color}`} />
            </div>
            <div className={`text-3xl font-bold ${color}`}>{value}</div>
            <p className="mt-1 text-sm font-medium text-gray-700 dark:text-slate-300">{label}</p>
            {onClick && <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">Click to view →</p>}
          </div>
        ))}
      </div>

      {/* 3 Breakdown Tables */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Poll Breakdown */}
        <div className="rounded-2xl bg-white dark:bg-[#1e2535] shadow-[0_8px_30px_rgba(0,0,0,0.12)] dark:shadow-[0_8px_30px_rgba(0,0,0,0.4)] px-5 py-4">
          <div className="flex items-center gap-2 mb-4 pb-3 border-b border-gray-100 dark:border-slate-700">
            <ClipboardList className="h-4 w-4 text-purple-500" />
            <h2 className="font-semibold text-gray-900 dark:text-white">Total Polls Breakdown</h2>
          </div>
          <BreakdownRow label="Not Sent for Approval" value={data.pollBreakdown.notSentForApproval} color="bg-gray-400"    href="/polls?card=not-sent" />
          <BreakdownRow label="Approval Pending"       value={data.pollBreakdown.approvalPending}    color="bg-amber-400"   href="/polls?card=approval-pending" />
          <BreakdownRow label="Active Polls"           value={data.pollBreakdown.activePolls}        color="bg-emerald-400" href="/polls?card=active" />
          <BreakdownRow label="Polls Closed"           value={data.pollBreakdown.pollsClosed}        color="bg-slate-400"   href="/polls?card=closed" />
          <BreakdownRow label="Result Not Sent (Sir/Poll Requester)" value={data.pollBreakdown.resultNotSentSir}   color="bg-orange-400"  href="/polls?card=result-sir" />
          <BreakdownRow label="Result Not Sent to Voter" value={data.pollBreakdown.resultNotSentVoter} color="bg-red-400"   href="/polls?card=result-voter" />
        </div>

        {/* Cadence Breakdown */}
        <div className="rounded-2xl bg-white dark:bg-[#1e2535] shadow-[0_8px_30px_rgba(0,0,0,0.12)] dark:shadow-[0_8px_30px_rgba(0,0,0,0.4)] px-5 py-4">
          <div className="flex items-center gap-2 mb-4 pb-3 border-b border-gray-100 dark:border-slate-700">
            <CalendarClock className="h-4 w-4 text-cyan-500" />
            <h2 className="font-semibold text-gray-900 dark:text-white">Cadence Breakdown</h2>
          </div>
          <BreakdownRow label="Total Cadence"          value={data.cadenceBreakdown.total}            color="bg-cyan-400"    href="/cadence?card=all" />
          <BreakdownRow label="Monthly"                value={data.cadenceBreakdown.monthly}          color="bg-blue-400"    href="/cadence?card=all" />
          <BreakdownRow label="Quarterly"              value={data.cadenceBreakdown.quarterly}        color="bg-indigo-400"  href="/cadence?card=all" />
          {data.cadenceBreakdown.biAnnual > 0 && <BreakdownRow label="Bi-Annual" value={data.cadenceBreakdown.biAnnual} color="bg-violet-400" href="/cadence?card=all" />}
          {data.cadenceBreakdown.annual > 0 && <BreakdownRow label="Annual" value={data.cadenceBreakdown.annual} color="bg-purple-400" href="/cadence?card=all" />}
          <BreakdownRow label="Scheduled & Released"  value={data.cadenceBreakdown.scheduledReleased} color="bg-emerald-400" href="/cadence?card=released" />
          <BreakdownRow label="Overdue"               value={data.cadenceBreakdown.overdue}           color="bg-red-400"    href="/cadence?card=overdue" />
        </div>

        {/* Suggestion Breakdown */}
        <div className="rounded-2xl bg-white dark:bg-[#1e2535] shadow-[0_8px_30px_rgba(0,0,0,0.12)] dark:shadow-[0_8px_30px_rgba(0,0,0,0.4)] px-5 py-4">
          <div className="flex items-center gap-2 mb-4 pb-3 border-b border-gray-100 dark:border-slate-700">
            <MessageSquare className="h-4 w-4 text-blue-500" />
            <h2 className="font-semibold text-gray-900 dark:text-white">Suggestion Breakdown</h2>
          </div>
          <BreakdownRow label="Total"            value={data.suggestionBreakdown.total}           color="bg-blue-400"    href="/feedback?card=total" />
          <BreakdownRow label="Actionable"       value={data.suggestionBreakdown.actionable}      color="bg-orange-400"  href="/feedback?card=actionable" />
          <BreakdownRow label="Pending for Action" value={data.suggestionBreakdown.pendingForAction} color="bg-amber-400" href="/feedback?card=pending" />
          <BreakdownRow label="Process Improved" value={data.suggestionBreakdown.processImproved} color="bg-emerald-400" href="/feedback?card=process-improved" />
          <BreakdownRow label="Non-Actionable"   value={data.suggestionBreakdown.nonActionable}   color="bg-slate-400"   href="/feedback?card=non-actionable" />
        </div>
      </div>

      {/* Total Pending Polls Table */}
      {data.pendingPolls.length > 0 && (
        <div className="rounded-2xl bg-white dark:bg-[#1e2535] shadow-[0_8px_30px_rgba(0,0,0,0.12)] dark:shadow-[0_8px_30px_rgba(0,0,0,0.4)] px-5 py-4">
          <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-cyan-500" />
              <h2 className="font-semibold text-gray-900 dark:text-white">Total Pending Polls</h2>
              <span className="text-xs font-semibold bg-cyan-100 text-cyan-700 px-2 py-0.5 rounded-full">{data.pendingPolls.length}</span>
            </div>
            <Link href="/polls" className="flex items-center gap-1 text-xs text-cyan-600 hover:text-cyan-800 font-medium transition-colors">
              View all <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 dark:text-slate-500 uppercase tracking-wide border-b border-gray-100 dark:border-slate-700">
                  <th className="text-left pb-2 pr-4 font-semibold">Poll No.</th>
                  <th className="text-left pb-2 pr-4 font-semibold">Request Title</th>
                  <th className="text-left pb-2 pr-4 font-semibold">Requester</th>
                  <th className="text-left pb-2 pr-4 font-semibold">Dept.</th>
                  <th className="text-left pb-2 pr-4 font-semibold">Source</th>
                  <th className="text-left pb-2 pr-4 font-semibold">Date</th>
                  <th className="text-left pb-2 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-slate-700/50">
                {data.pendingPolls.map(p => (
                  <tr key={p.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/30 transition-colors">
                    <td className="py-2.5 pr-4">
                      <span className="text-xs font-semibold text-purple-600 bg-purple-50 px-2 py-0.5 rounded-full whitespace-nowrap">{p.pollNo}</span>
                    </td>
                    <td className="py-2.5 pr-4 max-w-[200px]">
                      <span className="text-gray-800 dark:text-slate-200 font-medium truncate block" title={p.topic}>{p.topic}</span>
                    </td>
                    <td className="py-2.5 pr-4 text-gray-600 dark:text-slate-400 whitespace-nowrap">{p.requestedBy}</td>
                    <td className="py-2.5 pr-4 text-gray-600 dark:text-slate-400 whitespace-nowrap">{p.department}</td>
                    <td className="py-2.5 pr-4">
                      {p.source === 'email'
                        ? <span className="text-xs font-medium bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">Mailbox</span>
                        : <span className="text-xs font-medium bg-teal-50 text-teal-600 px-2 py-0.5 rounded-full">Form</span>}
                    </td>
                    <td className="py-2.5 pr-4 text-gray-500 dark:text-slate-500 whitespace-nowrap text-xs">
                      {new Date(p.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </td>
                    <td className="py-2.5">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                        p.status === 'DRAFT' ? 'bg-gray-100 text-gray-600' :
                        p.status === 'AWAITING_APPROVAL' ? 'bg-amber-100 text-amber-700' :
                        p.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-700' :
                        p.status === 'REJECTED' ? 'bg-red-100 text-red-700' :
                        'bg-slate-100 text-slate-600'
                      }`}>{p.status.replace(/_/g, ' ')}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Polls with feedback pending for review */}
      <div id="feedback-pending-section" className="rounded-2xl bg-white dark:bg-[#1e2535] shadow-[0_8px_30px_rgba(0,0,0,0.12)] dark:shadow-[0_8px_30px_rgba(0,0,0,0.4)] px-5 py-4">
        <div className="flex items-center gap-2 mb-4 pb-3 border-b border-gray-100 dark:border-slate-700">
          <MessageSquare className="h-4 w-4 text-amber-500" />
          <h2 className="font-semibold text-gray-900 dark:text-white">Polls with feedback pending for review</h2>
          <span className="ml-1.5 text-xs font-semibold bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 px-2 py-0.5 rounded-full">
            {data.pollsWithFeedbackPending.length}
          </span>
          <Link href="/feedback" className="ml-auto flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 hover:text-amber-800 font-medium transition-colors">
            View all <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        {data.pollsWithFeedbackPending.length === 0 ? (
          <p className="text-center py-8 text-sm text-gray-400 dark:text-slate-500">No feedback pending for review</p>
        ) : (
          <>
            <div className="divide-y divide-gray-50 dark:divide-slate-700/50">
              {(showAllPending ? data.pollsWithFeedbackPending : data.pollsWithFeedbackPending.slice(0, 6)).map((p, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between py-2.5 px-2 -mx-2 rounded-lg hover:bg-amber-50/60 dark:hover:bg-amber-900/10 transition-colors cursor-default"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="h-2 w-2 rounded-full bg-amber-400 flex-shrink-0" />
                    <span className="text-sm text-gray-700 dark:text-slate-300 truncate">{p.poll_title ?? 'Untitled Poll'}</span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                    <span className="text-xs font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 px-2 py-0.5 rounded-full">{p.count} pending</span>
                    <Link
                      href={p.poll_id ? `/feedback?poll=${p.poll_id}` : '/feedback'}
                      className="text-xs text-amber-500 dark:text-amber-400 hover:text-amber-700 font-medium transition-colors whitespace-nowrap"
                    >
                      View responses →
                    </Link>
                  </div>
                </div>
              ))}
            </div>
            {data.pollsWithFeedbackPending.length > 6 && (
              <div className="mt-3 pt-3 border-t border-gray-100 dark:border-slate-700">
                <button
                  onClick={() => setShowAllPending(v => !v)}
                  className="flex items-center justify-center gap-1.5 w-full text-sm text-amber-600 dark:text-amber-400 hover:text-amber-800 font-medium transition-colors"
                >
                  {showAllPending
                    ? <>Show less <ChevronUp className="h-3.5 w-3.5" /></>
                    : <>View {data.pollsWithFeedbackPending.length - 6} more polls <ChevronDown className="h-3.5 w-3.5" /></>}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

