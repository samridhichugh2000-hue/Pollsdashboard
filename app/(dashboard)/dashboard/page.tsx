'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { KPICards } from '@/components/dashboard/kpi-cards'
import { AlertTriangle, Clock, ExternalLink } from 'lucide-react'
import { formatRelative, formatDateTime, isApprovalOverdue } from '@/lib/utils'
import { StatusBadge } from '@/components/polls/status-badge'
import type { Poll, KPIData } from '@/types'

const defaultKPI: KPIData = {
  totalThisMonth: 0,
  awaitingApproval: 0,
  active: 0,
  closedThisMonth: 0,
  rmsTasksCreatedPct: 0,
  resultsUploadedPct: 0,
}

function SkeletonCard({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-2xl bg-white/20 ${className}`} />
}

export default function DashboardPage() {
  const [kpi, setKpi] = useState<KPIData>(defaultKPI)
  const [polls, setPolls] = useState<Poll[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      fetch('/api/kpi').then((r) => r.json()),
      fetch('/api/polls').then((r) => r.json()),
    ])
      .then(([kpiData, pollsData]: [KPIData, Poll[]]) => {
        setKpi(kpiData)
        setPolls(pollsData)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const recentPolls = polls.slice(0, 6)
  const overdueApprovals = polls.filter(
    (p) => p.status === 'AWAITING_APPROVAL' && isApprovalOverdue(p.updated_at)
  )
  const activePolls = polls.filter((p) => ['SENT', 'REMINDER_SENT', 'RMS_PUBLISHED'].includes(p.status))

  if (loading) {
    return (
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} className="h-28" />)}
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <SkeletonCard className="h-72 lg:col-span-2" />
          <SkeletonCard className="h-72" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* KPI row */}
      <KPICards data={kpi} />

      {/* Main grid */}
      <div className="grid gap-4 lg:grid-cols-3">

        {/* Recent polls — wide card */}
        <div className="rounded-2xl bg-white shadow-[0_8px_30px_rgba(0,0,0,0.12)] lg:col-span-2">
          <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-cyan-600" />
              <h2 className="font-semibold text-gray-900">Recent Polls</h2>
            </div>
            <Link href="/polls" className="text-xs font-medium text-cyan-600 hover:text-cyan-700">
              View all →
            </Link>
          </div>
          <div className="divide-y divide-gray-50">
            {recentPolls.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-gray-400">No polls yet. Create your first poll!</p>
            ) : recentPolls.map((poll) => (
              <Link key={poll.id} href={`/polls/${poll.id}`} className="flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50 transition-colors">
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-medium text-gray-900">{poll.topic}</p>
                  <p className="text-xs text-gray-400">{poll.department} · {formatRelative(poll.created_at)}</p>
                </div>
                <StatusBadge status={poll.status} />
                <ExternalLink className="h-3.5 w-3.5 text-gray-300 flex-shrink-0" />
              </Link>
            ))}
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-4">

          {/* Overdue approvals */}
          {overdueApprovals.length > 0 && (
            <div className="rounded-2xl bg-white shadow-[0_8px_30px_rgba(0,0,0,0.12)]">
              <div className="flex items-center gap-2 border-b border-gray-100 px-5 py-4">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                <h2 className="font-semibold text-gray-900">Overdue Approvals</h2>
                <span className="ml-auto flex h-5 w-5 items-center justify-center rounded-full bg-amber-100 text-xs font-bold text-amber-600">
                  {overdueApprovals.length}
                </span>
              </div>
              <ul className="divide-y divide-gray-50">
                {overdueApprovals.map((p) => (
                  <li key={p.id}>
                    <Link href={`/polls/${p.id}`} className="flex flex-col px-5 py-3 hover:bg-gray-50 transition-colors">
                      <span className="truncate text-sm font-medium text-gray-900">{p.topic}</span>
                      <span className="text-xs text-amber-600">Sent {formatRelative(p.updated_at)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Active polls tracker */}
          <div className="rounded-2xl bg-white shadow-[0_8px_30px_rgba(0,0,0,0.12)]">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
              <h2 className="font-semibold text-gray-900">Live Polls</h2>
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-600">
                {activePolls.length}
              </span>
            </div>
            {activePolls.length === 0 ? (
              <p className="px-5 py-6 text-center text-sm text-gray-400">No active polls</p>
            ) : (
              <ul className="divide-y divide-gray-50">
                {activePolls.slice(0, 5).map((p) => (
                  <li key={p.id}>
                    <Link href={`/polls/${p.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors">
                      <span className="h-2 w-2 flex-shrink-0 rounded-full bg-emerald-400" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-gray-900">{p.topic}</p>
                        <p className="text-xs text-gray-400">Sent {formatRelative(p.sent_at)}</p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Status breakdown */}
          <div className="rounded-2xl bg-white px-5 py-4 shadow-[0_8px_30px_rgba(0,0,0,0.12)]">
            <h2 className="mb-3 font-semibold text-gray-900">Pipeline</h2>
            <div className="space-y-2.5">
              {[
                { label: 'Draft', count: polls.filter(p => p.status === 'DRAFT').length, color: 'bg-gray-300' },
                { label: 'Awaiting Approval', count: polls.filter(p => p.status === 'AWAITING_APPROVAL').length, color: 'bg-amber-400' },
                { label: 'Approved', count: polls.filter(p => p.status === 'APPROVED').length, color: 'bg-green-400' },
                { label: 'Sent / Active', count: polls.filter(p => ['SENT','REMINDER_SENT'].includes(p.status)).length, color: 'bg-violet-400' },
                { label: 'Closed', count: polls.filter(p => ['CLOSED','RESULTS_UPLOADED'].includes(p.status)).length, color: 'bg-slate-400' },
              ].map(({ label, count, color }) => (
                <div key={label} className="flex items-center gap-3">
                  <span className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${color}`} />
                  <span className="flex-1 text-xs text-gray-600">{label}</span>
                  <span className="text-xs font-semibold text-gray-900">{count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
