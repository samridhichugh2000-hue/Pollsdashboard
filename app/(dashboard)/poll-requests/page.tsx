'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState, useCallback } from 'react'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { PollsTable } from '@/components/polls/polls-table'
import type { Poll } from '@/types'

export default function PollRequestsPage() {
  const [polls, setPolls] = useState<Poll[]>([])
  const [loading, setLoading] = useState(true)

  const fetchPolls = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetch('/api/polls').then(r => r.ok ? r.json() : []) as Poll[]
      setPolls(data)
    } catch { toast.error('Failed to load polls') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { void fetchPolls() }, [fetchPolls])

  const handleMarkClosed = async (pollId: string) => {
    await fetch(`/api/polls/${pollId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'MARK_CLOSED' }),
    })
    toast.success('Poll marked as closed')
    void fetchPolls()
  }

  const handleCloseExternal = async (pollId: string) => {
    const res = await fetch(`/api/polls/${pollId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'CLOSE_EXTERNAL_REQUEST' }),
    })
    if (res.ok) toast.success('Poll closed and requester notified')
    else toast.error('Failed to close poll')
    void fetchPolls()
  }

  const handleArchive = async (pollId: string) => {
    const res = await fetch(`/api/polls/${pollId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'ARCHIVE' }),
    })
    if (res.ok) toast.success('Poll archived')
    else toast.error('Failed to archive poll')
    void fetchPolls()
  }

  const handleReject = async (pollId: string) => {
    const res = await fetch(`/api/polls/${pollId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'REJECT' }),
    })
    if (res.ok) toast.success('Poll request rejected')
    else toast.error('Failed to reject poll')
    void fetchPolls()
  }

  const handleRejectExternal = async (pollId: string, reason: string) => {
    const res = await fetch(`/api/polls/${pollId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'REJECT_EXTERNAL_REQUEST', reason }),
    })
    if (res.ok) toast.success('Poll request rejected and requester notified')
    else toast.error('Failed to reject poll')
    void fetchPolls()
  }

  const notSentForApproval = polls.filter(p => ['DETECTED', 'DRAFT', 'FORM_CREATED'].includes(p.status)).length
  const approvalPending = polls.filter(p => p.status === 'AWAITING_APPROVAL').length
  const activePolls = polls.filter(p => ['SENT', 'REMINDER_SENT', 'RMS_PUBLISHED'].includes(p.status)).length
  const pollsClosed = polls.filter(p => ['CLOSED', 'RESULTS_UPLOADED', 'RESULTS_SHARED'].includes(p.status)).length
  const resultNotSentSir = polls.filter(p => ['CLOSED', 'RESULTS_UPLOADED'].includes(p.status) && !p.rms_task_id).length
  const resultNotSentVoter = polls.filter(p => p.status === 'CLOSED').length

  const statCards = [
    { label: 'Not Sent for Approval', value: notSentForApproval, color: 'text-cyan-700', bg: 'bg-cyan-50', border: 'border-cyan-200' },
    { label: 'Approval Pending',       value: approvalPending,    color: 'text-violet-700', bg: 'bg-violet-50', border: 'border-violet-200' },
    { label: 'Active Polls',           value: activePolls,        color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200' },
    { label: 'Polls Closed',           value: pollsClosed,        color: 'text-slate-700', bg: 'bg-slate-50', border: 'border-slate-200' },
    { label: 'Result Not Sent (Sir)',  value: resultNotSentSir,   color: 'text-orange-700', bg: 'bg-orange-50', border: 'border-orange-200' },
    { label: 'Result Not Sent (Voter)',value: resultNotSentVoter, color: 'text-red-700', bg: 'bg-red-50', border: 'border-red-200' },
    { label: 'Total Polls',            value: polls.length,       color: 'text-purple-700', bg: 'bg-purple-50', border: 'border-purple-200' },
  ]

  const filterByTab = (tab: string): Poll[] => {
    switch (tab) {
      case 'inbox':    return polls.filter(p => p.source === 'email')
      case 'via-form': return polls.filter(p => p.source === 'external')
      case 'active':   return polls.filter(p => ['SENT', 'REMINDER_SENT', 'RMS_PUBLISHED'].includes(p.status))
      case 'not-sent': return polls.filter(p => p.status === 'DRAFT')
      case 'closed':   return polls.filter(p => ['CLOSED', 'ARCHIVED', 'REJECTED', 'RESULTS_UPLOADED', 'RESULTS_SHARED'].includes(p.status))
      default:         return [...polls]
    }
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
        {statCards.map(({ label, value, color, bg, border }) => (
          <div key={label} className={`rounded-2xl ${bg} border ${border} px-4 py-4 text-center`}>
            <p className={`text-3xl font-bold ${color}`}>{value}</p>
            <p className={`text-xs font-medium mt-1 ${color} opacity-80`}>{label}</p>
          </div>
        ))}
      </div>

      <div className="rounded-2xl bg-white shadow-[0_8px_30px_rgba(0,0,0,0.12)]">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-cyan-500 border-t-transparent" />
          </div>
        ) : (
          <Tabs defaultValue="all">
            <div className="border-b border-gray-100 px-5 pt-4">
              <TabsList className="bg-gray-100 mb-0 flex-wrap h-auto gap-1">
                <TabsTrigger value="all">All ({filterByTab('all').length})</TabsTrigger>
                <TabsTrigger value="inbox">Inbox ({filterByTab('inbox').length})</TabsTrigger>
                <TabsTrigger value="via-form">Via Form ({filterByTab('via-form').length})</TabsTrigger>
                <TabsTrigger value="active">Active Polls ({filterByTab('active').length})</TabsTrigger>
                <TabsTrigger value="not-sent">Polls Not Sent for Approval ({filterByTab('not-sent').length})</TabsTrigger>
                <TabsTrigger value="closed">Polls Closed ({filterByTab('closed').length})</TabsTrigger>
              </TabsList>
            </div>
            {(['all', 'inbox', 'via-form', 'active', 'not-sent'] as const).map((tab) => (
              <TabsContent key={tab} value={tab} className="mt-0">
                <PollsTable
                  polls={filterByTab(tab)}
                  onMarkClosed={handleMarkClosed}
                  onCloseExternal={handleCloseExternal}
                  onArchive={handleArchive}
                  onReject={handleReject}
                  onRejectExternal={handleRejectExternal}
                />
              </TabsContent>
            ))}
            <TabsContent value="closed" className="mt-0">
              <PollsTable polls={filterByTab('closed')} />
            </TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  )
}
