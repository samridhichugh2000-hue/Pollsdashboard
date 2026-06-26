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
