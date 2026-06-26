'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState, useCallback } from 'react'
import { MessageSquare, RefreshCw, AlertCircle } from 'lucide-react'

interface FeedbackItem {
  id: string
  poll_id: string | null
  poll_title: string | null
  type: string | null
  summary: string | null
  detail: string | null
  submitted_by: string | null
  department: string | null
  owner: string | null
  status: string | null
  due_date: string | null
  submitted_date: string | null
  rms_task_id: string | null
  task_pending: number | null
  followup_done: number | null
  category: string | null
  created_at: string
}

interface Poll {
  id: string
  topic: string
  requested_by: string
  department: string
  status: string
}

const ACTIVE_STATUSES = ['SENT', 'REMINDER_SENT', 'RMS_PUBLISHED', 'CLOSED', 'RESULTS_UPLOADED']

function StatCard({ label, value, color, bg }: { label: string; value: number; color: string; bg: string }) {
  return (
    <div className={`rounded-2xl ${bg} px-4 py-4 text-center`}>
      <p className={`text-3xl font-bold ${color}`}>{value}</p>
      <p className={`text-xs font-medium mt-1 ${color} opacity-80`}>{label}</p>
    </div>
  )
}

export default function FeedbackPage() {
  const [items, setItems] = useState<FeedbackItem[]>([])
  const [polls, setPolls] = useState<Poll[]>([])
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [fbData, pollsData] = await Promise.all([
        fetch('/api/feedback').then(r => r.ok ? r.json() : []) as Promise<FeedbackItem[]>,
        fetch('/api/polls').then(r => r.ok ? r.json() : []) as Promise<Poll[]>,
      ])
      setItems(fbData)
      setPolls(pollsData.filter(p => p.status !== 'ARCHIVED'))
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { void fetchData() }, [fetchData])

  const now = new Date()
  const isOverdue = (item: FeedbackItem) =>
    item.due_date != null && new Date(item.due_date) < now && item.status !== 'Closed'

  const total = items.length
  const actionable = items.filter(i => i.type === 'Actionable').length
  const suggestions = items.filter(i => i.type === 'Suggestion').length
  const queries = items.filter(i => i.type === 'Query').length
  const open = items.filter(i => i.status === 'Open').length
  const inProgress = items.filter(i => i.status === 'In Progress').length
  const closed = items.filter(i => i.status === 'Closed').length
  const overdue = items.filter(isOverdue).length

  // Polls with no feedback
  const pollsWithFeedback = new Set(items.map(i => i.poll_id).filter(Boolean))
  const pollsWithNoFeedback = polls.filter(
    p => ACTIVE_STATUSES.includes(p.status) && !pollsWithFeedback.has(p.id)
  )

  // Department breakdown
  const deptMap: Record<string, { total: number; open: number }> = {}
  items.forEach(item => {
    const dept = item.department ?? 'Unknown'
    if (!deptMap[dept]) deptMap[dept] = { total: 0, open: 0 }
    deptMap[dept].total++
    if (item.status !== 'Closed') deptMap[dept].open++
  })
  const departments = Object.entries(deptMap).sort((a, b) => b[1].total - a[1].total)

  const statCards = [
    { label: 'Total Suggestions', value: total, color: 'text-purple-700', bg: 'bg-purple-50' },
    { label: 'Actionable', value: actionable, color: 'text-orange-700', bg: 'bg-orange-50' },
    { label: 'Suggestions', value: suggestions, color: 'text-blue-700', bg: 'bg-blue-50' },
    { label: 'Queries', value: queries, color: 'text-cyan-700', bg: 'bg-cyan-50' },
    { label: 'Open', value: open, color: 'text-red-700', bg: 'bg-red-50' },
    { label: 'In Progress', value: inProgress, color: 'text-amber-700', bg: 'bg-amber-50' },
    { label: 'Closed', value: closed, color: 'text-emerald-700', bg: 'bg-emerald-50' },
    { label: 'Overdue', value: overdue, color: 'text-rose-800', bg: 'bg-rose-100' },
  ]

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Feedback & Suggestions</h1>
          <p className="text-sm text-slate-500">Track actionable suggestions and voter feedback</p>
        </div>
        <button onClick={() => void fetchData()}
          className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 shadow-sm transition-colors">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>

      {/* 8 Stat Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        {statCards.map(card => <StatCard key={card.label} {...card} />)}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Polls with No Suggestions */}
        <div className="rounded-2xl bg-white shadow-[0_8px_30px_rgba(0,0,0,0.12)]">
          <div className="flex items-center gap-2 border-b border-gray-100 px-5 py-4">
            <AlertCircle className="h-4 w-4 text-amber-500" />
            <h2 className="font-semibold text-gray-900">Polls with No Suggestions Received</h2>
            <span className="ml-auto text-xs font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
              {pollsWithNoFeedback.length}
            </span>
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-cyan-500 border-t-transparent" />
            </div>
          ) : pollsWithNoFeedback.length === 0 ? (
            <p className="text-center py-10 text-sm text-gray-400">All active polls have received feedback</p>
          ) : (
            <div className="divide-y divide-gray-50">
              <div className="grid grid-cols-4 gap-2 px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-gray-400">
                <span className="col-span-2">Poll</span>
                <span>Requester</span>
                <span>Status</span>
              </div>
              {pollsWithNoFeedback.slice(0, 10).map(poll => (
                <div key={poll.id} className="grid grid-cols-4 items-center gap-2 px-5 py-3 hover:bg-gray-50 transition-colors">
                  <div className="col-span-2 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{poll.topic}</p>
                    <p className="text-xs text-gray-400">{poll.department}</p>
                  </div>
                  <p className="text-xs text-gray-600 truncate">{poll.requested_by}</p>
                  <span className="text-xs font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full truncate">{poll.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Department Breakdown */}
        <div className="rounded-2xl bg-white shadow-[0_8px_30px_rgba(0,0,0,0.12)]">
          <div className="flex items-center gap-2 border-b border-gray-100 px-5 py-4">
            <MessageSquare className="h-4 w-4 text-blue-500" />
            <h2 className="font-semibold text-gray-900">By Department</h2>
          </div>
          {departments.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2">
              <MessageSquare className="h-8 w-8 text-gray-200" />
              <p className="text-sm text-gray-400">No feedback items yet</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {departments.map(([dept, counts]) => {
                const pct = total > 0 ? Math.round((counts.total / total) * 100) : 0
                return (
                  <div key={dept} className="px-5 py-3.5">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm font-medium text-gray-800">{dept}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-400">{counts.open} open</span>
                        <span className="text-sm font-bold text-gray-900">{counts.total}</span>
                      </div>
                    </div>
                    <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                      <div className="h-full rounded-full bg-blue-400 transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Full Feedback Table */}
      <div className="rounded-2xl bg-white shadow-[0_8px_30px_rgba(0,0,0,0.12)]">
        <div className="flex items-center gap-2 border-b border-gray-100 px-5 py-4">
          <MessageSquare className="h-4 w-4 text-purple-500" />
          <h2 className="font-semibold text-gray-900">All Feedback Items</h2>
          <span className="ml-auto text-xs text-gray-400">{total} total</span>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-10">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-cyan-500 border-t-transparent" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2">
            <MessageSquare className="h-8 w-8 text-gray-200" />
            <p className="text-sm text-gray-400">No feedback items yet</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px]">
              <thead>
                <tr className="border-b border-gray-100">
                  {['Poll', 'Type', 'Summary', 'Dept', 'Status', 'Category'].map(h => (
                    <th key={h} className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {items.map(item => (
                  <tr key={item.id} className={`hover:bg-gray-50 transition-colors ${isOverdue(item) ? 'bg-red-50/40' : ''}`}>
                    <td className="px-5 py-3 text-sm text-gray-600 max-w-[180px] truncate">{item.poll_title ?? '—'}</td>
                    <td className="px-5 py-3">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full
                        ${item.type === 'Actionable' ? 'bg-orange-100 text-orange-700' :
                          item.type === 'Query' ? 'bg-cyan-100 text-cyan-700' : 'bg-blue-100 text-blue-700'}`}>
                        {item.type ?? '—'}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-sm text-gray-800 max-w-[200px] truncate">{item.summary ?? '—'}</td>
                    <td className="px-5 py-3 text-sm text-gray-600">{item.department ?? '—'}</td>
                    <td className="px-5 py-3">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full
                        ${item.status === 'Closed' ? 'bg-emerald-100 text-emerald-700' :
                          item.status === 'In Progress' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                        {item.status ?? 'Open'}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-sm text-gray-500">{item.category ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
