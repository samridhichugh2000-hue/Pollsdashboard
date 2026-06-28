'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState, useCallback, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { RefreshCw, X } from 'lucide-react'
import { toast } from 'sonner'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { PollsTable } from '@/components/polls/polls-table'
import type { Poll } from '@/types'

type CardKey = 'not-sent' | 'approval-pending' | 'active' | 'closed' | 'result-sir' | 'result-voter' | 'total'

function filterByCard(polls: Poll[], key: CardKey): Poll[] {
  switch (key) {
    case 'not-sent':          return polls.filter(p => ['DETECTED', 'DRAFT', 'FORM_CREATED'].includes(p.status))
    case 'approval-pending':  return polls.filter(p => p.status === 'AWAITING_APPROVAL')
    case 'active':            return polls.filter(p => ['SENT', 'REMINDER_SENT', 'RMS_PUBLISHED'].includes(p.status))
    case 'closed':            return polls.filter(p => ['CLOSED', 'RESULTS_UPLOADED', 'RESULTS_SHARED'].includes(p.status))
    case 'result-sir':        return polls.filter(p => ['CLOSED', 'RESULTS_UPLOADED'].includes(p.status) && !p.rms_task_id)
    case 'result-voter':      return polls.filter(p => !['CLOSED', 'RESULTS_UPLOADED', 'RESULTS_SHARED'].includes(p.status))
    case 'total':             return polls.filter(p => p.status !== 'ARCHIVED')
  }
}

function filterByTab(polls: Poll[], tab: string): Poll[] {
  switch (tab) {
    case 'inbox':    return polls.filter(p => p.source === 'email')
    case 'via-form': return polls.filter(p => p.source === 'dashboard')
    case 'active':   return polls.filter(p => ['SENT', 'REMINDER_SENT', 'RMS_PUBLISHED'].includes(p.status))
    case 'not-sent': return polls.filter(p => p.status === 'DRAFT')
    case 'closed':   return polls.filter(p => ['CLOSED', 'ARCHIVED', 'REJECTED', 'RESULTS_UPLOADED', 'RESULTS_SHARED'].includes(p.status))
    default:         return [...polls]
  }
}

const VALID_CARD_KEYS: CardKey[] = ['not-sent', 'approval-pending', 'active', 'closed', 'result-sir', 'result-voter', 'total']

function PollRequestsContent() {
  const searchParams = useSearchParams()
  const cardParam = searchParams.get('card') as CardKey | null
  const [polls, setPolls] = useState<Poll[]>([])
  const [loading, setLoading] = useState(true)
  const [activeCard, setActiveCard] = useState<CardKey | null>(
    cardParam && VALID_CARD_KEYS.includes(cardParam) ? cardParam : null
  )

  const fetchPolls = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetch('/api/polls').then(r => r.ok ? r.json() : []) as Poll[]
      setPolls(data.filter((p: Poll) => p.status !== 'ARCHIVED'))
    } catch { toast.error('Failed to load polls') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { void fetchPolls() }, [fetchPolls])

  const handleMarkClosed = async (pollId: string) => {
    await fetch(`/api/polls/${pollId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'MARK_CLOSED' }) })
    toast.success('Poll marked as closed')
    void fetchPolls()
  }
  const handleCloseExternal = async (pollId: string) => {
    const res = await fetch(`/api/polls/${pollId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'CLOSE_EXTERNAL_REQUEST' }) })
    if (res.ok) toast.success('Poll closed and requester notified')
    else toast.error('Failed to close poll')
    void fetchPolls()
  }
  const handleArchive = async (pollId: string) => {
    const res = await fetch(`/api/polls/${pollId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'ARCHIVE' }) })
    if (res.ok) toast.success('Poll archived')
    else toast.error('Failed to archive poll')
    void fetchPolls()
  }
  const handleReject = async (pollId: string) => {
    const res = await fetch(`/api/polls/${pollId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'REJECT' }) })
    if (res.ok) toast.success('Poll request rejected')
    else toast.error('Failed to reject poll')
    void fetchPolls()
  }
  const handleRejectExternal = async (pollId: string, reason: string) => {
    const res = await fetch(`/api/polls/${pollId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'REJECT_EXTERNAL_REQUEST', reason }) })
    if (res.ok) toast.success('Poll request rejected and requester notified')
    else toast.error('Failed to reject poll')
    void fetchPolls()
  }

  const statCards: { key: CardKey; label: string; value: number; color: string; bg: string; border: string; ring: string }[] = [
    { key: 'not-sent',         label: 'Not Sent for Approval',  value: filterByCard(polls, 'not-sent').length,         color: 'text-cyan-700',    bg: 'bg-cyan-50',    border: 'border-cyan-200',    ring: 'ring-cyan-400' },
    { key: 'approval-pending', label: 'Approval Pending',        value: filterByCard(polls, 'approval-pending').length, color: 'text-violet-700',  bg: 'bg-violet-50',  border: 'border-violet-200',  ring: 'ring-violet-400' },
    { key: 'active',           label: 'Active Polls',            value: filterByCard(polls, 'active').length,           color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200', ring: 'ring-emerald-400' },
    { key: 'closed',           label: 'Polls Closed',            value: filterByCard(polls, 'closed').length,           color: 'text-slate-700',   bg: 'bg-slate-50',   border: 'border-slate-200',   ring: 'ring-slate-400' },
    { key: 'result-sir',       label: 'Result Not Sent (Sir)',   value: filterByCard(polls, 'result-sir').length,       color: 'text-orange-700',  bg: 'bg-orange-50',  border: 'border-orange-200',  ring: 'ring-orange-400' },
    { key: 'result-voter',     label: 'Result Not Sent (Voter)', value: filterByCard(polls, 'result-voter').length,     color: 'text-red-700',     bg: 'bg-red-50',     border: 'border-red-200',     ring: 'ring-red-400' },
    { key: 'total',            label: 'Total Polls',             value: polls.filter(p => p.status !== 'ARCHIVED').length,                                   color: 'text-purple-700',  bg: 'bg-purple-50',  border: 'border-purple-200',  ring: 'ring-purple-400' },
  ]

  const tablePolls = activeCard ? filterByCard(polls, activeCard) : null
  const activeCardLabel = activeCard ? statCards.find(c => c.key === activeCard)?.label : null

  const tableActions = {
    onMarkClosed: handleMarkClosed,
    onCloseExternal: handleCloseExternal,
    onArchive: handleArchive,
    onReject: handleReject,
    onRejectExternal: handleRejectExternal,
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Poll Requests</h2>
          <p className="text-sm text-slate-500">{polls.length} total polls</p>
        </div>
        <button onClick={() => void fetchPolls()}
          className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 shadow-sm transition-colors">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
        {statCards.map(({ key, label, value, color, bg, border, ring }) => (
          <button
            key={key}
            onClick={() => setActiveCard(prev => prev === key ? null : key)}
            className={`rounded-2xl ${bg} border ${border} px-4 py-4 text-center cursor-pointer transition-all hover:shadow-md hover:scale-[1.02] ${activeCard === key ? `ring-2 ${ring} shadow-md scale-[1.02]` : ''}`}
          >
            <p className={`text-3xl font-bold ${color}`}>{value}</p>
            <p className={`text-xs font-medium mt-1 ${color} opacity-80`}>{label}</p>
          </button>
        ))}
      </div>

      <div className="rounded-2xl bg-white shadow-[0_8px_30px_rgba(0,0,0,0.12)]">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-cyan-500 border-t-transparent" />
          </div>
        ) : activeCard ? (
          /* Card filter active — show filtered results directly */
          <>
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
              <p className="text-sm font-semibold text-gray-700">
                Showing: <span className="text-cyan-600">{activeCardLabel}</span>
                <span className="ml-2 text-gray-400 font-normal">({tablePolls!.length} polls)</span>
              </p>
              <button onClick={() => setActiveCard(null)}
                className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors">
                <X className="h-3.5 w-3.5" /> Clear filter
              </button>
            </div>
            <PollsTable polls={tablePolls!} {...tableActions} onDeleted={() => void fetchPolls()} />
          </>
        ) : (
          /* No card selected — show normal tabs */
          <Tabs defaultValue="all">
            <div className="border-b border-gray-100 px-5 pt-4">
              <TabsList className="bg-gray-100 mb-0 flex-wrap h-auto gap-1">
                <TabsTrigger value="all">All ({filterByTab(polls, 'all').length})</TabsTrigger>
                <TabsTrigger value="inbox">Inbox ({filterByTab(polls, 'inbox').length})</TabsTrigger>
                <TabsTrigger value="via-form">Via Form ({filterByTab(polls, 'via-form').length})</TabsTrigger>
                <TabsTrigger value="active">Active Polls ({filterByTab(polls, 'active').length})</TabsTrigger>
                <TabsTrigger value="not-sent">Polls Not Sent for Approval ({filterByTab(polls, 'not-sent').length})</TabsTrigger>
                <TabsTrigger value="closed">Polls Closed ({filterByTab(polls, 'closed').length})</TabsTrigger>
              </TabsList>
            </div>
            {(['all', 'inbox', 'via-form', 'active', 'not-sent'] as const).map((tab) => (
              <TabsContent key={tab} value={tab} className="mt-0">
                <PollsTable polls={filterByTab(polls, tab)} {...tableActions} onDeleted={() => void fetchPolls()} />
              </TabsContent>
            ))}
            <TabsContent value="closed" className="mt-0">
              <PollsTable polls={filterByTab(polls, 'closed')} onDeleted={() => void fetchPolls()} />
            </TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  )
}

export default function PollRequestsPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center py-20">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-cyan-500 border-t-transparent" />
      </div>
    }>
      <PollRequestsContent />
    </Suspense>
  )
}
